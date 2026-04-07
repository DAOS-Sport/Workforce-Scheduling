import express, { type Express, type Request, type Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { REGIONS_DATA, VENUES_DATA, insertEmployeeSchema, insertVenueSchema, insertShiftSchema, insertScheduleSlotSchema, insertVenueShiftTemplateSchema, insertGuidelineSchema, insertGuidelineAckSchema, type InsertAttendanceRecord, type ShiftValidationError, getFourWeekPeriod, calcShiftHours, sumScheduledHours, getAllPeriodsForMonth } from "@shared/schema";
import { z } from "zod";
import { validateAllRules } from "./labor-validation";
import { syncFromRagic, syncVenuesFromRagic } from "./ragic";

const LEAVE_TYPES = ["休假", "特休", "病假", "事假", "喪假", "公假", "生理假", "國定假"];
import { verifyLineSignature, verifyForwardedRequest, handleLineWebhook, processClockIn, sendShiftReminders, pushToLine, isValidLineUserId, formatClockInMessage, sendWeeklySchedulePush, sendWeeklyLateReport } from "./line-webhook";
import multer from "multer";
import ExcelJS from "exceljs";
import nodemailer from "nodemailer";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Seed required default guidelines if not yet present
  try {
    const existingGuidelines = await storage.getGuidelines("工作規則");
    const hasSickLeave = existingGuidelines.some((g) => g.title === "病假注意事項");
    if (!hasSickLeave) {
      await storage.createGuideline({
        category: "工作規則",
        title: "病假注意事項",
        content: "請病假需於返回上班後三日內提交就診證明（醫院收據或診斷書），否則將視同曠職。如有疑問請洽詢主管或 HR 部門。",
        contentType: "text",
        sortOrder: 10,
        isActive: true,
      });
      console.log("[Seed] 已新增病假注意事項 guideline");
    }
  } catch (e) {
    console.error("[Seed] 初始化 guideline 失敗:", e);
  }

  app.use("/api/anomaly-report", (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.use("/api/anomaly-reports", (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, PATCH, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.use("/api/notification-recipients", (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.use("/api/test-email", (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.post("/api/admin/login", async (req, res) => {
    try {
      const { password } = req.body;
      if (!password) return res.status(400).json({ message: "請輸入密碼" });

      const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
      if (!ADMIN_PASSWORD) return res.status(500).json({ message: "伺服器未設定管理員密碼" });
      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ message: "密碼錯誤" });
      }

      const allEmployees = await storage.getAllEmployees();
      const admin = allEmployees.find(e => e.isAdmin);

      req.session.adminId = admin?.id || 1;
      req.session.adminName = admin?.name || "管理員";
      req.session.adminLineId = "";

      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
          return res.status(500).json({ message: "登入儲存失敗" });
        }
        res.json({ id: req.session.adminId, name: req.session.adminName });
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/me", (req, res) => {
    if (req.session.adminId) {
      res.json({ id: req.session.adminId, name: req.session.adminName });
    } else {
      res.status(401).json({ message: "未登入" });
    }
  });

  app.post("/api/admin/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });

  function requireAdmin(req: Request, res: Response, next: Function) {
    if (req.session.adminId) return next();
    return res.status(401).json({ message: "請先登入管理後台" });
  }

  app.use((req, res, next) => {
    if (!req.path.startsWith("/api/")) return next();
    const openPrefixes = [
      "/api/admin/",
      "/api/portal/",
      "/api/liff/",
      "/api/line/",
      "/api/anomaly-report",
    ];
    if (openPrefixes.some(p => req.path.startsWith(p))) return next();
    requireAdmin(req, res, next);
  });

  app.get("/api/regions", async (_req, res) => {
    const regions = await storage.getRegions();
    res.json(regions);
  });

  app.get("/api/employees-all", async (_req, res) => {
    const allEmployees = await storage.getAllEmployees();
    const filtered = allEmployees.filter((e) => e.status === "active");
    res.json(filtered);
  });

  app.get("/api/employees", async (req, res) => {
    try {
      const { codes } = req.query;
      if (!codes) return res.status(400).json({ message: "codes 查詢參數為必填" });
      const codeList = String(codes).split(",").map(c => c.trim()).filter(Boolean);
      if (codeList.length === 0) return res.json({});
      const allEmployees = await storage.getAllEmployees();
      const result: Record<string, { id: number; name: string; employeeCode: string; status: string }> = {};
      for (const code of codeList) {
        const emp = allEmployees.find(e => e.employeeCode === code);
        if (emp) {
          result[code] = { id: emp.id, name: emp.name, employeeCode: emp.employeeCode, status: emp.status };
        }
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/employees/:regionCode", async (req, res) => {
    const { regionCode } = req.params;
    const region = await storage.getRegionByCode(regionCode);
    if (!region) return res.json([]);
    const allEmployees = regionCode === "D"
      ? await storage.getEmployeesForNeiQin(region.id)
      : await storage.getEmployeesByRegion(region.id);
    const employeesList = allEmployees.filter((e) => e.status === "active");
    res.json(employeesList);
  });

  app.post("/api/employees", async (req, res) => {
    try {
      const parsed = insertEmployeeSchema.parse(req.body);
      const employee = await storage.createEmployee(parsed);
      storage.reconcileDispatchLinks().catch(() => {});
      res.json(employee);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "資料格式錯誤：" + err.errors.map((e: any) => e.message).join(", ") });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/employees/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const partial = insertEmployeeSchema.partial().parse(req.body);
      const employee = await storage.updateEmployee(id, partial);
      if (!employee) return res.status(404).json({ message: "Employee not found" });
      storage.reconcileDispatchLinks().catch(() => {});
      res.json(employee);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "資料格式錯誤" });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/employees/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const deleted = await storage.deleteEmployee(id);
      if (!deleted) return res.status(404).json({ message: "Employee not found" });
      res.json({ message: "Employee deleted" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/venues-all", async (_req, res) => {
    const allVenues = await storage.getAllVenues();
    res.json(allVenues);
  });

  app.get("/api/venues/:regionCode", async (req, res) => {
    const { regionCode } = req.params;
    const region = await storage.getRegionByCode(regionCode);
    if (!region) return res.json([]);
    const venues = await storage.getVenuesByRegion(region.id);
    res.json(venues);
  });

  app.post("/api/venues", async (req, res) => {
    try {
      const parsed = insertVenueSchema.parse(req.body);
      const venue = await storage.createVenue(parsed);
      res.json(venue);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "資料格式錯誤" });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/venues/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const partial = insertVenueSchema.partial().parse(req.body);
      const venue = await storage.updateVenue(id, partial);
      if (!venue) return res.status(404).json({ message: "Venue not found" });
      res.json(venue);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "資料格式錯誤" });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/shifts/:regionCode/:startDate/:endDate", async (req, res) => {
    const { regionCode, startDate, endDate } = req.params;
    const region = await storage.getRegionByCode(regionCode);
    if (!region) return res.json([]);
    const regionShifts = await storage.getShiftsByRegionAndDateRange(region.id, startDate, endDate);
    const dispatchedInShifts = await storage.getDispatchedShiftsToRegion(region.id, startDate, endDate);
    const seenIds = new Set(regionShifts.map(s => s.id));
    const merged = [...regionShifts];
    for (const s of dispatchedInShifts) {
      if (!seenIds.has(s.id)) merged.push(s);
    }
    res.json(merged);
  });

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
      const otRecords = approvedOT.map(ot => ({ employeeId: ot.employeeId, date: ot.date, startTime: ot.startTime, endTime: ot.endTime }));

      const errors = validateAllRules(
        employeeId, date, startTime, endTime,
        existingShifts,
        shiftIdToExclude || undefined,
        fourWeekRef,
        otRecords
      );

      const fourWeekErrors = errors.filter(e => e.type === "four_week_160h" || e.type === "four_week_176h");
      res.json({ warnings: fourWeekErrors });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/shifts", async (req, res) => {
    try {
      const parsed = insertShiftSchema.parse(req.body);

      const employee = await storage.getEmployee(parsed.employeeId);
      if (!employee || employee.status !== "active") {
        return res.status(400).json({ message: "該員工非在職狀態，無法排班" });
      }

      const isLeave = LEAVE_TYPES.includes(parsed.role ?? "");
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
          approvedOT.map(ot => ({ employeeId: ot.employeeId, date: ot.date, startTime: ot.startTime, endTime: ot.endTime }))
        );

        const blocking = errors.filter((e: ShiftValidationError) => e.type === "seven_day_rest" || e.type === "daily_12h" || e.type === "four_week_176h");
        if (blocking.length > 0) {
          return res.status(400).json({ message: blocking[0].message });
        }
        warnings = errors.filter((e: ShiftValidationError) => e.type === "rest_11h" || e.type === "four_week_160h");
      }

      const shift = await storage.createShift(parsed);
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
      const isLeave = LEAVE_TYPES.includes(role);
      const isDispatchShift = partial.isDispatch !== undefined ? partial.isDispatch : existing.isDispatch;
      let warnings: ShiftValidationError[] = [];

      if (!isLeave && !isDispatchShift) {
        const refConfig = await storage.getSystemConfig("four_week_reference_date");
        const fourWeekRef = refConfig?.value || "2025-01-06";
        const existingShifts = await storage.getShiftsByEmployee(employeeId);
        const period = getFourWeekPeriod(date, fourWeekRef);
        const approvedOT = await storage.getApprovedOvertimeByDateRange(period.start, period.end);
        const otRecords = approvedOT.map(ot => ({ employeeId: ot.employeeId, date: ot.date, startTime: ot.startTime, endTime: ot.endTime }));
        const errors = validateAllRules(employeeId, date, startTime, endTime, existingShifts, id, fourWeekRef, otRecords);
        const blocking = errors.filter((e: ShiftValidationError) => e.type === "seven_day_rest" || e.type === "daily_12h" || e.type === "four_week_176h");
        if (blocking.length > 0) {
          return res.status(400).json({ message: blocking[0].message });
        }
        warnings = errors.filter((e: ShiftValidationError) => e.type === "rest_11h" || e.type === "four_week_160h");
      }

      const shift = await storage.updateShift(id, partial);
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
    const deleted = await storage.deleteShift(id);
    if (!deleted) return res.status(404).json({ message: "Shift not found" });
    res.json({ success: true });
  });

  app.post("/api/shifts/batch-delete", async (req, res) => {
    try {
      const { employeeId, venueId, startTime, endTime, role, targetDates } = req.body;
      const empId = Number(employeeId);
      if (!empId || !Array.isArray(targetDates) || targetDates.length === 0) {
        return res.status(400).json({ message: "employeeId and targetDates are required" });
      }
      let deletedCount = 0;
      for (const date of targetDates) {
        const shifts = await storage.getShiftsByEmployeeAndDateRange(empId, date, date);
        const matching = shifts.filter(s =>
          (!venueId || s.venueId === Number(venueId)) &&
          (!startTime || s.startTime === startTime) &&
          (!endTime || s.endTime === endTime) &&
          (!role || s.role === role)
        );
        for (const s of matching) {
          await storage.deleteShift(s.id);
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
      const { shiftIds } = req.body;
      if (!Array.isArray(shiftIds) || shiftIds.length === 0) {
        return res.status(400).json({ message: "shiftIds array is required" });
      }
      const uniqueIds = [...new Set(shiftIds.map(Number).filter(n => Number.isInteger(n) && n > 0))];
      let deletedCount = 0;
      for (const numId of uniqueIds) {
        const ok = await storage.deleteShift(numId);
        if (ok) deletedCount++;
      }
      res.json({ success: true, deletedCount });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/shifts/batch", async (req, res) => {
    try {
      const { employeeId, venueId, startTime, endTime, role, isDispatch, targetDates, skipExisting } = req.body;
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
        otRecords = approvedOT.map(ot => ({ employeeId: ot.employeeId, date: ot.date, startTime: ot.startTime, endTime: ot.endTime }));
      }
      const results: any[] = [];
      const errors: string[] = [];
      const warnings: string[] = [];

      for (const date of targetDates) {
        const dayShifts = await storage.getShiftsByEmployeeAndDateRange(employeeId, date, date);
        const existingOnDate = dayShifts[0] || null;

        if (!isLeave && !(isDispatch || false)) {
          const dayErrors = validateAllRules(employeeId, date, startTime, endTime, existingShifts, existingOnDate?.id, fourWeekRef, otRecords);
          const blocking = dayErrors.filter((e: ShiftValidationError) => e.type === "daily_12h");
          if (blocking.length > 0) {
            errors.push(`${date}: ${blocking[0].message}`);
            continue;
          }
          const warnItems = dayErrors.filter((e: ShiftValidationError) => e.type === "rest_11h" || e.type === "four_week_160h" || e.type === "seven_day_rest" || e.type === "four_week_176h");
          for (const w of warnItems) warnings.push(`${date}: ${w.message}`);
        }

        let shift: any;
        if (existingOnDate) {
          if (skipExisting) {
            continue;
          }
          const updated = await storage.updateShift(existingOnDate.id, {
            venueId: parseInt(venueId),
            startTime,
            endTime,
            role,
            isDispatch: isDispatch || false,
          });
          shift = updated;
          if (!isLeave) {
            const idx = existingShifts.findIndex((s: any) => s.id === existingOnDate.id);
            if (idx >= 0) Object.assign(existingShifts[idx], updated);
          }
        } else {
          shift = await storage.createShift({
            employeeId,
            venueId: parseInt(venueId),
            date,
            startTime,
            endTime,
            role,
            isDispatch: isDispatch || false,
          });
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
        Promise.all(uniqueEmployeeIds.map(id => storage.getEmployee(id))),
        uniqueEmployeeIds.length > 0
          ? storage.getShiftsByEmployeesAndDateRange(uniqueEmployeeIds, preloadStart, monthEnd)
          : Promise.resolve([]),
        storage.getApprovedOvertimeByDateRange(otRangeStart, otRangeEnd),
      ]);

      const otRecords = approvedOT.map(ot => ({ employeeId: ot.employeeId, date: ot.date, startTime: ot.startTime, endTime: ot.endTime }));

      const employeeMap = new Map(
        employeeList.filter(Boolean).map(e => [e!.id, e!])
      );
      const existingByKey = new Map<string, typeof existingShiftsForMonth[0]>();
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
          const empShifts = existingShiftsForMonth.filter(s => s.employeeId === employeeId);
          const allErrors = validateAllRules(employeeId, date, startTime, endTime, empShifts, undefined, referenceDate, otRecords);
          const blocking = allErrors.filter((e: ShiftValidationError) => e.type === "seven_day_rest" || e.type === "daily_12h" || e.type === "four_week_176h");
          const warnItems = allErrors.filter((e: ShiftValidationError) => e.type === "rest_11h" || e.type === "four_week_160h");
          const allViolations = [...blocking, ...warnItems];

          if (violationMode === "warn") {
            // Warn mode: import everything, just collect violations as warnings
            if (allViolations.length > 0) {
              const reason = allViolations.map(e => {
                if (e.type === "seven_day_rest") return "七休一";
                if (e.type === "daily_12h") return "超過12h";
                if (e.type === "four_week_176h") return "四週超176h";
                if (e.type === "rest_11h") return "輪班間隔不足11h";
                if (e.type === "four_week_160h") return "四週超160h";
                return e.type;
              }).join("、");
              warnings.push(`${date} ${employee.name}：${reason}`);
            }
          } else {
            // Dispatch mode (default): hard blocks and soft blocks all go to dispatch
            if (blocking.length > 0) {
              const reason = blocking.map(e => {
                if (e.type === "seven_day_rest") return "七休一";
                if (e.type === "daily_12h") return "超過12h";
                if (e.type === "four_week_176h") return "四週超176h";
                return e.type;
              }).join("、");
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
              const reason = warnItems.map(e => e.type === "rest_11h" ? "輪班間隔不足11h" : "四週工時超160h").join("、");
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
            const updated = await storage.updateShift(existingShift.id, { venueId, startTime, endTime, role });
            if (updated) {
              created.push(updated);
              existingByKey.set(existingKey, updated);
              const idx = existingShiftsForMonth.findIndex(s => s.id === existingShift.id);
              if (idx >= 0) Object.assign(existingShiftsForMonth[idx], updated);
            }
            continue;
          }
        }

        const shift = await storage.createShift({ employeeId, venueId, date, startTime, endTime, role, isDispatch: false });
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
          otRecords = approvedOT.map(ot => ({ employeeId: ot.employeeId, date: ot.date, startTime: ot.startTime, endTime: ot.endTime }));
        }
      }

      const currentShift = existingShifts.find((s: any) => s.id === Number(currentShiftId));
      const currentDate = currentShift?.date;
      if (!isLeave && !(isDispatch || false) && currentDate) {
        const dayErrors = validateAllRules(empId, currentDate, effectiveStart, effectiveEnd, existingShifts, Number(currentShiftId), fourWeekRef, otRecords);
        const warnItems = dayErrors.filter((e: ShiftValidationError) => e.type === "rest_11h" || e.type === "four_week_160h");
        for (const w of warnItems) warnings.push(`${currentDate}: ${w.message}`);
      }

      const currentUpdated = await storage.updateShift(Number(currentShiftId), {
        venueId: effectiveVenueId,
        startTime: effectiveStart,
        endTime: effectiveEnd,
        role,
        isDispatch: isLeave ? false : (isDispatch || false),
      });
      if (currentUpdated) {
        updated.push(currentUpdated);
        const idx = existingShifts.findIndex((s: any) => s.id === Number(currentShiftId));
        if (idx >= 0) Object.assign(existingShifts[idx], currentUpdated);
      }

      for (const date of targetDates) {
        const dayShifts = await storage.getShiftsByEmployeeAndDateRange(empId, date, date);
        const shiftToUpdate = matchVenueId && matchStartTime
          ? (dayShifts.find(s =>
              s.venueId === Number(matchVenueId) &&
              s.startTime.substring(0, 5) === matchStartTime &&
              s.endTime.substring(0, 5) === matchEndTime &&
              s.role === matchRole
            ) || dayShifts.find(s =>
              s.venueId === Number(matchVenueId) &&
              s.startTime.substring(0, 5) === matchStartTime
            ) || dayShifts[0] || null)
          : (dayShifts[0] || null);

        if (!isLeave && !(isDispatch || false)) {
          const dayErrors = validateAllRules(empId, date, effectiveStart, effectiveEnd, existingShifts, shiftToUpdate?.id, fourWeekRef, otRecords);
          const blocking = dayErrors.filter((e: ShiftValidationError) => e.type === "daily_12h");
          if (blocking.length > 0) {
            errors.push(`${date}: ${blocking[0].message}`);
            continue;
          }
          const warnItems = dayErrors.filter((e: ShiftValidationError) => e.type === "rest_11h" || e.type === "four_week_160h" || e.type === "seven_day_rest" || e.type === "four_week_176h");
          for (const w of warnItems) warnings.push(`${date}: ${w.message}`);
        }

        if (!shiftToUpdate) {
          const created = await storage.createShift({
            employeeId: empId,
            venueId: effectiveVenueId,
            date,
            startTime: effectiveStart,
            endTime: effectiveEnd,
            role,
            isDispatch: isLeave ? false : (isDispatch || false),
          });
          updated.push(created);
          existingShifts.push(created as any);
        } else {
          const result = await storage.updateShift(shiftToUpdate.id, {
            venueId: effectiveVenueId,
            startTime: effectiveStart,
            endTime: effectiveEnd,
            role,
            isDispatch: isLeave ? false : (isDispatch || false),
          });
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

      const results: any[] = [];
      const errors: string[] = [];

      for (const s of prevShifts) {
        const dateParts = s.date.split("-");
        const dayOfMonth = parseInt(dateParts[2], 10);
        if (dayOfMonth > targetLastDay) {
          continue;
        }
        const newDate = `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;

        try {
          const shift = await storage.createShift({
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
          });
          results.push(shift);
        } catch (err: any) {
          errors.push(`${newDate}: ${err.message}`);
        }
      }

      res.json({ created: results.length, errors, message: `已從${prevMonth}月複製 ${results.length} 筆班表` });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/dispatch-shifts/:regionCode/:startDate/:endDate", async (req, res) => {
    try {
      const { regionCode, startDate, endDate } = req.params;
      const region = await storage.getRegionByCode(regionCode);
      if (!region) return res.json([]);
      const records = await storage.getDispatchShifts(region.id, startDate, endDate);
      res.json(records);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/dispatch-shifts", async (req, res) => {
    try {
      const { regionCode, venueId, date, startTime, endTime, dispatchName, dispatchCompany, dispatchPhone, role, notes, linkedEmployeeId } = req.body;
      if (!regionCode || !date || !startTime || !endTime || !dispatchName) {
        return res.status(400).json({ message: "缺少必要欄位（區域、日期、時間、派遣人員姓名）" });
      }
      const region = await storage.getRegionByCode(regionCode);
      if (!region) return res.status(404).json({ message: "找不到區域" });
      const record = await storage.createDispatchShift({
        regionId: region.id,
        venueId: venueId || null,
        date,
        startTime,
        endTime,
        dispatchName,
        dispatchCompany: dispatchCompany || null,
        dispatchPhone: dispatchPhone || null,
        role: role || "救生",
        notes: notes || null,
        linkedEmployeeId: linkedEmployeeId || null,
      });
      res.json(record);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/dispatch-shifts/batch-create", async (req, res) => {
    try {
      const { regionCode, dates, venueId, startTime, endTime, dispatchName, dispatchCompany, dispatchPhone, role, notes, linkedEmployeeId } = req.body;
      if (!regionCode || !dates || !Array.isArray(dates) || dates.length === 0 || !startTime || !endTime || !dispatchName) {
        return res.status(400).json({ message: "缺少必要欄位（區域、日期列表、時間、派遣人員姓名）" });
      }
      const region = await storage.getRegionByCode(regionCode);
      if (!region) return res.status(404).json({ message: "找不到區域" });
      const inserts = (dates as string[]).map((date) => ({
        regionId: region.id,
        venueId: venueId || null,
        date,
        startTime,
        endTime,
        dispatchName,
        dispatchCompany: dispatchCompany || null,
        dispatchPhone: dispatchPhone || null,
        role: role || "救生",
        notes: notes || null,
        linkedEmployeeId: linkedEmployeeId || null,
      }));
      const records = await storage.batchCreateDispatchShifts(inserts);
      res.json({ created: records.length, records });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/dispatch-shifts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const existing = await storage.getDispatchShift(id);
      if (!existing) return res.status(404).json({ message: "找不到派遣班次" });
      const { regionCode, ...rest } = req.body;
      const updateData: Record<string, any> = {};
      if (regionCode) {
        const region = await storage.getRegionByCode(regionCode);
        if (!region) return res.status(404).json({ message: "找不到區域" });
        updateData.regionId = region.id;
      }
      const allowedFields = ["venueId", "date", "startTime", "endTime", "dispatchName", "dispatchCompany", "dispatchPhone", "role", "notes", "linkedEmployeeId"];
      for (const field of allowedFields) {
        if (rest[field] !== undefined) updateData[field] = rest[field];
      }
      const updated = await storage.updateDispatchShift(id, updateData);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/dispatch-shifts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteDispatchShift(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/dispatch-shifts/reconcile-links", async (req, res) => {
    try {
      const count = await storage.reconcileDispatchLinks();
      res.json({ updated: count, message: `已自動連結 ${count} 筆派遣班次` });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/schedule-slots/:regionCode/:startDate/:endDate", async (req, res) => {
    const { regionCode, startDate, endDate } = req.params;
    const region = await storage.getRegionByCode(regionCode);
    if (!region) return res.json([]);
    const realSlots = await storage.getScheduleSlotsByRegionAndDateRange(region.id, startDate, endDate);

    const regionVenues = await storage.getVenuesByRegion(region.id);

    const allTemplates: Record<number, any[]> = {};
    for (const v of regionVenues) {
      const tpls = await storage.getVenueShiftTemplates(v.id);
      if (tpls.length > 0) allTemplates[v.id] = tpls;
    }

    const realSlotDates = new Set<string>();
    realSlots.forEach((s) => realSlotDates.add(`${s.venueId}-${s.date}`));

    const virtualSlots: any[] = [];
    let virtualId = -1;

    const start = new Date(startDate + "T00:00:00");
    const end = new Date(endDate + "T00:00:00");
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const dateStr = `${year}-${month}-${day}`;
      const dayOfWeek = d.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const dayType = isWeekend ? "weekend" : "weekday";

      for (const venue of regionVenues) {
        const key = `${venue.id}-${dateStr}`;
        if (realSlotDates.has(key)) continue;

        const tpls = allTemplates[venue.id];
        if (!tpls) continue;

        const matched = tpls.filter((t) => {
          const tDayType = t.dayType.toLowerCase();
          if (isWeekend) return tDayType === "weekend" || tDayType === "假日";
          return tDayType === "weekday" || tDayType === "平日";
        });
        for (const t of matched) {
          virtualSlots.push({
            id: virtualId--,
            venueId: venue.id,
            date: dateStr,
            startTime: t.startTime,
            endTime: t.endTime,
            role: t.role,
            requiredCount: t.requiredCount,
            _fromTemplate: true,
          });
        }
      }
    }

    res.json([...realSlots, ...virtualSlots]);
  });

  app.post("/api/schedule-slots/materialize", async (req, res) => {
    try {
      const { venueId, date, excludeTemplateIds } = req.body;
      if (!venueId || !date) return res.status(400).json({ message: "Missing venueId or date" });

      const venue = await storage.getVenue(venueId);
      if (!venue) return res.status(404).json({ message: "Venue not found" });
      const existingSlots = await storage.getScheduleSlotsByRegionAndDateRange(venue.regionId, date, date);
      const hasReal = existingSlots.some((s) => s.venueId === venueId);
      if (hasReal) return res.json({ message: "Already has real slots", created: 0 });

      const templates = await storage.getVenueShiftTemplates(venueId);
      const d = new Date(date + "T00:00:00");
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      const matched = templates.filter((t) => {
        const dt = t.dayType.toLowerCase();
        return isWeekend ? (dt === "weekend" || dt === "假日") : (dt === "weekday" || dt === "平日");
      });

      const excludeSlots = (excludeTemplateIds || []) as Array<{startTime: string; endTime: string; role: string}>;
      const results = [];
      for (const t of matched) {
        const isExcluded = excludeSlots.some((ex: any) => 
          ex.startTime === t.startTime && ex.endTime === t.endTime && ex.role === t.role
        );
        if (isExcluded) continue;
        const slot = await storage.createScheduleSlot({
          venueId,
          date,
          startTime: t.startTime,
          endTime: t.endTime,
          role: t.role,
          requiredCount: t.requiredCount,
        });
        results.push(slot);
      }
      res.json({ created: results.length, slots: results });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/schedule-slots", async (req, res) => {
    try {
      const parsed = insertScheduleSlotSchema.parse(req.body);
      const slot = await storage.createScheduleSlot(parsed);
      res.json(slot);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "資料格式錯誤" });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/schedule-slots/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const partial = insertScheduleSlotSchema.partial().parse(req.body);
      const slot = await storage.updateScheduleSlot(id, partial);
      if (!slot) return res.status(404).json({ message: "Slot not found" });
      res.json(slot);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "資料格式錯誤" });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/schedule-slots/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const deleted = await storage.deleteScheduleSlot(id);
    if (!deleted) return res.status(404).json({ message: "Slot not found" });
    res.json({ success: true });
  });

  app.post("/api/schedule-slots/batch-copy", async (req, res) => {
    try {
      const { venueId, venueIds, startTime, endTime, role, requiredCount, targetDates } = req.body;
      const resolvedVenueIds: number[] = Array.isArray(venueIds) && venueIds.length > 0 ? venueIds : (venueId ? [venueId] : []);
      if (resolvedVenueIds.length === 0 || !startTime || !endTime || !role || !requiredCount || !Array.isArray(targetDates) || targetDates.length === 0) {
        return res.status(400).json({ message: "缺少必要欄位" });
      }
      const results: any[] = [];
      let skipped = 0;
      for (const vid of resolvedVenueIds) {
        for (const date of targetDates) {
          const existing = await storage.getScheduleSlotsByVenueAndDate(vid, date);
          const duplicate = existing.find(s => s.startTime === startTime && s.endTime === endTime && s.role === role);
          if (duplicate) {
            skipped++;
            continue;
          }
          const slot = await storage.createScheduleSlot({ venueId: vid, date, startTime, endTime, role, requiredCount });
          results.push(slot);
        }
      }
      res.json({ created: results.length, skipped, slots: results });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/venue-requirements/:regionCode", async (req, res) => {
    const { regionCode } = req.params;
    const region = await storage.getRegionByCode(regionCode);
    if (!region) return res.json([]);
    const requirements = await storage.getVenueRequirementsByRegion(region.id);
    res.json(requirements);
  });

  app.get("/api/venue-shift-templates/:venueId", async (req, res) => {
    const venueId = parseInt(req.params.venueId);
    const templates = await storage.getVenueShiftTemplates(venueId);
    res.json(templates);
  });

  app.post("/api/venue-shift-templates", async (req, res) => {
    try {
      const parsed = insertVenueShiftTemplateSchema.parse(req.body);
      const template = await storage.createVenueShiftTemplate(parsed);
      res.json(template);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "資料格式錯誤" });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/venue-shift-templates/batch/:venueId", async (req, res) => {
    try {
      const venueId = parseInt(req.params.venueId);
      const { templates } = req.body;
      if (!Array.isArray(templates)) {
        return res.status(400).json({ message: "templates must be an array" });
      }
      await storage.deleteVenueShiftTemplatesByVenue(venueId);
      const results = [];
      for (const t of templates) {
        const parsed = insertVenueShiftTemplateSchema.parse({ ...t, venueId });
        const created = await storage.createVenueShiftTemplate(parsed);
        results.push(created);
      }
      res.json(results);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "資料格式錯誤" });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/venue-shift-templates/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const deleted = await storage.deleteVenueShiftTemplate(id);
    if (!deleted) return res.status(404).json({ message: "Template not found" });
    res.json({ success: true });
  });

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

  app.get("/api/attendance-uploads", async (_req, res) => {
    const uploads = await storage.getAttendanceUploads();
    res.json(uploads);
  });

  app.post("/api/attendance-upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "請選擇檔案" });
      }
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(req.file.buffer);

      const punchWorksheet = workbook.worksheets.find((ws) => ws.name.includes("打卡紀錄"));
      const punchSheetName = punchWorksheet?.name;
      if (!punchSheetName || !punchWorksheet) {
        return res.status(400).json({ message: "找不到「打卡紀錄」工作表，請確認檔案格式" });
      }

      const resolveCellValue = (v: any): any => {
        if (v === null || v === undefined) return "";
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        if (typeof v === "object") {
          if ("richText" in v && Array.isArray(v.richText))
            return v.richText.map((r: any) => r.text ?? "").join("").trim();
          if ("result" in v) return resolveCellValue(v.result);
          if ("text" in v) return String(v.text).trim();
          if ("hyperlink" in v && "text" in v) return String(v.text).trim();
        }
        return v;
      };

      const punchData: any[][] = [];
      punchWorksheet.eachRow({ includeEmpty: true }, (row) => {
        const values = row.values as any[];
        const rowData = Array.from({ length: Math.max(values.length - 1, 0) }, (_, i) =>
          resolveCellValue(values[i + 1])
        );
        punchData.push(rowData);
      });
      if (punchData.length < 2) {
        return res.status(400).json({ message: "打卡紀錄表無數據" });
      }

      const periodMatch = punchSheetName.match(/(\d{4}\.\d{2}\.\d{2})-(\d{4}\.\d{2}\.\d{2})/);
      let periodStart = "";
      let periodEnd = "";
      if (periodMatch) {
        periodStart = periodMatch[1].replace(/\./g, "-");
        periodEnd = periodMatch[2].replace(/\./g, "-");
      }

      const headers = punchData[0].map((h: any) => String(h).trim());
      const requiredHeaders = ["員工編號", "姓名", "打卡日期"];
      const missingHeaders = requiredHeaders.filter((h) => !headers.includes(h));
      if (missingHeaders.length > 0) {
        return res.status(400).json({ message: `打卡紀錄表缺少必要欄位：${missingHeaders.join(", ")}` });
      }

      const colIdx = (name: string) => {
        const idx = headers.indexOf(name);
        return idx;
      };

      const safeGet = (row: any[], name: string): string => {
        const idx = colIdx(name);
        if (idx < 0 || idx >= row.length) return "";
        const val = row[idx];
        if (val === null || val === undefined) return "";
        return String(val).trim();
      };

      const records: InsertAttendanceRecord[] = [];
      const uploadRecord = await storage.createAttendanceUpload({
        fileName: req.file.originalname,
        periodStart: periodStart || "2026-01-01",
        periodEnd: periodEnd || "2026-01-31",
        totalRecords: 0,
      });

      const clean = (val: string) => {
        return val === "--" || val === "" ? null : val;
      };

      for (let i = 1; i < punchData.length; i++) {
        const row = punchData[i];
        const empCode = safeGet(row, "員工編號");
        const empName = safeGet(row, "姓名");
        if (!empCode || !empName) continue;

        const rawDate = safeGet(row, "打卡日期");
        if (!rawDate) continue;
        const dateStr = rawDate.replace(/\//g, "-");

        const lateVal = safeGet(row, "遲到");
        const earlyVal = safeGet(row, "早退");
        const anomalyVal = clean(safeGet(row, "出勤異常"));

        records.push({
          uploadId: uploadRecord.id,
          employeeCode: empCode,
          employeeName: empName,
          department: clean(safeGet(row, "部門")),
          date: dateStr,
          dayType: clean(safeGet(row, "日期類別")),
          shiftType: clean(safeGet(row, "班別")),
          scheduledStart: clean(safeGet(row, "表定上班時間")),
          scheduledEnd: clean(safeGet(row, "表定下班時間")),
          clockIn: clean(safeGet(row, "上班打卡時間")),
          clockOut: clean(safeGet(row, "下班打卡時間")),
          isLate: lateVal !== "" && lateVal !== "--" && lateVal !== "0" && lateVal !== "00:00:00",
          isEarlyLeave: earlyVal !== "" && earlyVal !== "--" && earlyVal !== "0" && earlyVal !== "00:00:00",
          hasAnomaly: anomalyVal !== null && anomalyVal !== "",
          anomalyNote: anomalyVal,
          leaveHours: clean(safeGet(row, "請假時數")),
          leaveType: clean(safeGet(row, "假別")),
          overtimeHours: clean(safeGet(row, "加班時數")),
          clockInMethod: clean(safeGet(row, "上班打卡方式")),
          clockInLocation: clean(safeGet(row, "上班打卡地點")),
          clockOutMethod: clean(safeGet(row, "下班打卡方式")),
          clockOutLocation: clean(safeGet(row, "下班打卡地點")),
        });
      }

      const savedRecords = await storage.createAttendanceRecords(records);

      await storage.updateAttendanceUpload(uploadRecord.id, { totalRecords: savedRecords.length });

      res.json({
        uploadId: uploadRecord.id,
        fileName: req.file.originalname,
        periodStart,
        periodEnd,
        totalRecords: savedRecords.length,
        message: `成功匯入 ${savedRecords.length} 筆打卡紀錄`,
      });
    } catch (err: any) {
      console.error("Upload error:", err);
      res.status(500).json({ message: "匯入失敗：" + err.message });
    }
  });

  app.get("/api/attendance-records/:uploadId", async (req, res) => {
    const uploadId = parseInt(req.params.uploadId);
    const records = await storage.getAttendanceRecordsByUpload(uploadId);
    res.json(records);
  });

  app.get("/api/attendance-records", async (req, res) => {
    const { startDate, endDate, employeeCodes } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ message: "請提供 startDate 和 endDate" });
    }
    const codes = employeeCodes ? String(employeeCodes).split(",") : undefined;
    const records = await storage.getAttendanceRecordsByDateRange(
      String(startDate),
      String(endDate),
      codes
    );
    res.json(records);
  });

  app.delete("/api/attendance-upload/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    await storage.deleteAttendanceRecordsByUpload(id);
    const deleted = await storage.deleteAttendanceUpload(id);
    if (!deleted) return res.status(404).json({ message: "Upload not found" });
    res.json({ success: true });
  });

  app.get("/api/guidelines", async (req, res) => {
    const { category } = req.query;
    const items = await storage.getGuidelines(category ? String(category) : undefined);
    res.json(items);
  });

  app.get("/api/guidelines/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const item = await storage.getGuideline(id);
    if (!item) return res.status(404).json({ message: "守則未找到" });
    res.json(item);
  });

  app.post("/api/guidelines", async (req, res) => {
    try {
      const parsed = insertGuidelineSchema.parse(req.body);
      const item = await storage.createGuideline(parsed);
      res.json(item);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "資料格式錯誤" });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/guidelines/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const partial = insertGuidelineSchema.partial().parse(req.body);
      const item = await storage.updateGuideline(id, partial);
      if (!item) return res.status(404).json({ message: "守則未找到" });
      res.json(item);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "資料格式錯誤" });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/guidelines/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const deleted = await storage.deleteGuideline(id);
    if (!deleted) return res.status(404).json({ message: "守則未找到" });
    res.json({ success: true });
  });

  app.get("/api/guidelines/:id/acknowledgments", async (req, res) => {
    const id = parseInt(req.params.id);
    const acks = await storage.getGuidelineAcks(id);
    res.json(acks);
  });

  app.post("/api/guideline-ack", async (req, res) => {
    try {
      const parsed = insertGuidelineAckSchema.parse(req.body);
      const ack = await storage.createGuidelineAck(parsed);
      res.json(ack);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "資料格式錯誤" });
      }
      res.status(400).json({ message: err.message });
    }
  });

  const isDevMode = process.env.NODE_ENV !== "production";

  app.get("/api/portal/dev-employees", async (_req, res) => {
    if (!isDevMode) return res.status(404).json({ message: "Not found" });
    try {
      const regionIds = [1, 2, 3];
      const allEmployees: any[] = [];
      for (const rid of regionIds) {
        const emps = await storage.getEmployeesByRegion(rid);
        for (const e of emps) {
          if (e.status === "active") {
            allEmployees.push({ id: e.id, name: e.name, employeeCode: e.employeeCode, role: e.role });
          }
        }
      }
      res.json(allEmployees);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/portal/dev-login", async (req, res) => {
    if (!isDevMode) return res.status(404).json({ message: "Not found" });
    try {
      const { employeeId } = req.body;
      if (!employeeId) return res.status(400).json({ message: "缺少員工 ID" });
      const regionIds = [1, 2, 3];
      let found: any = null;
      for (const rid of regionIds) {
        const emps = await storage.getEmployeesByRegion(rid);
        found = emps.find((e) => e.id === employeeId);
        if (found) break;
      }
      if (!found) return res.status(404).json({ message: "找不到員工" });
      if (found.status !== "active") return res.status(403).json({ message: "此帳號已停用" });
      res.json({ id: found.id, name: found.name, employeeCode: found.employeeCode, role: found.role });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/portal/line-callback", async (req, res) => {
    try {
      const { code, redirectUri } = req.body;
      if (!code) return res.status(400).json({ message: "缺少授權碼" });

      const channelId = process.env.LINE_CHANNEL_ID;
      const channelSecret = process.env.LINE_LOGIN_CHANNEL_SECRET || process.env.LINE_CHANNEL_SECRET;
      if (!channelId || !channelSecret) {
        return res.status(500).json({ message: "LINE Login 尚未設定" });
      }

      const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: channelId,
          client_secret: channelSecret,
        }),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        console.error("LINE token error:", errText);
        return res.status(401).json({ message: "LINE 授權失敗" });
      }

      const tokenData = await tokenRes.json();
      const accessToken = tokenData.access_token;

      const profileRes = await fetch("https://api.line.me/v2/profile", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!profileRes.ok) {
        return res.status(401).json({ message: "無法取得 LINE 個人資料" });
      }

      const profile = await profileRes.json();
      const lineUserId = profile.userId;

      let employee = await storage.getEmployeeByLineId(lineUserId);

      if (!employee) {
        const allEmps = await storage.getAllEmployees();
        const matchByInvalidId = allEmps.find(e =>
          e.lineId && !isValidLineUserId(e.lineId) && e.lineId === lineUserId
        );
        if (matchByInvalidId) {
          employee = matchByInvalidId;
        }
      }

      if (!employee) {
        return res.status(404).json({
          message: "您的帳號尚未綁定。\n\n請回到 LINE 官方帳號，傳送您的「員工編號」即可自動綁定。\n綁定完成後再重新登入此頁面。",
          lineUserId,
          displayName: profile.displayName,
          notBound: true,
        });
      }

      if (employee.status !== "active") {
        return res.status(403).json({ message: "此帳號已停用" });
      }

      if (!employee.lineId || !isValidLineUserId(employee.lineId)) {
        await storage.updateEmployee(employee.id, { lineId: lineUserId });
        console.log(`[Portal] 自動回寫 LINE ID: ${employee.name}(${employee.employeeCode}) → ${lineUserId}`);
      }

      res.json({
        id: employee.id,
        name: employee.name,
        employeeCode: employee.employeeCode,
        role: employee.role,
        lineDisplayName: profile.displayName,
        lineUserId,
      });
    } catch (err: any) {
      console.error("LINE callback error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/portal/verify", async (req, res) => {
    try {
      const { lineId } = req.body;
      if (!lineId) return res.status(400).json({ message: "缺少 LINE ID" });
      const employee = await storage.getEmployeeByLineId(lineId);
      if (!employee) return res.status(404).json({ message: "找不到此 LINE 帳號對應的員工資料" });
      if (employee.status !== "active") return res.status(403).json({ message: "此帳號已停用" });
      res.json({
        id: employee.id,
        name: employee.name,
        employeeCode: employee.employeeCode,
        role: employee.role,
        lineUserId: lineId,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/portal/my-shifts/:employeeId/:startDate/:endDate", async (req, res) => {
    try {
      const employeeId = parseInt(req.params.employeeId);
      const { startDate, endDate } = req.params;
      const myShifts = await storage.getShiftsByEmployeeAndDateRange(employeeId, startDate, endDate);

      const emp = await storage.getEmployee(employeeId);
      // Canonical role map — handles both English legacy keys and all Chinese DB variants.
      // 櫃台 / 櫃檯 / 櫃臺 are all treated as the same.
      const empRoleMap: Record<string, string> = {
        lifeguard: "救生", counter: "櫃檯", cleaning: "清潔", manager: "管理",
        救生: "救生", 守望: "守望",
        櫃台: "櫃檯", 櫃檯: "櫃檯", 櫃臺: "櫃檯",
        清潔: "清潔", 主管職: "管理", 教練: "教練", 無職: "無職",
        行政: "行政", 指導員: "教練", 機電: "機電", 行政專員: "行政", 資訊工程師: "資訊",
        資訊班: "資訊", 在校實習: "無職",
      };

      const venueIds = Array.from(new Set(myShifts.map((s) => s.venueId)));
      const venueMap: Record<number, any> = {};
      for (const vid of venueIds) {
        const v = await storage.getVenue(vid);
        if (v) venueMap[vid] = { id: v.id, name: v.name, shortName: v.shortName };
      }

      const slotsCache: Record<string, any[]> = {};
      const getSlotsForVenueDate = async (venueId: number, date: string) => {
        const key = `${venueId}-${date}`;
        if (!slotsCache[key]) {
          slotsCache[key] = await storage.getScheduleSlotsByVenueAndDate(venueId, date);
        }
        return slotsCache[key];
      };

      const enriched = await Promise.all(myShifts.map(async (s) => {
        const slots = await getSlotsForVenueDate(s.venueId, s.date);
        const shiftStart = s.startTime.slice(0, 5);
        const shiftEnd = s.endTime.slice(0, 5);
        const matchedSlot = slots.find((sl) =>
          sl.startTime.slice(0, 5) <= shiftStart && sl.endTime.slice(0, 5) >= shiftEnd
        ) || slots.find((sl) =>
          sl.startTime.slice(0, 5) <= shiftStart && shiftStart < sl.endTime.slice(0, 5)
        );
        const assignedRole = matchedSlot?.role || (emp ? empRoleMap[emp.role] : null) || null;
        return {
          ...s,
          venue: venueMap[s.venueId] || null,
          assignedRole,
        };
      }));
      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/portal/today-coworkers/:employeeId", async (req, res) => {
    try {
      const employeeId = parseInt(req.params.employeeId);
      const taiwanNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
      const today = `${taiwanNow.getFullYear()}-${String(taiwanNow.getMonth() + 1).padStart(2, "0")}-${String(taiwanNow.getDate()).padStart(2, "0")}`;

      // Map both English and Chinese DB role values to the canonical display string.
      // 櫃台 / 櫃檯 / 櫃臺 are all treated as the same.
      const empRoleMap: Record<string, string> = {
        lifeguard: "救生", counter: "櫃檯", cleaning: "清潔", manager: "管理",
        救生: "救生", 守望: "守望",
        櫃台: "櫃檯", 櫃檯: "櫃檯", 櫃臺: "櫃檯",
        清潔: "清潔", 主管職: "管理", 教練: "教練", 無職: "無職",
        行政: "行政", 指導員: "教練", 機電: "機電", 行政專員: "行政", 資訊工程師: "資訊",
        資訊班: "資訊", 在校實習: "無職",
      };

      const emp = await storage.getEmployee(employeeId);
      if (!emp) return res.json([]);

      // 取同區域今日所有班次
      const regionShifts = await storage.getShiftsByRegionAndDateRange(emp.regionId, today, today);
      if (regionShifts.length === 0) return res.json([]);

      // 取出本人班次用於時段重疊過濾
      const myShifts = regionShifts.filter(s => s.employeeId === employeeId);

      // 依場館分組（排除自己，只保留與本人班次時段有重疊的）
      const venueMap = new Map<number, typeof regionShifts>();
      for (const s of regionShifts) {
        if (s.employeeId === employeeId) continue;
        const cwStart = s.startTime.slice(0, 5);
        const cwEnd = s.endTime.slice(0, 5);
        const overlaps = myShifts.some(my =>
          cwStart < my.endTime.slice(0, 5) && cwEnd > my.startTime.slice(0, 5)
        );
        if (!overlaps) continue;
        if (!venueMap.has(s.venueId)) venueMap.set(s.venueId, []);
        venueMap.get(s.venueId)!.push(s);
      }

      if (venueMap.size === 0) return res.json([]);

      // 預先載入所有需要的員工資料
      const allEmpIds = Array.from(new Set(regionShifts.filter(s => s.employeeId !== employeeId).map(s => s.employeeId)));
      const allEmps = await Promise.all(allEmpIds.map(id => storage.getEmployee(id)));
      const empById = new Map(allEmps.filter(Boolean).map(e => [e!.id, e!]));

      const result: any[] = [];
      for (const [venueId, venueShifts] of venueMap) {
        const venue = await storage.getVenue(venueId);
        const slots = await storage.getScheduleSlotsByVenueAndDate(venueId, today);

        const coworkers = venueShifts.map((s) => {
          const coworker = empById.get(s.employeeId);
          if (!coworker) return null;
          let shiftRole = empRoleMap[coworker.role] || coworker.role;
          const cwStart = s.startTime.slice(0, 5);
          const cwEnd = s.endTime.slice(0, 5);
          // Only let schedule-slot roles override lifeguard-type employees.
          // Counter / cleaning / manager employees always keep their own role.
          const isLifeguardType = ["lifeguard", "救生", "守望"].includes(coworker.role);
          if (isLifeguardType) {
            const matchedSlot = slots.find((sl) =>
              sl.startTime.slice(0, 5) <= cwStart && sl.endTime.slice(0, 5) >= cwEnd
            ) || slots.find((sl) =>
              sl.startTime.slice(0, 5) <= cwStart && cwStart < sl.endTime.slice(0, 5)
            );
            if (matchedSlot) shiftRole = matchedSlot.role;
          }
          return {
            id: coworker.id,
            name: coworker.name,
            phone: coworker.phone,
            role: coworker.role,
            shiftRole,
            shiftTime: `${cwStart}-${cwEnd}`,
          };
        }).filter(Boolean);

        if (coworkers.length === 0) continue;

        result.push({
          venue: venue ? { id: venue.id, shortName: venue.shortName } : null,
          coworkers,
        });
      }

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/portal/guidelines-check/:employeeId", async (req, res) => {
    try {
      const employeeId = parseInt(req.params.employeeId);
      const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      const myShifts = await storage.getShiftsByEmployeeAndDateRange(employeeId, monthStart, monthEnd);
      const myVenueIds = Array.from(new Set(myShifts.map((s) => s.venueId)));

      const allGuidelines = await storage.getGuidelines();
      const activeGuidelines = allGuidelines.filter((g) => g.isActive);

      const relevant = activeGuidelines.filter((g) => {
        if (g.category === "fixed") {
          if (g.venueId) return myVenueIds.includes(g.venueId);
          return true;
        }
        if (g.category === "monthly") {
          return g.yearMonth === yearMonth;
        }
        if (g.category === "confidentiality") return true;
        return false;
      });

      const acks = await storage.getGuidelineAcksByEmployee(employeeId);
      const ackedIds = new Set(acks.map((a) => a.guidelineId));

      const currentMonthAcks = acks.filter((a) => {
        if (!a.acknowledgedAt) return false;
        const ackDate = new Date(a.acknowledgedAt);
        return ackDate.getFullYear() === now.getFullYear() && ackDate.getMonth() === now.getMonth();
      });
      const currentMonthAckedIds = new Set(currentMonthAcks.map((a) => a.guidelineId));

      const venueMap: Record<number, string> = {};
      for (const vid of myVenueIds) {
        const v = await storage.getVenue(vid);
        if (v) venueMap[vid] = v.shortName;
      }

      const items = relevant.map((g) => ({
        ...g,
        venueName: g.venueId ? venueMap[g.venueId] || null : null,
        acknowledged: currentMonthAckedIds.has(g.id),
      }));

      const allAcknowledged = items.every((i) => i.acknowledged);

      res.json({ items, allAcknowledged });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/portal/acknowledge-all", async (req, res) => {
    try {
      const { employeeId, guidelineIds } = req.body;
      if (!employeeId || !Array.isArray(guidelineIds)) {
        return res.status(400).json({ message: "缺少必要參數" });
      }

      const existingAcks = await storage.getGuidelineAcksByEmployee(employeeId);
      const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
      const existingThisMonth = existingAcks.filter((a) => {
        if (!a.acknowledgedAt) return false;
        const d = new Date(new Date(a.acknowledgedAt).toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      });
      const alreadyAckedIds = new Set(existingThisMonth.map((a) => a.guidelineId));

      const toAck = guidelineIds.filter((id: number) => !alreadyAckedIds.has(id));
      for (const gid of toAck) {
        await storage.createGuidelineAck({ guidelineId: gid, employeeId });
      }

      res.json({ success: true, acknowledged: toAck.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/portal/my-attendance/:employeeId", async (req, res) => {
    try {
      const employeeId = parseInt(req.params.employeeId);
      const employee = await storage.getEmployee(employeeId);
      if (!employee) return res.status(404).json({ message: "找不到員工" });

      const taiwanNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
      const monthStart = `${taiwanNow.getFullYear()}-${String(taiwanNow.getMonth() + 1).padStart(2, "0")}-01`;
      const lastDay = new Date(taiwanNow.getFullYear(), taiwanNow.getMonth() + 1, 0).getDate();
      const monthEnd = `${taiwanNow.getFullYear()}-${String(taiwanNow.getMonth() + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      const records = await storage.getAttendanceRecordsByDateRange(monthStart, monthEnd, [employee.employeeCode]);

      const clockRecords = await storage.getClockRecordsByEmployee(employeeId, monthStart, monthEnd);

      const shifts = await storage.getShiftsByEmployeeAndDateRange(employeeId, monthStart, monthEnd);

      const todayStr = `${taiwanNow.getFullYear()}-${String(taiwanNow.getMonth() + 1).padStart(2, "0")}-${String(taiwanNow.getDate()).padStart(2, "0")}`;
      const todayClocks = clockRecords
        .filter((cr) => {
          if (!cr.clockTime) return false;
          const d = new Date(new Date(cr.clockTime).toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
          const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          return ds === todayStr;
        })
        .sort((a, b) => new Date(b.clockTime!).getTime() - new Date(a.clockTime!).getTime());
      const latestClockToday = todayClocks[0] ?? null;
      const todayClockInRecord = todayClocks.find(cr => cr.clockType === "in" && (cr.status === "success" || cr.status === "warning")) ?? null;
      const todayClockOutRecord = [...todayClocks].find(cr => cr.clockType === "out" && (cr.status === "success" || cr.status === "warning")) ?? null;

      // Build a map of GPS clock records grouped by Taiwan date for easy lookup
      const gpsDateMap = new Map<string, typeof clockRecords>();
      for (const cr of clockRecords) {
        if (!cr.clockTime) continue;
        const d = new Date(new Date(cr.clockTime).toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
        const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        if (!gpsDateMap.has(ds)) gpsDateMap.set(ds, []);
        gpsDateMap.get(ds)!.push(cr);
      }

      // Map xlsx records (priority source)
      const xlsxDates = new Set(records.map((r) => r.date));
      const xlsxRows = records.map((r) => {
        const dateShifts = shifts.filter((s) => s.date === r.date);
        const shiftInfo = dateShifts.length > 0
          ? dateShifts.map((s) => `${s.startTime.substring(0, 5)}-${s.endTime.substring(0, 5)}`).join(", ")
          : r.scheduledStart && r.scheduledEnd
            ? `${r.scheduledStart}-${r.scheduledEnd}`
            : null;

        // Sort by clockTime ascending so earliest clock-in and latest clock-out are
        // correctly identified even if an employee accidentally tapped multiple times.
        const dateClockRecords = (gpsDateMap.get(r.date) || [])
          .filter(Boolean)
          .sort((a, b) => new Date(a.clockTime ?? 0).getTime() - new Date(b.clockTime ?? 0).getTime());
        const clockInRecord = dateClockRecords.find((cr) => cr.clockType === "in");   // earliest in
        const clockOutRecord = [...dateClockRecords].reverse().find((cr) => cr.clockType === "out"); // latest out

        return {
          date: r.date,
          clockIn: clockInRecord && clockInRecord.clockTime
            ? new Date(clockInRecord.clockTime).toLocaleTimeString("en-US", { timeZone: "Asia/Taipei", hour12: false, hour: "2-digit", minute: "2-digit" })
            : r.clockIn || null,
          clockOut: clockOutRecord && clockOutRecord.clockTime
            ? new Date(clockOutRecord.clockTime).toLocaleTimeString("en-US", { timeZone: "Asia/Taipei", hour12: false, hour: "2-digit", minute: "2-digit" })
            : r.clockOut || null,
          isLate: r.isLate,
          isEarlyLeave: r.isEarlyLeave,
          hasAnomaly: r.hasAnomaly,
          leaveType: r.leaveType,
          shiftInfo,
          shiftType: r.shiftType || null,
        };
      });

      // Synthesize rows from GPS records for dates not covered by xlsx
      const gpsRows: typeof xlsxRows = [];
      for (const [dateStr, dayClocks] of Array.from(gpsDateMap.entries())) {
        if (xlsxDates.has(dateStr)) continue;
        // Sort ascending by clockTime so we always pick earliest clock-in and latest
        // clock-out — this handles accidental double-taps during the shift gracefully.
        const validClocks = dayClocks
          .filter((cr) => cr.status === "success" || cr.status === "warning")
          .sort((a, b) => new Date(a.clockTime ?? 0).getTime() - new Date(b.clockTime ?? 0).getTime());
        const clockInRecord = validClocks.find((cr) => cr.clockType === "in");   // earliest in
        const clockOutRecord = [...validClocks].reverse().find((cr) => cr.clockType === "out"); // latest out
        if (!clockInRecord) continue; // no valid clock-in, skip this date

        const dateShifts = shifts.filter((s) => s.date === dateStr);
        const shiftInfo = dateShifts.length > 0
          ? dateShifts.map((s) => `${s.startTime.substring(0, 5)}-${s.endTime.substring(0, 5)}`).join(", ")
          : null;

        const gpsMissingOut = !clockOutRecord;

        const clockInStr = new Date(clockInRecord.clockTime!).toLocaleTimeString("en-US", { timeZone: "Asia/Taipei", hour12: false, hour: "2-digit", minute: "2-digit" });
        const clockOutStr = clockOutRecord?.clockTime
          ? new Date(clockOutRecord.clockTime).toLocaleTimeString("en-US", { timeZone: "Asia/Taipei", hour12: false, hour: "2-digit", minute: "2-digit" })
          : null;

        // Compare against scheduled shift time (first shift of the day)
        let gpsIsLate = false;
        let gpsIsEarlyLeave = false;
        let gpsHasAnomaly = gpsMissingOut && dateStr < todayStr; // missing clock-out on past date

        if (dateShifts.length > 0) {
          const sched = dateShifts[0];
          const schedStart = sched.startTime.slice(0, 5); // "HH:MM"
          const schedEnd = sched.endTime.slice(0, 5);

          // Late: clocked in more than 10 minutes after scheduled start
          const [sH, sM] = schedStart.split(":").map(Number);
          const [iH, iM] = clockInStr.split(":").map(Number);
          const lateMinutes = (iH * 60 + iM) - (sH * 60 + sM);
          if (lateMinutes > 10) gpsIsLate = true;

          if (clockOutStr) {
            const [eH, eM] = schedEnd.split(":").map(Number);
            const [oH, oM] = clockOutStr.split(":").map(Number);
            const earlyMinutes = (eH * 60 + eM) - (oH * 60 + oM);
            // Early leave: clocked out more than 10 minutes before scheduled end
            if (earlyMinutes > 10) gpsIsEarlyLeave = true;
            // Anomaly: clock-in and clock-out at exact same time (0-duration punch)
            if (clockInStr === clockOutStr) gpsHasAnomaly = true;
          }
        }

        gpsRows.push({
          date: dateStr,
          clockIn: clockInStr,
          clockOut: clockOutStr,
          isLate: gpsIsLate,
          isEarlyLeave: gpsIsEarlyLeave,
          hasAnomaly: gpsHasAnomaly,
          leaveType: null,
          shiftInfo,
          shiftType: dateShifts[0]?.shiftType || null,
        });
      }

      const allRows = [...xlsxRows, ...gpsRows].sort((a, b) => b.date.localeCompare(a.date));

      const summary = {
        total: allRows.length,
        late: allRows.filter((r) => r.isLate).length,
        earlyLeave: allRows.filter((r) => r.isEarlyLeave).length,
        anomaly: allRows.filter((r) => r.hasAnomaly).length,
        leave: records.filter((r) => r.leaveHours && r.leaveHours.trim() !== "").length,
        todayLatestClock: latestClockToday
          ? { clockType: latestClockToday.clockType, clockTime: latestClockToday.clockTime!.toISOString() }
          : null,
        todayClockIn: todayClockInRecord
          ? { clockTime: todayClockInRecord.clockTime!.toISOString() }
          : null,
        todayClockOut: todayClockOutRecord
          ? { clockTime: todayClockOutRecord.clockTime!.toISOString() }
          : null,
        records: allRows,
      };

      res.json(summary);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/ragic-venue-sync", async (_req, res) => {
    try {
      const result = await syncVenuesFromRagic();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/ragic-sync", async (_req, res) => {
    try {
      const result = await syncFromRagic();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/send-shift-reminders", async (req, res) => {
    try {
      const force = req.body?.force === true;
      const result = await sendShiftReminders(force);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/trigger-weekly-schedule", async (req, res) => {
    if (!req.session.adminId) {
      return res.status(401).json({ message: "未登入" });
    }
    try {
      const force = req.body?.force === true; // default false (respect dedup)
      const result = await sendWeeklySchedulePush(force);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/trigger-weekly-late-report", async (req, res) => {
    if (!req.session.adminId) {
      return res.status(401).json({ message: "未登入" });
    }
    try {
      const force = req.body?.force === true; // default false (respect dedup)
      const result = await sendWeeklyLateReport(force);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/line/webhook", async (req: Request, res: Response) => {
    const signature = req.headers["x-line-signature"] as string;
    const forwardSecret = req.headers["x-forward-secret"] as string;
    const rawBody = req.rawBody ? Buffer.from(req.rawBody as any).toString("utf8") : JSON.stringify(req.body);

    const isDirectLine = signature && verifyLineSignature(rawBody, signature);
    const isForwarded = forwardSecret && verifyForwardedRequest(forwardSecret);

    if (!isDirectLine && !isForwarded) {
      console.error("[LINE Webhook] Authentication failed (neither LINE signature nor forward secret valid)");
      res.status(403).json({ message: "Invalid signature" });
      return;
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (isForwarded) {
      console.log("[LINE Webhook] Received forwarded request with", (body.events || []).length, "events");
    }
    res.status(200).json({ status: "ok" });

    try {
      await handleLineWebhook(body);
    } catch (err) {
      console.error("[LINE Webhook] Error handling event:", err);
    }
  });

  app.post("/api/liff/clock-in", async (req: Request, res: Response) => {
    try {
      const { lineUserId, employeeId, latitude, longitude, accuracy, clockType } = req.body;
      if ((!lineUserId && !employeeId) || latitude === undefined || longitude === undefined) {
        return res.status(400).json({ message: "lineUserId or employeeId, latitude, longitude are required" });
      }
      console.log(`[Clock-in] User: ${lineUserId || `emp#${employeeId}`}, Lat: ${latitude}, Lng: ${longitude}, Accuracy: ${accuracy}m, Type: ${clockType || "auto"}`);

      if (lineUserId && isValidLineUserId(lineUserId)) {
        const emp = await storage.getEmployeeByLineId(lineUserId);
        if (emp && (!emp.lineId || !isValidLineUserId(emp.lineId))) {
          await storage.updateEmployee(emp.id, { lineId: lineUserId });
          console.log(`[LIFF] 自動回寫 LINE ID: ${emp.name}(${emp.employeeCode}) → ${lineUserId}`);
        }
      }

      const params = employeeId ? { employeeId: Number(employeeId) } : { lineUserId };
      const forcedType = clockType === "in" || clockType === "out" ? clockType : undefined;
      const result = await processClockIn(params, latitude, longitude, forcedType);

      // Push LINE notification back to the employee after portal GPS clock-in
      if (result.status === "success" || result.status === "warning") {
        try {
          let empToNotify = null;
          if (lineUserId && isValidLineUserId(lineUserId)) {
            empToNotify = await storage.getEmployeeByLineId(lineUserId);
          } else if (employeeId) {
            empToNotify = await storage.getEmployee(Number(employeeId));
          }
          if (empToNotify?.lineId && isValidLineUserId(empToNotify.lineId)) {
            const msg = formatClockInMessage(result);
            await pushToLine(empToNotify.lineId, msg);
          }
        } catch (pushErr) {
          console.error("[LIFF] LINE push error:", pushErr);
        }
      }

      res.json(result);
    } catch (err: any) {
      console.error("[Clock-in] Error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/clock-records", async (req, res) => {
    try {
      const { startDate, endDate, employeeId } = req.query;
      if (!startDate || !endDate) {
        return res.status(400).json({ message: "startDate and endDate required" });
      }
      let records;
      if (employeeId) {
        records = await storage.getClockRecordsByEmployee(
          Number(employeeId),
          startDate as string,
          endDate as string
        );
      } else {
        records = await storage.getClockRecordsByDateRange(
          startDate as string,
          endDate as string
        );
      }

      const employeeIds = [...new Set(records.map((r) => r.employeeId))];
      const employeeMap = new Map<number, any>();
      for (const id of employeeIds) {
        const emp = await storage.getEmployee(id);
        if (emp) employeeMap.set(id, emp);
      }

      const enriched = records.map((r) => ({
        ...r,
        employeeName: employeeMap.get(r.employeeId)?.name || "未知",
        employeeCode: employeeMap.get(r.employeeId)?.employeeCode || "",
      }));

      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/portal/clock-amendment", async (req, res) => {
    try {
      const { employeeId, clockType, requestedTime, reason, venueId, shiftId } = req.body;
      if (!employeeId || !clockType || !requestedTime || !reason) {
        return res.status(400).json({ message: "缺少必要欄位" });
      }
      const emp = await storage.getEmployee(employeeId);
      if (!emp) return res.status(404).json({ message: "找不到員工" });

      const record = await storage.createClockAmendment({
        employeeId,
        clockType,
        requestedTime: new Date(requestedTime),
        reason,
        venueId: venueId || null,
        shiftId: shiftId || null,
        status: "pending",
        reviewedBy: null,
        reviewNote: null,
      });
      res.json(record);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/portal/clock-amendments/:employeeId", async (req, res) => {
    try {
      const employeeId = parseInt(req.params.employeeId);
      const records = await storage.getClockAmendmentsByEmployee(employeeId);
      res.json(records);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/clock-amendments", async (req, res) => {
    try {
      const { status } = req.query;
      const records = await storage.getClockAmendments(status as string | undefined);

      const employeeIds = [...new Set(records.map(r => r.employeeId))];
      const employeeMap = new Map<number, any>();
      for (const id of employeeIds) {
        const emp = await storage.getEmployee(id);
        if (emp) employeeMap.set(id, emp);
      }

      const enriched = records.map(r => ({
        ...r,
        employeeName: employeeMap.get(r.employeeId)?.name || "未知",
        employeeCode: employeeMap.get(r.employeeId)?.employeeCode || "",
      }));

      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/clock-amendments/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status, reviewNote } = req.body;
      if (!status || !["approved", "rejected"].includes(status)) {
        return res.status(400).json({ message: "status 必須為 approved 或 rejected" });
      }

      const amendment = await storage.getClockAmendment(id);
      if (!amendment) return res.status(404).json({ message: "找不到補打卡申請" });
      if (amendment.status !== "pending") {
        return res.status(400).json({ message: "此申請已審核完畢" });
      }

      const adminId = req.session.adminId || 0;
      const adminName = req.session.adminName || "管理員";
      const updated = await storage.updateClockAmendmentStatus(id, status, adminId, adminName, reviewNote);

      if (status === "approved" && updated) {
        try {
          await storage.createClockRecord({
            employeeId: updated.employeeId,
            venueId: updated.venueId,
            shiftId: updated.shiftId,
            clockType: updated.clockType,
            latitude: 0,
            longitude: 0,
            distance: 0,
            status: "success",
            failReason: "補打卡",
            matchedVenueName: null,
            clockTime: updated.requestedTime,
          });
        } catch (recordErr: any) {
          await storage.updateClockAmendmentStatus(id, "pending", 0, "系統", "系統錯誤：打卡紀錄建立失敗，請重新審核");
          return res.status(500).json({ message: "打卡紀錄建立失敗: " + recordErr.message });
        }
      }

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/portal/clock-records/:id/reason", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { earlyArrivalReason, lateDepartureReason } = req.body;
      if (!earlyArrivalReason && !lateDepartureReason) {
        return res.status(400).json({ message: "請提供原因" });
      }
      const updated = await storage.updateClockRecordReason(id, earlyArrivalReason, lateDepartureReason);
      if (!updated) return res.status(404).json({ message: "找不到打卡紀錄" });

      let overtimeRequest = null;
      if (lateDepartureReason === "加班") {
        const clockRecord = await storage.getClockRecord(id);
        if (clockRecord && clockRecord.shiftId && clockRecord.clockTime) {
          const twCheckDate = new Date(clockRecord.clockTime.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
          const twCheckDateStr = `${twCheckDate.getFullYear()}-${String(twCheckDate.getMonth() + 1).padStart(2, "0")}-${String(twCheckDate.getDate()).padStart(2, "0")}`;
          const existingOT = await storage.getOvertimeRequestsByEmployeeAndDate(
            clockRecord.employeeId,
            twCheckDateStr
          );
          const alreadyHasClockTriggered = existingOT.some(
            ot => ot.source === "clock_triggered" && ot.clockRecordId === clockRecord.id
          );

          if (!alreadyHasClockTriggered) {
            const twDate = new Date(clockRecord.clockTime.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
            const twDateStr = `${twDate.getFullYear()}-${String(twDate.getMonth() + 1).padStart(2, "0")}-${String(twDate.getDate()).padStart(2, "0")}`;
            const allShifts = await storage.getAllShiftsByDateRange(twDateStr, twDateStr);
            const shift = allShifts.find(s => s.id === clockRecord.shiftId);
            if (shift) {
              const clockHH = String(twDate.getHours()).padStart(2, "0");
              const clockMM = String(twDate.getMinutes()).padStart(2, "0");
              const actualClockOut = `${clockHH}:${clockMM}`;

              const [seH, seM] = shift.endTime.split(":").map(Number);
              const shiftEndMins = seH * 60 + seM;
              const clockOutMins = parseInt(clockHH) * 60 + parseInt(clockMM);
              if (clockOutMins > shiftEndMins) {
                overtimeRequest = await storage.createOvertimeRequest({
                  employeeId: clockRecord.employeeId,
                  date: shift.date,
                  startTime: shift.endTime,
                  endTime: actualClockOut,
                  reason: "加班（打卡自動產生）",
                  status: "pending",
                  source: "clock_triggered",
                  clockRecordId: clockRecord.id,
                  reviewedBy: null,
                  reviewedByName: null,
                  reviewNote: null,
                });
              }
            }
          }
        }
      }

      res.json({ ...updated, overtimeRequest });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/portal/overtime-request", async (req, res) => {
    try {
      const { employeeId, date, startTime, endTime, reason } = req.body;
      if (!employeeId || !date || !startTime || !endTime || !reason) {
        return res.status(400).json({ message: "缺少必要欄位" });
      }
      const emp = await storage.getEmployee(employeeId);
      if (!emp) return res.status(404).json({ message: "找不到員工" });

      const record = await storage.createOvertimeRequest({
        employeeId,
        date,
        startTime,
        endTime,
        reason,
        status: "pending",
        reviewedBy: null,
        reviewedByName: null,
        reviewNote: null,
      });
      res.json(record);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/portal/overtime-requests/:employeeId", async (req, res) => {
    try {
      const employeeId = parseInt(req.params.employeeId);
      const records = await storage.getOvertimeRequestsByEmployee(employeeId);
      res.json(records);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/overtime-requests", async (req, res) => {
    try {
      const { status } = req.query;
      const records = await storage.getOvertimeRequests(status as string | undefined);

      const employeeIds = [...new Set(records.map(r => r.employeeId))];
      const employeeMap = new Map<number, any>();
      for (const id of employeeIds) {
        const emp = await storage.getEmployee(id);
        if (emp) employeeMap.set(id, emp);
      }

      const clockRecordIds = records.filter(r => r.clockRecordId).map(r => r.clockRecordId!);
      const clockRecordMap = new Map<number, any>();
      for (const crId of clockRecordIds) {
        const cr = await storage.getClockRecord(crId);
        if (cr) clockRecordMap.set(crId, cr);
      }

      const enriched = records.map(r => ({
        ...r,
        employeeName: employeeMap.get(r.employeeId)?.name || "未知",
        employeeCode: employeeMap.get(r.employeeId)?.employeeCode || "",
        linkedClockTime: r.clockRecordId && clockRecordMap.has(r.clockRecordId)
          ? clockRecordMap.get(r.clockRecordId).clockTime
          : null,
      }));

      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/overtime-requests/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status, reviewNote } = req.body;
      if (!status || !["approved", "rejected"].includes(status)) {
        return res.status(400).json({ message: "status 必須為 approved 或 rejected" });
      }

      const request = await storage.getOvertimeRequest(id);
      if (!request) return res.status(404).json({ message: "找不到加班申請" });
      if (request.status !== "pending") {
        return res.status(400).json({ message: "此申請已審核完畢" });
      }

      const adminId = req.session.adminId || 0;
      const adminName = req.session.adminName || "管理員";
      const updated = await storage.updateOvertimeRequestStatus(id, status, adminId, adminName, reviewNote);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  const anomalyUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith("image/")) cb(null, true);
      else cb(new Error("僅支援圖片檔案"));
    },
  });

  app.post("/api/anomaly-report", anomalyUpload.array("images", 5), async (req, res) => {
    try {
      const body = typeof req.body.data === "string" ? JSON.parse(req.body.data) : req.body;
      const { employee, clockResult, errorMsg, context, userNote } = body;
      if (!context) return res.status(400).json({ message: "缺少異常類型 (context)" });

      const files = (req.files as Express.Multer.File[]) || [];
      const imageUrls = files.map(f => `data:${f.mimetype};base64,${f.buffer.toString("base64")}`);

      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, "0");
      const timestamp = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

      const lines: string[] = [
        "!!!打卡異常報告!!!",
        `報告時間：${timestamp}`,
        `異常類型：${context}`,
        "──────────────",
      ];

      if (employee) {
        if (employee.name) lines.push(`員工姓名：${employee.name}`);
        if (employee.employeeCode) lines.push(`員工編號：${employee.employeeCode}`);
        if (employee.role) lines.push(`職務角色：${employee.role}`);
        if (employee.lineUserId) lines.push(`LINE User ID：${employee.lineUserId}`);
      } else {
        lines.push("員工資訊：尚未登入 / 無法取得");
      }
      lines.push("──────────────");

      if (clockResult) {
        lines.push(`打卡狀態：${clockResult.status === "success" ? "成功" : clockResult.status === "warning" ? "警告（無排班）" : "失敗"}`);
        if (clockResult.clockType) lines.push(`打卡類型：${clockResult.clockType === "in" ? "上班" : "下班"}`);
        if (clockResult.time) lines.push(`打卡時間：${clockResult.date || ""} ${clockResult.time}`);
        if (clockResult.venueName) lines.push(`場館名稱：${clockResult.venueName}`);
        if (clockResult.distance !== null && clockResult.distance !== undefined) {
          lines.push(`距離場館：${clockResult.distance}m${clockResult.radius ? ` (需在${clockResult.radius}m內)` : ""}`);
        }
        if (clockResult.failReason) lines.push(`異常原因：${clockResult.failReason}`);
      }

      if (errorMsg) lines.push(`錯誤訊息：${errorMsg}`);
      if (userNote) lines.push(`使用者備註：${userNote}`);
      if (imageUrls.length > 0) lines.push(`附件圖片：${imageUrls.length} 張`);

      lines.push("──────────────");
      lines.push("※ 此為系統自動產生之異常報告，請勿修改內容，將此文字訊息以及異常畫面圖片傳送至400感謝配合。");

      const reportText = lines.join("\n");

      const record = await storage.createAnomalyReport({
        employeeId: employee?.id || null,
        employeeName: employee?.name || null,
        employeeCode: employee?.employeeCode || null,
        role: employee?.role || null,
        lineUserId: employee?.lineUserId || null,
        context,
        clockStatus: clockResult?.status || null,
        clockType: clockResult?.clockType || null,
        clockTime: clockResult?.time ? `${clockResult.date || ""} ${clockResult.time}` : null,
        venueName: clockResult?.venueName || null,
        distance: clockResult?.distance !== null && clockResult?.distance !== undefined ? `${clockResult.distance}m` : null,
        failReason: clockResult?.failReason || null,
        errorMsg: errorMsg || null,
        userNote: userNote || null,
        imageUrls: imageUrls.length > 0 ? imageUrls : null,
        reportText,
      });

      try {
        const recipients = await storage.getNotificationRecipients();
        const targets = recipients.filter(r => r.enabled && r.notifyNewReport);
        if (targets.length > 0) {
          await sendAnomalyEmail(
            targets.map(r => r.email),
            `🚨 員工打卡異常 — ${employee?.name || "未知"}（${clockResult?.venueName || "未知場館"}）`,
            `<h2>員工打卡異常</h2>
            <p><b>姓名：</b>${employee?.name || "未知"}</p>
            <p><b>員工編號：</b>${employee?.employeeCode || "未知"}</p>
            <p><b>職位：</b>${employee?.role || "未知"}</p>
            <p><b>場館：</b>${clockResult?.venueName || "未知"}</p>
            <p><b>時間：</b>${clockResult?.time ? `${clockResult.date || ""} ${clockResult.time}` : "未知"}</p>
            <p><b>原因：</b>${clockResult?.failReason || errorMsg || "未知"}</p>
            ${userNote ? `<p><b>員工備註：</b>${userNote}</p>` : ""}
            ${imageUrls.length > 0 ? `<p><b>附件圖片：</b>${imageUrls.length} 張</p>` : ""}`
          );
        }
      } catch (emailErr) {
        console.error("[EMAIL] New anomaly notification failed:", emailErr);
      }

      res.json({
        id: record.id,
        reportText,
        imageUrls,
        createdAt: record.createdAt,
        lineUrl: "https://lin.ee/TupPc0V",
      });
    } catch (err: any) {
      console.error("Anomaly report error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/anomaly-reports", async (req, res) => {
    try {
      const reports = await storage.getAnomalyReports();
      res.json(reports);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/anomaly-reports/:id", async (req, res) => {
    try {
      const report = await storage.getAnomalyReport(Number(req.params.id));
      if (!report) return res.status(404).json({ message: "找不到此異常報告" });
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/anomaly-reports/batch/resolution", async (req, res) => {
    try {
      const { ids, resolution, resolvedNote } = req.body;
      if (!ids || !Array.isArray(ids) || !resolution) {
        return res.status(400).json({ message: "缺少 ids 或 resolution" });
      }
      const results = [];
      for (const id of ids) {
        const record = await storage.updateAnomalyResolution(Number(id), resolution, resolvedNote);
        if (record) results.push(record);
      }

      try {
        const recipients = await storage.getNotificationRecipients();
        const targets = recipients.filter(r => r.enabled && r.notifyResolution);
        if (targets.length > 0 && results.length > 0) {
          const names = results.map(r => r.employeeName || "未知").join("、");
          await sendAnomalyEmail(
            targets.map(r => r.email),
            `批量處理更新 — ${results.length} 筆異常報告`,
            `<h2>批量處理更新</h2>
            <p><b>數量：</b>${results.length} 筆</p>
            <p><b>員工：</b>${names}</p>
            <p><b>狀態：</b>${resolution === "resolved" ? "已處理" : "待解決"}</p>
            <p><b>備註：</b>${resolvedNote || "無"}</p>`
          );
        }
      } catch (emailErr) {
        console.error("[EMAIL] Batch resolution notification failed:", emailErr);
      }

      res.json({ updated: results.length, results });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/anomaly-reports/:id/resolution", async (req, res) => {
    try {
      const { resolution, resolvedNote } = req.body;
      if (!resolution) return res.status(400).json({ message: "缺少 resolution" });
      const record = await storage.updateAnomalyResolution(Number(req.params.id), resolution, resolvedNote);
      if (!record) return res.status(404).json({ message: "找不到此異常報告" });

      try {
        const recipients = await storage.getNotificationRecipients();
        const targets = recipients.filter(r => r.enabled && r.notifyResolution);
        if (targets.length > 0) {
          await sendAnomalyEmail(
            targets.map(r => r.email),
            `打卡異常處理更新 — ${record.employeeName || "未知"}（${record.venueName || "未知場館"}）`,
            `<h2>打卡異常處理更新</h2>
            <p><b>姓名：</b>${record.employeeName || "未知"}</p>
            <p><b>場館：</b>${record.venueName || "未知"}</p>
            <p><b>狀態：</b>${resolution === "resolved" ? "已處理" : "待解決"}</p>
            <p><b>備註：</b>${resolvedNote || "無"}</p>
            <p><b>原始異常時間：</b>${record.clockTime || "未知"}</p>`
          );
        }
      } catch (emailErr) {
        console.error("[EMAIL] Resolution notification failed:", emailErr);
      }

      res.json(record);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/anomaly-reports/batch/delete", async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: "缺少 ids" });
      let deleted = 0;
      for (const id of ids) {
        await storage.deleteAnomalyReport(Number(id));
        deleted++;
      }
      res.json({ success: true, deleted });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/anomaly-reports/:id", async (req, res) => {
    try {
      await storage.deleteAnomalyReport(Number(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/notification-recipients", async (_req, res) => {
    try {
      const recipients = await storage.getNotificationRecipients();
      res.json(recipients);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/notification-recipients", async (req, res) => {
    try {
      const { email, label, enabled, notifyNewReport, notifyResolution } = req.body;
      if (!email) return res.status(400).json({ message: "缺少 email" });
      const record = await storage.createNotificationRecipient({
        email,
        label: label || null,
        enabled: enabled !== false,
        notifyNewReport: notifyNewReport !== false,
        notifyResolution: notifyResolution !== false,
      });
      res.json(record);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/notification-recipients/:id", async (req, res) => {
    try {
      const record = await storage.updateNotificationRecipient(Number(req.params.id), req.body);
      if (!record) return res.status(404).json({ message: "找不到此收件者" });
      res.json(record);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/notification-recipients/:id", async (req, res) => {
    try {
      await storage.deleteNotificationRecipient(Number(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/test-email", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ message: "缺少 email" });
      await sendAnomalyEmail(
        [email],
        "測試郵件 — DAOS 打卡異常通知系統",
        `<h2>測試郵件</h2><p>此為 DAOS 打卡異常通知系統的測試郵件。</p><p>如果您收到此郵件，表示郵件通知功能運作正常。</p><p>發送時間：${new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</p>`
      );
      res.json({ success: true, message: "測試郵件已發送" });
    } catch (err: any) {
      console.error("[EMAIL] Test email failed:", err);
      res.status(500).json({ message: `郵件發送失敗: ${err.message}` });
    }
  });

  app.get("/api/salary-rates", async (req, res) => {
    try {
      const rates = await storage.getSalaryRates();
      res.json(rates);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/salary-rates", async (req, res) => {
    try {
      const { role, ratePerHour, label } = req.body;
      if (!role || ratePerHour === undefined) {
        return res.status(400).json({ message: "需提供 role 和 ratePerHour" });
      }
      const rate = await storage.upsertSalaryRate(role, Number(ratePerHour), label);
      res.json(rate);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/system-config/:key", async (req, res) => {
    try {
      const config = await storage.getSystemConfig(req.params.key);
      if (!config) return res.json({ key: req.params.key, value: null });
      res.json(config);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/system-config/:key", async (req, res) => {
    try {
      const { value } = req.body;
      if (value === undefined || value === null) {
        return res.status(400).json({ message: "需提供 value" });
      }
      const config = await storage.upsertSystemConfig(req.params.key, String(value));
      res.json(config);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/four-week-compliance", async (req, res) => {
    try {
      const year = parseInt(req.query.year as string);
      const month = parseInt(req.query.month as string);
      const regionCode = req.query.regionCode as string | undefined;

      if (!year || !month || month < 1 || month > 12) {
        return res.status(400).json({ message: "需提供正確的 year 和 month" });
      }

      const refConfig = await storage.getSystemConfig("four_week_reference_date");
      const referenceDate = refConfig?.value || "2025-01-06";

      const periods = getAllPeriodsForMonth(year, month, referenceDate);

      const allStart = periods.reduce((min, p) => p.start < min ? p.start : min, periods[0].start);
      const allEnd = periods.reduce((max, p) => p.end > max ? p.end : max, periods[0].end);

      const allShifts = await storage.getAllShiftsByDateRange(allStart, allEnd);
      const approvedOT = await storage.getApprovedOvertimeByDateRange(allStart, allEnd);
      const allEmployees = await storage.getAllEmployees();
      const allRegions = await storage.getRegions();
      const regionMap = new Map(allRegions.map(r => [r.id, r]));

      const regionFilter = regionCode
        ? allRegions.find(r => r.code === regionCode)
        : null;

      const activeEmps = allEmployees.filter(e => {
        if (e.status !== "active") return false;
        if (regionFilter && e.regionId !== regionFilter.id) return false;
        return true;
      });

      const empIdsWithShifts = new Set<number>();
      for (const s of allShifts) {
        if (!LEAVE_TYPES.includes(s.role)) empIdsWithShifts.add(s.employeeId);
      }
      for (const ot of approvedOT) empIdsWithShifts.add(ot.employeeId);

      const periodResults = periods.map(period => {
        const employees = [];
        for (const emp of activeEmps) {
          if (!empIdsWithShifts.has(emp.id)) continue;

          const scheduledHours = sumScheduledHours(allShifts, emp.id, period.start, period.end, LEAVE_TYPES);

          let overtimeHours = 0;
          for (const ot of approvedOT) {
            if (ot.employeeId !== emp.id) continue;
            if (ot.date < period.start || ot.date > period.end) continue;
            overtimeHours += calcShiftHours(ot.startTime, ot.endTime);
          }
          overtimeHours = Math.round(overtimeHours * 10) / 10;

          const combinedTotal = Math.round((scheduledHours + overtimeHours) * 10) / 10;
          const overtimeAbove160 = Math.max(0, Math.round((combinedTotal - 160) * 10) / 10);

          let status: "normal" | "warning" | "over" = "normal";
          if (combinedTotal > 176) status = "over";
          else if (combinedTotal > 160) status = "warning";

          const region = regionMap.get(emp.regionId);
          employees.push({
            employeeId: emp.id,
            employeeName: emp.name,
            employeeCode: emp.employeeCode,
            region: region?.name || "未知",
            scheduledHours,
            overtimeHours,
            combinedTotal,
            overtimeAbove160,
            status,
          });
        }

        employees.sort((a, b) => b.combinedTotal - a.combinedTotal);

        return {
          periodStart: period.start,
          periodEnd: period.end,
          employees,
        };
      });

      res.json({
        referenceDate,
        normalLimit: 160,
        overtimeLimit: 176,
        periods: periodResults,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/salary-report", async (req, res) => {
    try {
      const year = parseInt(req.query.year as string);
      const month = parseInt(req.query.month as string);
      const regionCode = req.query.regionCode as string | undefined;

      if (!year || !month || month < 1 || month > 12) {
        return res.status(400).json({ message: "需提供正確的 year 和 month" });
      }

      const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      const allShifts = await storage.getAllShiftsByDateRange(startDate, endDate);
      const approvedOT = await storage.getApprovedOvertimeByDateRange(startDate, endDate);
      const allEmployees = await storage.getAllEmployees();
      const allRegions = await storage.getRegions();
      const regionMap = new Map(allRegions.map(r => [r.id, r]));
      const regionFilter = regionCode
        ? allRegions.find(r => r.code === regionCode)
        : null;

      // 適用扣時規則的場館 ID（三蘆戰區：新北高中館=2, 三重商工館=1, 三民高中館=3）
      const VENUE_XINBEI = 2;   // 新北高中館
      const VENUE_SHANGONG = 1; // 三重商工館
      const VENUE_SANMIN = 3;   // 三民高中館
      const DEDUCT_VENUES = new Set([VENUE_XINBEI, VENUE_SHANGONG, VENUE_SANMIN]);

      // 判斷是否為假日（六=6, 日=0）
      const isWeekend = (dateStr: string): boolean => {
        const d = new Date(dateStr + "T00:00:00");
        const day = d.getDay();
        return day === 0 || day === 6;
      };

      // 計算原始時數
      const rawHours = (start: string, end: string): number => {
        const [sh, sm] = start.split(":").map(Number);
        const [eh, em] = end.split(":").map(Number);
        let mins = (eh * 60 + em) - (sh * 60 + sm);
        if (mins < 0) mins += 24 * 60;
        return Math.round(mins / 60 * 10) / 10;
      };

      // 計算扣除後的實際計薪時數
      const calcHours = (start: string, end: string, venueId: number | null | undefined, date: string): number => {
        const raw = rawHours(start, end);
        if (!venueId || !DEDUCT_VENUES.has(venueId)) return raw;

        const [sh, sm] = start.split(":").map(Number);
        const startMins = sh * 60 + sm;
        const IS_1600 = startMins === 16 * 60; // 16:00 整不扣
        const isEvening = startMins >= 16 * 60; // 16:00 含以後為晚班

        if (isWeekend(date)) {
          // 假日：新北、三民 扣 0.5；商工不扣
          if (venueId === VENUE_SHANGONG) return raw;
          if (!IS_1600 && (venueId === VENUE_XINBEI || venueId === VENUE_SANMIN)) {
            return Math.max(0, Math.round((raw - 0.5) * 10) / 10);
          }
          return raw;
        } else {
          // 平日：16:00 整不扣；晚班（16:00後）扣 0.5；其餘扣 1
          if (IS_1600) return raw;
          if (isEvening) return Math.max(0, Math.round((raw - 0.5) * 10) / 10);
          return Math.max(0, Math.round((raw - 1) * 10) / 10);
        }
      };

      const empMap = new Map<number, typeof allEmployees[0]>();
      for (const e of allEmployees) {
        if (e.status !== "active") continue;
        if (regionFilter && e.regionId !== regionFilter.id) continue;
        empMap.set(e.id, e);
      }

      const workRolesSet = new Set<string>();
      const leaveSet = new Set<string>(LEAVE_TYPES);

      type EmpStats = {
        id: number;
        name: string;
        employeeCode: string;
        region: string;
        hours: Record<string, number>;
        leaves: Record<string, number>;
        totalWorkHours: number;
        totalLeaveDays: number;
        shiftCount: number;
        overtimeHours: number;
      };

      const stats = new Map<number, EmpStats>();

      for (const s of allShifts) {
        const emp = empMap.get(s.employeeId);
        if (!emp) continue;

        if (!stats.has(s.employeeId)) {
          const region = regionMap.get(emp.regionId);
          stats.set(s.employeeId, {
            id: emp.id,
            name: emp.name,
            employeeCode: emp.employeeCode,
            region: region?.name || "",
            hours: {},
            leaves: {},
            totalWorkHours: 0,
            totalLeaveDays: 0,
            shiftCount: 0,
            overtimeHours: 0,
          });
        }

        const entry = stats.get(s.employeeId)!;
        entry.shiftCount++;

        if (leaveSet.has(s.role)) {
          entry.leaves[s.role] = (entry.leaves[s.role] || 0) + 1;
          entry.totalLeaveDays++;
        } else {
          const hrs = calcHours(s.startTime, s.endTime, s.venueId, s.date);
          entry.hours[s.role] = (entry.hours[s.role] || 0) + hrs;
          entry.totalWorkHours = Math.round((entry.totalWorkHours + hrs) * 10) / 10;
          workRolesSet.add(s.role);
        }
      }

      const empShiftIntervals = new Map<number, Array<{ start: number; end: number; date: string }>>();
      for (const s of allShifts) {
        if (!empMap.has(s.employeeId) || leaveSet.has(s.role)) continue;
        if (!empShiftIntervals.has(s.employeeId)) empShiftIntervals.set(s.employeeId, []);
        const [sh2, sm2] = s.startTime.split(":").map(Number);
        const [eh2, em2] = s.endTime.split(":").map(Number);
        empShiftIntervals.get(s.employeeId)!.push({
          start: sh2 * 60 + sm2,
          end: eh2 * 60 + em2,
          date: s.date,
        });
      }

      for (const ot of approvedOT) {
        const emp = empMap.get(ot.employeeId);
        if (!emp) continue;

        if (!stats.has(ot.employeeId)) {
          const region = regionMap.get(emp.regionId);
          stats.set(ot.employeeId, {
            id: emp.id,
            name: emp.name,
            employeeCode: emp.employeeCode,
            region: region?.name || "",
            hours: {},
            leaves: {},
            totalWorkHours: 0,
            totalLeaveDays: 0,
            shiftCount: 0,
            overtimeHours: 0,
          });
        }

        const entry = stats.get(ot.employeeId)!;
        const [otSh, otSm] = ot.startTime.split(":").map(Number);
        const [otEh, otEm] = ot.endTime.split(":").map(Number);
        let otStartMins = otSh * 60 + otSm;
        let otEndMins = otEh * 60 + otEm;
        if (otEndMins <= otStartMins) otEndMins += 24 * 60;

        const shifts = empShiftIntervals.get(ot.employeeId) || [];
        const sameDayShifts = shifts.filter(si => si.date === ot.date);

        let nonOverlapMins = otEndMins - otStartMins;
        for (const si of sameDayShifts) {
          let siEnd = si.end;
          if (siEnd <= si.start) siEnd += 24 * 60;
          const overlapStart = Math.max(otStartMins, si.start);
          const overlapEnd = Math.min(otEndMins, siEnd);
          if (overlapEnd > overlapStart) {
            nonOverlapMins -= (overlapEnd - overlapStart);
          }
        }

        if (nonOverlapMins > 0) {
          const otHrs = Math.round(nonOverlapMins / 60 * 10) / 10;
          entry.overtimeHours = Math.round((entry.overtimeHours + otHrs) * 10) / 10;
          entry.totalWorkHours = Math.round((entry.totalWorkHours + otHrs) * 10) / 10;
        }
      }

      const workRoles = Array.from(workRolesSet).sort();
      const leaveTypes = LEAVE_TYPES.filter(l =>
        Array.from(stats.values()).some(e => e.leaves[l])
      );

      const hasOvertimeData = Array.from(stats.values()).some(e => e.overtimeHours > 0);

      const employees = Array.from(stats.values()).sort((a, b) =>
        a.region.localeCompare(b.region) || a.name.localeCompare(b.name, "zh-Hant")
      );

      res.json({ year, month, workRoles, leaveTypes, employees, hasOvertimeData });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/weekly-attendance/:weekStart", async (req, res) => {
    try {
      const { weekStart } = req.params;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || isNaN(new Date(weekStart + "T00:00:00Z").getTime())) {
        return res.status(400).json({ message: "weekStart 格式不正確 (YYYY-MM-DD)" });
      }
      const weekEnd = (() => {
        const d = new Date(weekStart + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() + 6);
        return d.toISOString().split("T")[0];
      })();

      const allShifts = await storage.getAllShiftsByDateRange(weekStart, weekEnd);
      const clockRecords = await storage.getClockRecordsByDateRange(weekStart, weekEnd);
      const allEmployees = await storage.getAllEmployees();
      const allVenues = await storage.getAllVenues();

      const empMap = new Map(allEmployees.map(e => [e.id, e]));
      const venueMap = new Map(allVenues.map(v => [v.id, v]));

      const employeeIds = new Set(allShifts.map(s => s.employeeId));
      const dates: string[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() + i);
        dates.push(d.toISOString().split("T")[0]);
      }

      const clockByEmpDate = new Map<string, typeof clockRecords>();
      for (const cr of clockRecords) {
        const crDate = new Date(cr.clockTime!).toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
        const key = `${cr.employeeId}-${crDate}`;
        if (!clockByEmpDate.has(key)) clockByEmpDate.set(key, []);
        clockByEmpDate.get(key)!.push(cr);
      }

      const result = Array.from(employeeIds).map(empId => {
        const emp = empMap.get(empId);
        if (!emp || emp.status === "inactive") return null;

        const days = dates.map(date => {
          const dayShifts = allShifts.filter(s => s.employeeId === empId && s.date === date);
          const dayClock = clockByEmpDate.get(`${empId}-${date}`) || [];
          const clockIns = dayClock.filter(c => c.clockType === "in");
          const clockOuts = dayClock.filter(c => c.clockType === "out");

          if (dayShifts.length === 0) {
            return { date, status: "no_shift" as const, shifts: [], clockIns: [], clockOuts: [] };
          }

          const isLeave = dayShifts.every(s => LEAVE_TYPES.includes(s.role));
          if (isLeave) {
            return { date, status: "leave" as const, leaveType: dayShifts[0].role, shifts: dayShifts.map(s => ({ startTime: s.startTime, endTime: s.endTime, role: s.role, venueId: s.venueId, venueName: venueMap.get(s.venueId)?.shortName || "未知" })), clockIns: [], clockOuts: [] };
          }

          const shiftData = dayShifts.map(s => ({
            startTime: s.startTime,
            endTime: s.endTime,
            role: s.role,
            venueId: s.venueId,
            venueName: venueMap.get(s.venueId)?.shortName || "未知",
          }));

          const clockInData = clockIns.map(c => ({
            time: new Date(c.clockTime!).toLocaleTimeString("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit" }),
            status: c.status,
            venue: c.matchedVenueName || "",
            failReason: c.failReason || "",
          }));
          const clockOutData = clockOuts.map(c => ({
            time: new Date(c.clockTime!).toLocaleTimeString("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit" }),
            status: c.status,
            venue: c.matchedVenueName || "",
          }));

          const hasSuccessClockIn = clockIns.some(c => c.status === "success" || c.status === "warning");
          const hasLateReason = clockIns.some(c => c.failReason?.includes("遲到"));
          const hasEarlyLeave = clockOuts.some(c => c.failReason?.includes("早退"));

          let status: "on_time" | "late" | "early_leave" | "missing_clock" | "anomaly" = "on_time";
          if (!hasSuccessClockIn && clockIns.length === 0) {
            status = "missing_clock";
          } else if (hasLateReason) {
            status = "late";
          } else if (hasEarlyLeave) {
            status = "early_leave";
          } else if (clockIns.some(c => c.status === "fail")) {
            status = "anomaly";
          }

          return { date, status, shifts: shiftData, clockIns: clockInData, clockOuts: clockOutData };
        });

        return {
          id: empId,
          name: emp.name,
          employeeCode: emp.employeeCode,
          lineId: emp.lineId,
          regionId: emp.regionId,
          days,
        };
      }).filter(Boolean);

      res.json({ weekStart, weekEnd, dates, employees: result });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/weekly-attendance/notify", async (req, res) => {
    try {
      const { weekStart } = req.body;
      if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || isNaN(new Date(weekStart + "T00:00:00Z").getTime())) {
        return res.status(400).json({ message: "缺少或格式不正確的 weekStart (YYYY-MM-DD)" });
      }

      const weekEnd = (() => {
        const d = new Date(weekStart + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() + 6);
        return d.toISOString().split("T")[0];
      })();

      const allShifts = await storage.getAllShiftsByDateRange(weekStart, weekEnd);
      const clockRecords = await storage.getClockRecordsByDateRange(weekStart, weekEnd);
      const allEmployees = await storage.getAllEmployees();
      const allVenues = await storage.getAllVenues();
      const empMap = new Map(allEmployees.map(e => [e.id, e]));
      const venueMap = new Map(allVenues.map(v => [v.id, v]));

      const employeeIds = new Set(allShifts.map(s => s.employeeId));
      const dates: string[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() + i);
        dates.push(d.toISOString().split("T")[0]);
      }

      const clockByEmpDate = new Map<string, typeof clockRecords>();
      for (const cr of clockRecords) {
        const crDate = new Date(cr.clockTime!).toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
        const key = `${cr.employeeId}-${crDate}`;
        if (!clockByEmpDate.has(key)) clockByEmpDate.set(key, []);
        clockByEmpDate.get(key)!.push(cr);
      }

      const dayNames = ["日", "一", "二", "三", "四", "五", "六"];
      const wsDate = new Date(weekStart + "T00:00:00Z");
      const weDate = new Date(weekEnd + "T00:00:00Z");
      const displayRange = `${wsDate.getUTCMonth() + 1}/${wsDate.getUTCDate()} ~ ${weDate.getUTCMonth() + 1}/${weDate.getUTCDate()}`;

      let lineSent = 0;
      let lineSkipped = 0;
      const summaryRows: string[] = [];

      for (const empId of employeeIds) {
        const emp = empMap.get(empId);
        if (!emp || emp.status === "inactive") continue;

        const dayResults: { date: string; status: string; detail: string }[] = [];
        let hasAnomaly = false;

        for (const date of dates) {
          const dayShifts = allShifts.filter(s => s.employeeId === empId && s.date === date);
          const dayClock = clockByEmpDate.get(`${empId}-${date}`) || [];
          const clockIns = dayClock.filter(c => c.clockType === "in");

          if (dayShifts.length === 0) {
            dayResults.push({ date, status: "➖", detail: "無班" });
            continue;
          }

          const isLeave = dayShifts.every(s => LEAVE_TYPES.includes(s.role));
          if (isLeave) {
            dayResults.push({ date, status: "🟡", detail: dayShifts[0].role });
            continue;
          }

          const venue = venueMap.get(dayShifts[0].venueId);
          const vName = venue?.shortName || "未知";
          const shiftTime = `${dayShifts[0].startTime.substring(0, 5)}-${dayShifts[0].endTime.substring(0, 5)}`;

          const hasSuccessIn = clockIns.some(c => c.status === "success" || c.status === "warning");
          if (!hasSuccessIn) {
            dayResults.push({ date, status: "🔴", detail: `${vName} ${shiftTime} 未打卡` });
            hasAnomaly = true;
          } else if (clockIns.some(c => c.failReason?.includes("遲到"))) {
            dayResults.push({ date, status: "⚠️", detail: `${vName} ${shiftTime} 遲到` });
            hasAnomaly = true;
          } else {
            dayResults.push({ date, status: "✅", detail: `${vName} ${shiftTime}` });
          }
        }

        const summaryLine = dayResults.map(d => d.status).join(" ");
        summaryRows.push(`${emp.name}(${emp.employeeCode}): ${summaryLine}${hasAnomaly ? " ⚠" : ""}`);

        if (emp.lineId) {
          const lines: string[] = [];
          lines.push(`📊 上週打卡狀況報告`);
          lines.push(`📅 ${displayRange}`);
          lines.push("");

          for (const dr of dayResults) {
            const dd = new Date(dr.date + "T00:00:00Z");
            const dayLabel = `${dd.getUTCMonth() + 1}/${dd.getUTCDate()}(${dayNames[dd.getUTCDay()]})`;
            lines.push(`${dr.status} ${dayLabel} ${dr.detail}`);
          }

          if (hasAnomaly) {
            lines.push("");
            lines.push("如有上述異常狀況，請盡速向主管回報說明，謝謝 🙏");
          } else {
            lines.push("");
            lines.push("本週出勤正常，辛苦了 👍");
          }

          const ok = await pushToLine(emp.lineId, lines.join("\n").trim());
          if (ok) { lineSent++; } else { lineSkipped++; }
        } else {
          lineSkipped++;
        }
      }

      let emailSent = false;
      try {
        const recipients = await storage.getNotificationRecipients();
        const targets = recipients.filter(r => r.enabled && r.notifyNewReport);
        if (targets.length > 0) {
          const tableRows = summaryRows.map(row => `<tr><td style="padding: 6px 12px; border: 1px solid #e5e7eb; font-size: 13px; white-space: nowrap;">${row}</td></tr>`).join("");
          const emailHtml = `
            <h2>📊 週報打卡狀況 — ${displayRange}</h2>
            <p>以下為上週所有排班人員的打卡狀況摘要：</p>
            <p style="font-size: 12px; color: #6b7280;">✅準時 ⚠️遲到 🔴未打卡 🟡休假 ➖無班</p>
            <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
              <tbody>${tableRows}</tbody>
            </table>
            <p>共 ${employeeIds.size} 位員工，LINE 推播 ${lineSent} 位，跳過 ${lineSkipped} 位。</p>
          `;
          await sendAnomalyEmail(
            targets.map(r => r.email),
            `📊 週報打卡狀況 — ${displayRange}（${employeeIds.size} 位員工）`,
            emailHtml
          );
          emailSent = true;
        }
      } catch (err: any) {
        console.error("[週報] Email 發送失敗:", err);
      }

      res.json({
        success: true,
        lineSent,
        lineSkipped,
        emailSent,
        totalEmployees: employeeIds.size,
        message: `已發送 LINE 推播 ${lineSent} 位，${emailSent ? "管理員 Email 已發送" : "Email 未發送"}`,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  return httpServer;
}

async function sendAnomalyEmail(to: string[], subject: string, html: string) {
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: process.env.GMAIL_USER || "daos.ragic.system@gmail.com",
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: `"DAOS 打卡異常通知" <${process.env.GMAIL_USER || "daos.ragic.system@gmail.com"}>`,
    to: to.join(", "),
    subject,
    html: `<div style="font-family: 'Microsoft JhengHei', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      ${html}
      <hr style="margin-top: 20px; border: none; border-top: 1px solid #e5e7eb;" />
      <p style="color: #9ca3af; font-size: 12px;">此為系統自動發送的通知郵件，請勿直接回覆。</p>
    </div>`,
  });
}
