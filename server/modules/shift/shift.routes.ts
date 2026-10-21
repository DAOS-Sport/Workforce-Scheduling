/**
 * Shift module HTTP routes (Task #69 Step 4).
 *
 * EVERY route under /api/shifts/* and /api/shifts-cancelled/* lives here.
 * Behavior is byte-identical to the original routes.ts implementation;
 * only the file boundary changed.
 *
 * Critical contract preserved end-to-end:
 *   - Single-edit / single-delete pass force=true (admin's explicit click)
 *   - Batch/import paths pass force=true on update (admin's explicit bulk click)
 *   - Plain createShift never needs force (no row exists yet)
 *   - Audit log is written by storage.createShift/updateShift/deleteShift
 *   - LEAVE_TYPES skip labor-law validation
 */
import type { Express } from "express";
import { storage } from "../../storage";
import { validateAllRules } from "../../core/labor/laborValidation";
import {
  insertShiftSchema,
  getFourWeekPeriod,
  type Shift,
  type ShiftValidationError,
} from "@shared/schema";
import { LEAVE_TYPES } from "./shift.types";

export function mountShiftRoutes(app: Express): void {
  // ── Reads ────────────────────────────────────────────────────────────

  app.get("/api/shifts/:regionCode/:startDate/:endDate", async (req, res) => {
    const { regionCode, startDate, endDate } = req.params;
    const codes = regionCode.split(",").map((c) => c.trim()).filter(Boolean);
    const seenIds = new Set<number>();
    const merged: Shift[] = [];
    for (const code of codes) {
      const region = await storage.getRegionByCode(code);
      if (!region) continue;
      const regionShifts = await storage.getShiftsByRegionAndDateRange(region.id, startDate, endDate);
      const dispatchedInShifts = await storage.getDispatchedShiftsToRegion(region.id, startDate, endDate);
      for (const s of regionShifts) {
        if (seenIds.has(s.id)) continue;
        seenIds.add(s.id);
        merged.push(s);
      }
      for (const s of dispatchedInShifts) {
        if (seenIds.has(s.id)) continue;
        seenIds.add(s.id);
        merged.push(s);
      }
    }
    res.json(merged);
  });

  app.get("/api/shifts-cancelled/:regionCode/:startDate/:endDate", async (req, res) => {
    const { regionCode, startDate, endDate } = req.params;
    const region = await storage.getRegionByCode(regionCode);
    if (!region) return res.json([]);
    const cancelled = await storage.getCancelledShiftsByRegionAndDateRange(region.id, startDate, endDate);
    res.json(cancelled);
  });

  // Spec'd endpoint per Task #50: returns active shifts by default; includes
  // cancelled rows when ?includeCancelled=1 is passed.
  app.get("/api/shifts/:regionCode/:startDate/:endDate/all", async (req, res) => {
    const { regionCode, startDate, endDate } = req.params;
    const includeCancelled = req.query.includeCancelled === "1" || req.query.includeCancelled === "true";
    const region = await storage.getRegionByCode(regionCode);
    if (!region) return res.json([]);
    const active = await storage.getShiftsByRegionAndDateRange(region.id, startDate, endDate);
    if (!includeCancelled) return res.json(active);
    const cancelled = await storage.getCancelledShiftsByRegionAndDateRange(region.id, startDate, endDate);
    res.json([...active, ...cancelled]);
  });

  app.get("/api/shifts/:id/audit", async (req, res) => {
    const id = parseInt(req.params.id);
    const log = await storage.getShiftAuditLog(id);
    res.json(log);
  });

  // ── Validation precheck ──────────────────────────────────────────────

  app.post("/api/shifts/four-week-precheck", async (req, res) => {
    try {
      const { employeeId, date, startTime, endTime, shiftIdToExclude } = req.body;
      if (!employeeId || !date || !startTime || !endTime) {
        return res.status(400).json({ message: "缺少必要欄位" });
      }

      const refConfig = await storage.getSystemConfig("four_week_reference_date");
      const fourWeekRef = refConfig?.value || "2025-01-06";
      const existingShifts = await storage.getShiftsByEmployee(employeeId);
      const period = getFourWeekPeriod(date, fourWeekRef);
      const approvedOT = await storage.getApprovedOvertimeByDateRange(period.start, period.end);
      const otRecords = approvedOT.map((ot) => ({
        employeeId: ot.employeeId,
        date: ot.date,
        startTime: ot.startTime,
        endTime: ot.endTime,
      }));

      const errors = validateAllRules(
        employeeId,
        date,
        startTime,
        endTime,
        existingShifts,
        shiftIdToExclude || undefined,
        fourWeekRef,
        otRecords,
      );

      const fourWeekErrors = errors.filter(
        (e) => e.type === "four_week_160h" || e.type === "four_week_176h",
      );
      res.json({ warnings: fourWeekErrors });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Single-shift CRUD ───────────────────────────────────────────────

  app.post("/api/shifts", async (req, res) => {
    try {
      const parsed = insertShiftSchema.parse(req.body);

      const employee = await storage.getEmployee(parsed.employeeId);
      if (!employee || employee.status !== "active") {
        return res.status(400).json({ message: "該員工非在職狀態，無法排班" });
      }

      const isLeave = LEAVE_TYPES.includes(parsed.role ?? "" as any);
      const isDispatchShift = parsed.isDispatch || false;
      let warnings: ShiftValidationError[] = [];

      if (!isLeave && !isDispatchShift) {
        const refConfig = await storage.getSystemConfig("four_week_reference_date");
        const fourWeekRef = refConfig?.value || "2025-01-06";
        const existingShifts = await storage.getShiftsByEmployee(parsed.employeeId);
        const period = getFourWeekPeriod(parsed.date, fourWeekRef);
        const approvedOT = await storage.getApprovedOvertimeByDateRange(period.start, period.end);
        const errors = validateAllRules(
          parsed.employeeId,
          parsed.date,
          parsed.startTime,
          parsed.endTime,
          existingShifts,
          undefined,
          fourWeekRef,
          approvedOT.map((ot) => ({
            employeeId: ot.employeeId,
            date: ot.date,
            startTime: ot.startTime,
            endTime: ot.endTime,
          })),
        );

        const blocking = errors.filter(
          (e: ShiftValidationError) =>
            e.type === "seven_day_rest" || e.type === "daily_12h" || e.type === "four_week_176h",
        );
        if (blocking.length > 0) {
          return res.status(400).json({ message: blocking[0].message });
        }
        warnings = errors.filter(
          (e: ShiftValidationError) => e.type === "rest_11h" || e.type === "four_week_160h",
        );
      }

      const actor = req.session.adminName || "admin";
      const shift = await storage.createShift(parsed, actor);
      res.json({ ...shift, warnings });
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "排班資料格式錯誤" });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/shifts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const existing = await storage.getShift(id);
      if (!existing) return res.status(404).json({ message: "Shift not found" });

      const partial = insertShiftSchema.partial().parse(req.body);
      const employeeId = partial.employeeId || existing.employeeId;
      const date = partial.date || existing.date;
      const startTime = partial.startTime || existing.startTime;
      const endTime = partial.endTime || existing.endTime;

      const employee = await storage.getEmployee(employeeId);
      if (!employee || employee.status !== "active") {
        return res.status(400).json({ message: "該員工非在職狀態，無法排班" });
      }

      const role = partial.role || existing.role;
      const isLeave = LEAVE_TYPES.includes(role as any);
      const isDispatchShift =
        partial.isDispatch !== undefined ? partial.isDispatch : existing.isDispatch;
      let warnings: ShiftValidationError[] = [];

      if (!isLeave && !isDispatchShift) {
        const refConfig = await storage.getSystemConfig("four_week_reference_date");
        const fourWeekRef = refConfig?.value || "2025-01-06";
        const existingShifts = await storage.getShiftsByEmployee(employeeId);
        const period = getFourWeekPeriod(date, fourWeekRef);
        const approvedOT = await storage.getApprovedOvertimeByDateRange(period.start, period.end);
        const otRecords = approvedOT.map((ot) => ({
          employeeId: ot.employeeId,
          date: ot.date,
          startTime: ot.startTime,
          endTime: ot.endTime,
        }));
        const errors = validateAllRules(
          employeeId,
          date,
          startTime,
          endTime,
          existingShifts,
          id,
          fourWeekRef,
          otRecords,
        );
        const blocking = errors.filter(
          (e: ShiftValidationError) =>
            e.type === "seven_day_rest" || e.type === "daily_12h" || e.type === "four_week_176h",
        );
        if (blocking.length > 0) {
          return res.status(400).json({ message: blocking[0].message });
        }
        warnings = errors.filter(
          (e: ShiftValidationError) => e.type === "rest_11h" || e.type === "four_week_160h",
        );
      }

      const actor = req.session.adminName || "admin";
      // Admin direct edit through the UI is an explicit, authorized action.
      const shift = await storage.updateShift(id, partial, actor, true);
      res.json({ ...shift, warnings });
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "排班資料格式錯誤" });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/shifts/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const actor = req.session.adminName || "admin";
    const reason = typeof req.body?.reason === "string" ? req.body.reason : undefined;
    // Admin direct delete through the UI is an explicit, authorized action.
    const deleted = await storage.deleteShift(id, actor, reason, true);
    if (!deleted) return res.status(404).json({ message: "Shift not found or already cancelled" });
    res.json({ success: true });
  });

  app.post("/api/shifts/:id/restore", async (req, res) => {
    const id = parseInt(req.params.id);
    const actor = req.session.adminName || "admin";
    const restored = await storage.restoreShift(id, actor);
    if (!restored) return res.status(404).json({ message: "Shift not found or not cancelled" });
    res.json(restored);
  });

  // ── Batch operations ────────────────────────────────────────────────

  app.post("/api/shifts/batch-delete", async (req, res) => {
    try {
      const { employeeId, venueId, startTime, endTime, role, targetDates, reason } = req.body;
      const empId = Number(employeeId);
      if (!empId || !Array.isArray(targetDates) || targetDates.length === 0) {
        return res.status(400).json({ message: "employeeId and targetDates are required" });
      }
      const actor = req.session.adminName || "admin";
      let deletedCount = 0;
      for (const date of targetDates) {
        const shifts = await storage.getShiftsByEmployeeAndDateRange(empId, date, date);
        const matching = shifts.filter(
          (s) =>
            (!venueId || s.venueId === Number(venueId)) &&
            (!startTime || s.startTime === startTime) &&
            (!endTime || s.endTime === endTime) &&
            (!role || s.role === role),
        );
        for (const s of matching) {
          await storage.deleteShift(s.id, actor, reason, true);
          deletedCount++;
        }
      }
      res.json({ success: true, deletedCount });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/shifts/batch-delete-ids", async (req, res) => {
    try {
      const { shiftIds, reason } = req.body;
      if (!Array.isArray(shiftIds) || shiftIds.length === 0) {
        return res.status(400).json({ message: "shiftIds array is required" });
      }
      const actor = req.session.adminName || "admin";
      const uniqueIds = [...new Set(shiftIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
      let deletedCount = 0;
      for (const numId of uniqueIds) {
        const ok = await storage.deleteShift(numId, actor, reason, true);
        if (ok) deletedCount++;
      }
      res.json({ success: true, deletedCount });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/shifts/batch", async (req, res) => {
    try {
      const { employeeId, venueId, startTime, endTime, role, isDispatch, targetDates, skipExisting, force } = req.body;
      // Task #50 protection: safe-by-default. Active shifts are NEVER
      // overwritten unless caller explicitly sets force=true. Admin UI sends
      // force:true on bulk-replace buttons; automation (ragic sync etc.)
      // omits force and will be blocked at storage layer with a clear error.
      const forceFlag = force === true;
      if (!employeeId || !venueId || !startTime || !endTime || !role || !Array.isArray(targetDates) || targetDates.length === 0) {
        return res.status(400).json({ message: "缺少必要欄位" });
      }

      const employee = await storage.getEmployee(employeeId);
      if (!employee || employee.status !== "active") {
        return res.status(400).json({ message: "該員工非在職狀態，無法排班" });
      }

      const isLeave = LEAVE_TYPES.includes(role);
      const existingShifts = isLeave ? [] : await storage.getShiftsByEmployee(employeeId);
      const refConfig = isLeave ? null : await storage.getSystemConfig("four_week_reference_date");
      const fourWeekRef = refConfig?.value || "2025-01-06";
      let otRecords: { employeeId: number; date: string; startTime: string; endTime: string }[] = [];
      if (!isLeave) {
        const allDates = [...targetDates].sort();
        const pStart = getFourWeekPeriod(allDates[0], fourWeekRef);
        const pEnd = getFourWeekPeriod(allDates[allDates.length - 1], fourWeekRef);
        const approvedOT = await storage.getApprovedOvertimeByDateRange(pStart.start, pEnd.end);
        otRecords = approvedOT.map((ot) => ({
          employeeId: ot.employeeId,
          date: ot.date,
          startTime: ot.startTime,
          endTime: ot.endTime,
        }));
      }
      const results: any[] = [];
      const errors: string[] = [];
      const warnings: string[] = [];

      for (const date of targetDates) {
        const dayShifts = await storage.getShiftsByEmployeeAndDateRange(employeeId, date, date);
        const existingOnDate = dayShifts[0] || null;

        if (!isLeave && !(isDispatch || false)) {
          const dayErrors = validateAllRules(
            employeeId,
            date,
            startTime,
            endTime,
            existingShifts,
            existingOnDate?.id,
            fourWeekRef,
            otRecords,
          );
          const blocking = dayErrors.filter((e: ShiftValidationError) => e.type === "daily_12h");
          if (blocking.length > 0) {
            errors.push(`${date}: ${blocking[0].message}`);
            continue;
          }
          const warnItems = dayErrors.filter(
            (e: ShiftValidationError) =>
              e.type === "rest_11h" ||
              e.type === "four_week_160h" ||
              e.type === "seven_day_rest" ||
              e.type === "four_week_176h",
          );
          for (const w of warnItems) warnings.push(`${date}: ${w.message}`);
        }

        let shift: any;
        if (existingOnDate) {
          if (skipExisting) {
            continue;
          }
          const updated = await storage.updateShift(
            existingOnDate.id,
            {
              venueId: parseInt(venueId),
              startTime,
              endTime,
              role,
              isDispatch: isDispatch || false,
            },
            `system:batch|by:${req.session.adminName || "admin"}`,
            forceFlag,
          );
          shift = updated;
          if (!isLeave) {
            const idx = existingShifts.findIndex((s: any) => s.id === existingOnDate.id);
            if (idx >= 0) Object.assign(existingShifts[idx], updated);
          }
        } else {
          shift = await storage.createShift(
            {
              employeeId,
              venueId: parseInt(venueId),
              date,
              startTime,
              endTime,
              role,
              isDispatch: isDispatch || false,
            },
            `system:batch|by:${req.session.adminName || "admin"}`,
          );
          if (!isLeave) existingShifts.push(shift as any);
        }
        if (shift) results.push(shift);
      }

      res.json({ created: results.length, errors, warnings, shifts: results });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/shifts/import-batch", async (req, res) => {
    try {
      const { shifts: shiftItems, skipExisting, violationMode = "dispatch" } = req.body;
      if (!Array.isArray(shiftItems) || shiftItems.length === 0) {
        return res.status(400).json({ message: "shifts 為必填陣列" });
      }
      if (violationMode !== "warn" && violationMode !== "dispatch") {
        return res.status(400).json({ message: "violationMode 必須為 warn 或 dispatch" });
      }

      const created: any[] = [];
      const skipped: any[] = [];
      const errors: string[] = [];
      const warnings: string[] = [];
      const dispatched: string[] = [];

      const uniqueEmployeeIds = [...new Set(shiftItems.map((s: any) => s.employeeId).filter(Boolean))] as number[];
      const allDates = shiftItems.map((s: any) => s.date as string).filter(Boolean).sort();
      const monthStart = allDates[0];
      const monthEnd = allDates[allDates.length - 1];

      const refConfig = await storage.getSystemConfig("four_week_reference_date");
      const referenceDate = refConfig?.value ?? "2025-01-06";

      // Extend preload range 6 days before monthStart for seven-day-rest boundary checks
      const preloadStart = (() => {
        const d = new Date(monthStart + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() - 6);
        return d.toISOString().split("T")[0];
      })();

      // Cover the full four-week periods that overlap the import range (for 176h checks)
      const periodOfStart = getFourWeekPeriod(monthStart, referenceDate);
      const periodOfEnd = getFourWeekPeriod(monthEnd, referenceDate);
      const otRangeStart = periodOfStart.start < preloadStart ? periodOfStart.start : preloadStart;
      const otRangeEnd = periodOfEnd.end > monthEnd ? periodOfEnd.end : monthEnd;

      const [employeeList, existingShiftsForMonth, approvedOT] = await Promise.all([
        Promise.all(uniqueEmployeeIds.map((id) => storage.getEmployee(id))),
        uniqueEmployeeIds.length > 0
          ? storage.getShiftsByEmployeesAndDateRange(uniqueEmployeeIds, preloadStart, monthEnd)
          : Promise.resolve([]),
        storage.getApprovedOvertimeByDateRange(otRangeStart, otRangeEnd),
      ]);

      const otRecords = approvedOT.map((ot) => ({
        employeeId: ot.employeeId,
        date: ot.date,
        startTime: ot.startTime,
        endTime: ot.endTime,
      }));

      const employeeMap = new Map(employeeList.filter(Boolean).map((e) => [e!.id, e!]));
      const existingByKey = new Map<string, (typeof existingShiftsForMonth)[0]>();
      for (const s of existingShiftsForMonth) {
        if (s.date >= monthStart) {
          existingByKey.set(`${s.employeeId}:${s.date}`, s);
        }
      }

      for (const item of shiftItems) {
        const { employeeId, venueId, date, startTime, endTime, role } = item;
        if (!employeeId || !venueId || !date || !startTime || !endTime || !role) {
          errors.push(`${date}: 缺少必要欄位`);
          continue;
        }

        const employee = employeeMap.get(employeeId);
        if (!employee || employee.status !== "active") {
          errors.push(`${date}: 員工（id=${employeeId}）狀態異常`);
          continue;
        }

        const isLeave = LEAVE_TYPES.includes(role);
        if (!isLeave) {
          const empShifts = existingShiftsForMonth.filter((s) => s.employeeId === employeeId);
          const allErrors = validateAllRules(
            employeeId,
            date,
            startTime,
            endTime,
            empShifts,
            undefined,
            referenceDate,
            otRecords,
          );
          const blocking = allErrors.filter(
            (e: ShiftValidationError) =>
              e.type === "seven_day_rest" || e.type === "daily_12h" || e.type === "four_week_176h",
          );
          const warnItems = allErrors.filter(
            (e: ShiftValidationError) => e.type === "rest_11h" || e.type === "four_week_160h",
          );
          const allViolations = [...blocking, ...warnItems];

          if (violationMode === "warn") {
            // Warn mode: import everything, just collect violations as warnings
            if (allViolations.length > 0) {
              const reason = allViolations
                .map((e) => {
                  if (e.type === "seven_day_rest") return "七休一";
                  if (e.type === "daily_12h") return "超過12h";
                  if (e.type === "four_week_176h") return "四週超176h";
                  if (e.type === "rest_11h") return "輪班間隔不足11h";
                  if (e.type === "four_week_160h") return "四週超160h";
                  return e.type;
                })
                .join("、");
              warnings.push(`${date} ${employee.name}：${reason}`);
            }
          } else {
            // Dispatch mode (default): hard blocks and soft blocks all go to dispatch
            if (blocking.length > 0) {
              const reason = blocking
                .map((e) => {
                  if (e.type === "seven_day_rest") return "七休一";
                  if (e.type === "daily_12h") return "超過12h";
                  if (e.type === "four_week_176h") return "四週超176h";
                  return e.type;
                })
                .join("、");
              try {
                await storage.createDispatchShift({
                  regionId: employee.regionId,
                  venueId,
                  date,
                  startTime,
                  endTime,
                  dispatchName: employee.name,
                  dispatchCompany: null,
                  dispatchPhone: null,
                  role,
                  notes: `匯入轉派遣（${reason}）`,
                });
                dispatched.push(`${date} ${employee.name}（${reason}）`);
              } catch {
                errors.push(`${date} ${employee.name}：${reason}（派遣轉換失敗）`);
              }
              continue;
            }
            if (warnItems.length > 0) {
              // Soft-limit exceeded → auto-create as dispatch shift (no labor law restrictions)
              const reason = warnItems
                .map((e) => (e.type === "rest_11h" ? "輪班間隔不足11h" : "四週工時超160h"))
                .join("、");
              try {
                await storage.createDispatchShift({
                  regionId: employee.regionId,
                  venueId,
                  date,
                  startTime,
                  endTime,
                  dispatchName: employee.name,
                  dispatchCompany: null,
                  dispatchPhone: null,
                  role,
                  notes: `匯入轉派遣（${reason}）`,
                });
                dispatched.push(`${date} ${employee.name}（${reason}）`);
              } catch {
                warnings.push(`${date} ${employee.name}：派遣轉換失敗，${reason}`);
              }
              continue;
            }
          }
        }

        const existingKey = `${employeeId}:${date}`;
        const existingShift = existingByKey.get(existingKey);
        if (existingShift) {
          if (skipExisting) {
            skipped.push({ date, employeeId });
            continue;
          } else {
            const updated = await storage.updateShift(
              existingShift.id,
              { venueId, startTime, endTime, role },
              `system:import-batch|by:${req.session.adminName || "admin"}`,
              true,
            );
            if (updated) {
              created.push(updated);
              existingByKey.set(existingKey, updated);
              const idx = existingShiftsForMonth.findIndex((s) => s.id === existingShift.id);
              if (idx >= 0) Object.assign(existingShiftsForMonth[idx], updated);
            }
            continue;
          }
        }

        const shift = await storage.createShift(
          { employeeId, venueId, date, startTime, endTime, role, isDispatch: false },
          `system:import-batch|by:${req.session.adminName || "admin"}`,
        );
        created.push(shift);
        existingByKey.set(existingKey, shift);
        existingShiftsForMonth.push(shift);
      }

      res.json({ created: created.length, skipped: skipped.length, errors, warnings, dispatched, shifts: created });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/shifts/batch-update", async (req, res) => {
    try {
      const {
        currentShiftId,
        employeeId,
        targetDates,
        venueId,
        startTime,
        endTime,
        role,
        isDispatch,
        matchVenueId,
        matchStartTime,
        matchEndTime,
        matchRole,
      } = req.body;

      if (!currentShiftId || !employeeId || !Array.isArray(targetDates)) {
        return res.status(400).json({ message: "缺少必要欄位" });
      }

      // Task #50 protection: safe-by-default. Active shifts are NEVER
      // overwritten unless caller explicitly sets force=true. Admin UI sends
      // force:true on the "apply to multiple dates" button; automation
      // (ragic sync etc.) is blocked at storage layer with a clear error.
      const forceFlag = req.body.force === true;

      const empId = Number(employeeId);
      const isLeave = LEAVE_TYPES.includes(role);
      const effectiveVenueId = isLeave ? (venueId || 1) : parseInt(venueId);
      const effectiveStart = isLeave ? "00:00" : startTime;
      const effectiveEnd = isLeave ? "00:00" : endTime;

      const updated: any[] = [];
      const errors: string[] = [];
      const warnings: string[] = [];

      const existingShifts = isLeave ? [] : await storage.getShiftsByEmployee(empId);
      const refConfig = isLeave ? null : await storage.getSystemConfig("four_week_reference_date");
      const fourWeekRef = refConfig?.value || "2025-01-06";
      let otRecords: { employeeId: number; date: string; startTime: string; endTime: string }[] = [];
      if (!isLeave) {
        const currentShiftData = existingShifts.find((s: any) => s.id === Number(currentShiftId));
        const allDatesForOT = [currentShiftData?.date, ...targetDates].filter(Boolean).sort() as string[];
        if (allDatesForOT.length > 0) {
          const pStart = getFourWeekPeriod(allDatesForOT[0], fourWeekRef);
          const pEnd = getFourWeekPeriod(allDatesForOT[allDatesForOT.length - 1], fourWeekRef);
          const approvedOT = await storage.getApprovedOvertimeByDateRange(pStart.start, pEnd.end);
          otRecords = approvedOT.map((ot) => ({
            employeeId: ot.employeeId,
            date: ot.date,
            startTime: ot.startTime,
            endTime: ot.endTime,
          }));
        }
      }

      const currentShift = existingShifts.find((s: any) => s.id === Number(currentShiftId));
      const currentDate = currentShift?.date;
      if (!isLeave && !(isDispatch || false) && currentDate) {
        const dayErrors = validateAllRules(
          empId,
          currentDate,
          effectiveStart,
          effectiveEnd,
          existingShifts,
          Number(currentShiftId),
          fourWeekRef,
          otRecords,
        );
        const warnItems = dayErrors.filter(
          (e: ShiftValidationError) => e.type === "rest_11h" || e.type === "four_week_160h",
        );
        for (const w of warnItems) warnings.push(`${currentDate}: ${w.message}`);
      }

      const currentUpdated = await storage.updateShift(
        Number(currentShiftId),
        {
          venueId: effectiveVenueId,
          startTime: effectiveStart,
          endTime: effectiveEnd,
          role,
          isDispatch: isLeave ? false : (isDispatch || false),
        },
        `system:batch-update|by:${req.session.adminName || "admin"}`,
        forceFlag,
      );
      if (currentUpdated) {
        updated.push(currentUpdated);
        const idx = existingShifts.findIndex((s: any) => s.id === Number(currentShiftId));
        if (idx >= 0) Object.assign(existingShifts[idx], currentUpdated);
      }

      for (const date of targetDates) {
        const dayShifts = await storage.getShiftsByEmployeeAndDateRange(empId, date, date);
        const shiftToUpdate = matchVenueId && matchStartTime
          ? (dayShifts.find(
              (s) =>
                s.venueId === Number(matchVenueId) &&
                s.startTime.substring(0, 5) === matchStartTime &&
                s.endTime.substring(0, 5) === matchEndTime &&
                s.role === matchRole,
            ) ||
              dayShifts.find(
                (s) =>
                  s.venueId === Number(matchVenueId) &&
                  s.startTime.substring(0, 5) === matchStartTime,
              ) ||
              dayShifts[0] ||
              null)
          : (dayShifts[0] || null);

        if (!isLeave && !(isDispatch || false)) {
          const dayErrors = validateAllRules(
            empId,
            date,
            effectiveStart,
            effectiveEnd,
            existingShifts,
            shiftToUpdate?.id,
            fourWeekRef,
            otRecords,
          );
          const blocking = dayErrors.filter((e: ShiftValidationError) => e.type === "daily_12h");
          if (blocking.length > 0) {
            errors.push(`${date}: ${blocking[0].message}`);
            continue;
          }
          const warnItems = dayErrors.filter(
            (e: ShiftValidationError) =>
              e.type === "rest_11h" ||
              e.type === "four_week_160h" ||
              e.type === "seven_day_rest" ||
              e.type === "four_week_176h",
          );
          for (const w of warnItems) warnings.push(`${date}: ${w.message}`);
        }

        if (!shiftToUpdate) {
          const created = await storage.createShift(
            {
              employeeId: empId,
              venueId: effectiveVenueId,
              date,
              startTime: effectiveStart,
              endTime: effectiveEnd,
              role,
              isDispatch: isLeave ? false : (isDispatch || false),
            },
            `system:batch-update|by:${req.session.adminName || "admin"}`,
          );
          updated.push(created);
          existingShifts.push(created as any);
        } else {
          const result = await storage.updateShift(
            shiftToUpdate.id,
            {
              venueId: effectiveVenueId,
              startTime: effectiveStart,
              endTime: effectiveEnd,
              role,
              isDispatch: isLeave ? false : (isDispatch || false),
            },
            `system:batch-update|by:${req.session.adminName || "admin"}`,
            forceFlag,
          );
          if (result) {
            updated.push(result);
            const idx = existingShifts.findIndex((s: any) => s.id === shiftToUpdate.id);
            if (idx >= 0) Object.assign(existingShifts[idx], result);
          }
        }
      }

      res.json({ updated: updated.length, errors, warnings, shifts: updated });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/shifts/copy-from-previous", async (req, res) => {
    try {
      const { regionCode, targetYear, targetMonth } = req.body;
      if (!regionCode || !targetYear || !targetMonth) {
        return res.status(400).json({ message: "缺少必要欄位" });
      }
      const region = await storage.getRegionByCode(regionCode);
      if (!region) return res.status(404).json({ message: "找不到區域" });

      const prevDate = new Date(targetYear, targetMonth - 2, 1);
      const prevYear = prevDate.getFullYear();
      const prevMonth = prevDate.getMonth() + 1;
      const prevStart = `${prevYear}-${String(prevMonth).padStart(2, "0")}-01`;
      const prevLastDay = new Date(prevYear, prevMonth, 0).getDate();
      const prevEnd = `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(prevLastDay).padStart(2, "0")}`;

      const targetStart = `${targetYear}-${String(targetMonth).padStart(2, "0")}-01`;
      const targetLastDay = new Date(targetYear, targetMonth, 0).getDate();
      const targetEnd = `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(targetLastDay).padStart(2, "0")}`;

      const existingTargetShifts = await storage.getShiftsByRegionAndDateRange(region.id, targetStart, targetEnd);
      if (existingTargetShifts.length > 0) {
        return res.status(400).json({ message: "目標月份已有排班資料，無法覆蓋" });
      }

      const prevShifts = await storage.getShiftsByRegionAndDateRange(region.id, prevStart, prevEnd);
      if (prevShifts.length === 0) {
        return res.status(400).json({ message: "上個月無排班資料可複製" });
      }

      // Resigned employees keep last month's shifts as a record but are not scheduled into the new month.
      const regionEmployees = await storage.getEmployeesByRegion(region.id);
      const activeEmployeeIds = new Set(regionEmployees.filter((e) => e.status === "active").map((e) => e.id));

      const results: any[] = [];
      const errors: string[] = [];
      let skippedInactive = 0;

      for (const s of prevShifts) {
        if (!activeEmployeeIds.has(s.employeeId)) {
          skippedInactive++;
          continue;
        }
        const dateParts = s.date.split("-");
        const dayOfMonth = parseInt(dateParts[2], 10);
        if (dayOfMonth > targetLastDay) {
          continue;
        }
        const newDate = `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;

        try {
          const shift = await storage.createShift(
            {
              employeeId: s.employeeId,
              venueId: s.venueId,
              date: newDate,
              startTime: s.startTime,
              endTime: s.endTime,
              role: s.role,
              isDispatch: s.isDispatch,
              dispatchCompany: s.dispatchCompany,
              dispatchName: s.dispatchName,
              dispatchPhone: s.dispatchPhone,
            },
            `system:copy-prev|by:${req.session.adminName || "admin"}`,
          );
          results.push(shift);
        } catch (err: any) {
          errors.push(`${newDate}: ${err.message}`);
        }
      }

      const skippedNote = skippedInactive > 0 ? `，略過離職人員 ${skippedInactive} 筆` : "";
      res.json({ created: results.length, skippedInactive, errors, message: `已從${prevMonth}月複製 ${results.length} 筆班表${skippedNote}` });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
