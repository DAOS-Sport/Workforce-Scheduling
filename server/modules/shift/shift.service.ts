/**
 * Shift orchestration: the logic behind every /api/shifts* and
 * /api/shifts-cancelled* route. Each function returns the response payload
 * or throws httpError(status, message). Errors without a status (repository,
 * labor-rule date parsing) are mapped by shift.routes.ts to that route's
 * own default status.
 *
 * Contract:
 *   - Single edit / single delete pass force=true (admin's explicit click),
 *     and so do /batch-delete and /batch-delete-ids.
 *   - /batch and /batch-update pass force only when the body has force === true;
 *     /import-batch always passes force=true on update.
 *   - createShift never needs force (no row exists yet).
 *   - Audit rows are written by shiftRepository.createShift/updateShift/deleteShift/restoreShift
 *     in the same transaction as the shift row; a failed audit write fails the operation.
 *   - LEAVE_TYPES skip labor-law validation.
 *
 * Concurrency: every operation that checks labor rules and then writes shifts opens one
 * transaction, takes the shift lock of each employee it touches (LOCK_NS.shiftLabor, lowest
 * employee id first), and reads what the rules need inside that transaction. Copying a month
 * takes the region-month lock instead. A batch is all or nothing: an exception rolls back every
 * day, while a day the labor rules refuse is reported in `errors` and does not stop the others.
 *
 * Labor-law variants: create, update and the four-week precheck load their
 * inputs through loadValidationContext. /batch, /batch-update and
 * /import-batch each keep their own blocking/warning split, reference-date
 * default and overtime range. Those differences are open owner decisions,
 * so they are kept as they are rather than unified.
 */
import { validateAllRules } from "../../core/labor/laborValidation";
import { httpError } from "../../shared/http/response";
import { LOCK_NS, lockXact, lockXactAscending, withTx, type Tx } from "../../infra/db/tx";
import {
  insertShiftSchema,
  getFourWeekPeriod,
  LEAVE_TYPES,
  type Shift,
  type ShiftValidationError,
} from "./shift.types";
import { loadValidationContext, pickBlockingErrors, pickWarningErrors } from "./shiftValidation.service";
import { regionService } from "../region/region.service";
import { shiftRepository } from "./shift.repository";
import { employeeService } from "../employee/employee.service";
import { systemService } from "../system/system.service";
import { overtimeService } from "../overtime/overtime.service";
import { dispatchService } from "../dispatch/dispatch.service";

/** Takes the shift lock of every employee, lowest id first, so two operations on the same people queue in one order. */
const lockEmployees = (tx: Tx, employeeIds: Iterable<unknown>) =>
  lockXactAscending(tx, LOCK_NS.shiftLabor, [...employeeIds].map(Number).filter(Number.isInteger));

// ── Reads ────────────────────────────────────────────────────────────

export async function listShifts(regionCodes: string, startDate: string, endDate: string): Promise<Shift[]> {
  const codes = regionCodes.split(",").map((c) => c.trim()).filter(Boolean);
  const seenIds = new Set<number>();
  const merged: Shift[] = [];
  for (const code of codes) {
    const region = await regionService.findByCode(code);
    if (!region) continue;
    const regionShifts = await shiftRepository.getShiftsByRegionAndDateRange(region.id, startDate, endDate);
    const dispatchedInShifts = await shiftRepository.getDispatchedShiftsToRegion(region.id, startDate, endDate);
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
  return merged;
}

export async function listCancelledShifts(regionCode: string, startDate: string, endDate: string) {
  const region = await regionService.findByCode(regionCode);
  if (!region) return [];
  return shiftRepository.getCancelledShiftsByRegionAndDateRange(region.id, startDate, endDate);
}

export async function listRegionShifts(
  regionCode: string,
  startDate: string,
  endDate: string,
  includeCancelled: boolean,
) {
  const region = await regionService.findByCode(regionCode);
  if (!region) return [];
  const active = await shiftRepository.getShiftsByRegionAndDateRange(region.id, startDate, endDate);
  if (!includeCancelled) return active;
  const cancelled = await shiftRepository.getCancelledShiftsByRegionAndDateRange(region.id, startDate, endDate);
  return [...active, ...cancelled];
}

export function getShiftAuditLog(id: number) {
  return shiftRepository.getShiftAuditLog(id);
}

// ── Validation precheck ──────────────────────────────────────────────

export async function fourWeekPrecheck(body: any): Promise<{ warnings: ShiftValidationError[] }> {
  const { employeeId, date, startTime, endTime, shiftIdToExclude } = body;
  if (!employeeId || !date || !startTime || !endTime) {
    throw httpError(400, "缺少必要欄位");
  }

  const { fourWeekRef, existingShifts, otRecords } = await loadValidationContext(employeeId, date);
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
  return { warnings: fourWeekErrors };
}

// ── Single-shift CRUD ───────────────────────────────────────────────

export async function createShift(body: unknown, actor: string) {
  const parsed = insertShiftSchema.parse(body);

  return withTx(async (tx) => {
    await lockEmployees(tx, [parsed.employeeId]);

    const employee = await employeeService.getEmployee(parsed.employeeId, tx);
    if (!employee || employee.status !== "active") {
      throw httpError(400, "該員工非在職狀態，無法排班");
    }

    const isLeave = LEAVE_TYPES.includes(parsed.role ?? "" as any);
    const isDispatchShift = parsed.isDispatch || false;
    let warnings: ShiftValidationError[] = [];

    if (!isLeave && !isDispatchShift) {
      const { fourWeekRef, existingShifts, otRecords } = await loadValidationContext(parsed.employeeId, parsed.date, tx);
      const errors = validateAllRules(
        parsed.employeeId,
        parsed.date,
        parsed.startTime,
        parsed.endTime,
        existingShifts,
        undefined,
        fourWeekRef,
        otRecords,
      );
      const blocking = pickBlockingErrors(errors);
      if (blocking.length > 0) {
        throw httpError(400, blocking[0].message);
      }
      warnings = pickWarningErrors(errors);
    }

    const shift = await shiftRepository.createShift(parsed, actor, tx);
    return { ...shift, warnings };
  });
}

export async function updateShift(id: number, body: unknown, actor: string) {
  const first = await shiftRepository.getShift(id);
  if (!first) throw httpError(404, "Shift not found");

  const partial = insertShiftSchema.partial().parse(body);
  if (Object.values(partial).every((v) => v === undefined)) throw httpError(400, "沒有要更新的欄位");

  return withTx(async (tx) => {
    // The shift moves between employees only when the body says so; both employees' hours change.
    await lockEmployees(tx, [first.employeeId, partial.employeeId]);

    const existing = await shiftRepository.getShiftForUpdate(id, tx);
    if (!existing) throw httpError(404, "Shift not found");
    if (existing.employeeId !== first.employeeId) throw httpError(409, "班次已被異動，請重新整理後再試");

    const employeeId = partial.employeeId || existing.employeeId;
    const date = partial.date || existing.date;
    const startTime = partial.startTime || existing.startTime;
    const endTime = partial.endTime || existing.endTime;

    const employee = await employeeService.getEmployee(employeeId, tx);
    if (!employee || employee.status !== "active") {
      throw httpError(400, "該員工非在職狀態，無法排班");
    }

    const role = partial.role || existing.role;
    const isLeave = LEAVE_TYPES.includes(role as any);
    const isDispatchShift =
      partial.isDispatch !== undefined ? partial.isDispatch : existing.isDispatch;
    let warnings: ShiftValidationError[] = [];

    if (!isLeave && !isDispatchShift) {
      const { fourWeekRef, existingShifts, otRecords } = await loadValidationContext(employeeId, date, tx);
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
      const blocking = pickBlockingErrors(errors);
      if (blocking.length > 0) {
        throw httpError(400, blocking[0].message);
      }
      warnings = pickWarningErrors(errors);
    }

    // Admin direct edit through the UI is an explicit, authorized action.
    const shift = await shiftRepository.updateShift(id, partial, actor, true, tx);
    return { ...shift, warnings };
  });
}

/** Admin direct delete through the UI is an explicit, authorized action. */
export function cancelShift(id: number, actor: string, reason: string | undefined) {
  return shiftRepository.deleteShift(id, actor, reason, true);
}

/**
 * Only a cancelled shift is restored, and it goes back through the same labor-law check as a new shift:
 * the employee may have been scheduled for other hours since it was cancelled.
 */
export async function restoreShift(id: number, actor: string) {
  const first = await shiftRepository.getShift(id);
  if (!first || first.status !== "cancelled") return undefined;

  return withTx(async (tx) => {
    await lockEmployees(tx, [first.employeeId]);

    const shift = await shiftRepository.getShiftForUpdate(id, tx);
    if (!shift || shift.status !== "cancelled") return undefined;
    if (shift.employeeId !== first.employeeId) throw httpError(409, "班次已被異動，請重新整理後再試");

    if (!LEAVE_TYPES.includes(shift.role as any) && !shift.isDispatch) {
      const { fourWeekRef, existingShifts, otRecords } = await loadValidationContext(shift.employeeId, shift.date, tx);
      const errors = validateAllRules(shift.employeeId, shift.date, shift.startTime, shift.endTime, existingShifts, undefined, fourWeekRef, otRecords);
      const blocking = pickBlockingErrors(errors);
      if (blocking.length > 0) throw httpError(400, blocking[0].message);
    }

    return shiftRepository.restoreShift(id, actor, tx);
  });
}

// ── Batch operations ────────────────────────────────────────────────

export async function batchDeleteShifts(body: any, actor: string) {
  const { employeeId, venueId, startTime, endTime, role, targetDates, reason } = body;
  const empId = Number(employeeId);
  if (!empId || !Array.isArray(targetDates) || targetDates.length === 0) {
    throw httpError(400, "employeeId and targetDates are required");
  }
  return withTx(async (tx) => {
    await lockEmployees(tx, [empId]);
    let deletedCount = 0;
    for (const date of targetDates) {
      const shifts = await shiftRepository.getShiftsByEmployeeAndDateRange(empId, date, date, tx);
      const matching = shifts.filter(
        (s) =>
          (!venueId || s.venueId === Number(venueId)) &&
          (!startTime || s.startTime === startTime) &&
          (!endTime || s.endTime === endTime) &&
          (!role || s.role === role),
      );
      for (const s of matching) {
        await shiftRepository.deleteShift(s.id, actor, reason, true, tx);
        deletedCount++;
      }
    }
    return { success: true, deletedCount };
  });
}

export async function batchDeleteShiftIds(body: any, actor: string) {
  const { shiftIds, reason } = body;
  if (!Array.isArray(shiftIds) || shiftIds.length === 0) {
    throw httpError(400, "shiftIds array is required");
  }
  const uniqueIds = [...new Set(shiftIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  return withTx(async (tx) => {
    // Owners first, so this waits behind anyone who is scheduling them and rows are locked in one order.
    const owners = new Set<number>();
    for (const numId of uniqueIds) {
      const shift = await shiftRepository.getShift(numId, tx);
      if (shift) owners.add(shift.employeeId);
    }
    await lockEmployees(tx, owners);
    let deletedCount = 0;
    for (const numId of uniqueIds) {
      const ok = await shiftRepository.deleteShift(numId, actor, reason, true, tx);
      if (ok) deletedCount++;
    }
    return { success: true, deletedCount };
  });
}

export async function batchUpsertShifts(body: any, actor: string) {
  const { employeeId, venueId, startTime, endTime, role, isDispatch, targetDates, skipExisting, force } = body;
  // Task #50 protection: safe-by-default. Active shifts are NEVER
  // overwritten unless caller explicitly sets force=true. Admin UI sends
  // force:true on bulk-replace buttons; automation (ragic sync etc.)
  // omits force and will be blocked at the repository layer with a clear error.
  const forceFlag = force === true;
  if (!employeeId || !venueId || !startTime || !endTime || !role || !Array.isArray(targetDates) || targetDates.length === 0) {
    throw httpError(400, "缺少必要欄位");
  }

  return withTx(async (tx) => {
    await lockEmployees(tx, [employeeId]);

    const employee = await employeeService.getEmployee(employeeId, tx);
    if (!employee || employee.status !== "active") {
      throw httpError(400, "該員工非在職狀態，無法排班");
    }

    const isLeave = LEAVE_TYPES.includes(role);
    const existingShifts = isLeave ? [] : await shiftRepository.getShiftsByEmployee(employeeId, tx);
    const refConfig = isLeave ? null : await systemService.findSystemConfig("four_week_reference_date", tx);
    const fourWeekRef = refConfig?.value || "2025-01-06";
    let otRecords: { employeeId: number; date: string; startTime: string; endTime: string }[] = [];
    if (!isLeave) {
      const allDates = [...targetDates].sort();
      const pStart = getFourWeekPeriod(allDates[0], fourWeekRef);
      const pEnd = getFourWeekPeriod(allDates[allDates.length - 1], fourWeekRef);
      const approvedOT = await overtimeService.getApprovedOvertimeByDateRange(pStart.start, pEnd.end, tx);
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
      const dayShifts = await shiftRepository.getShiftsByEmployeeAndDateRange(employeeId, date, date, tx);
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
        const updated = await shiftRepository.updateShift(
          existingOnDate.id,
          {
            venueId: parseInt(venueId),
            startTime,
            endTime,
            role,
            isDispatch: isDispatch || false,
          },
          `system:batch|by:${actor}`,
          forceFlag,
          tx,
        );
        shift = updated;
        if (!isLeave) {
          const idx = existingShifts.findIndex((s: any) => s.id === existingOnDate.id);
          if (idx >= 0) Object.assign(existingShifts[idx], updated);
        }
      } else {
        shift = await shiftRepository.createShift(
          {
            employeeId,
            venueId: parseInt(venueId),
            date,
            startTime,
            endTime,
            role,
            isDispatch: isDispatch || false,
          },
          `system:batch|by:${actor}`,
          tx,
        );
        if (!isLeave) existingShifts.push(shift as any);
      }
      if (shift) results.push(shift);
    }

    return { created: results.length, errors, warnings, shifts: results };
  });
}

export async function importShifts(body: any, actor: string) {
  const { shifts: shiftItems, skipExisting, violationMode = "dispatch" } = body;
  if (!Array.isArray(shiftItems) || shiftItems.length === 0) {
    throw httpError(400, "shifts 為必填陣列");
  }
  if (violationMode !== "warn" && violationMode !== "dispatch") {
    throw httpError(400, "violationMode 必須為 warn 或 dispatch");
  }

  const uniqueEmployeeIds = [...new Set(shiftItems.map((s: any) => s.employeeId).filter(Boolean))] as number[];
  const allDates = shiftItems.map((s: any) => s.date as string).filter(Boolean).sort();
  const monthStart = allDates[0];
  const monthEnd = allDates[allDates.length - 1];

  return withTx(async (tx) => {
    await lockEmployees(tx, uniqueEmployeeIds);

    const created: any[] = [];
    const skipped: any[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];
    const dispatched: string[] = [];

    const refConfig = await systemService.findSystemConfig("four_week_reference_date", tx);
    const referenceDate = refConfig?.value || "2025-01-06";

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

    const employeeList = await Promise.all(uniqueEmployeeIds.map((id) => employeeService.getEmployee(id, tx)));
    const existingShiftsForMonth =
      uniqueEmployeeIds.length > 0
        ? await shiftRepository.getShiftsByEmployeesAndDateRange(uniqueEmployeeIds, preloadStart, monthEnd, tx)
        : [];
    const approvedOT = await overtimeService.getApprovedOvertimeByDateRange(otRangeStart, otRangeEnd, tx);

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

      // A day that already has a shift is decided before the rules run: skipped, or checked as the replacement of that shift.
      const existingKey = `${employeeId}:${date}`;
      const existingShift = existingByKey.get(existingKey);
      if (existingShift && skipExisting) {
        skipped.push({ date, employeeId });
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
          existingShift?.id,
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
        } else if (blocking.length > 0 || warnItems.length > 0) {
          // Dispatch mode (default): hard blocks and soft limits both turn the row into one dispatch shift.
          // The same person, venue, day, time and role is never added twice, so importing a month again adds nothing.
          const reason = (blocking.length > 0 ? blocking : warnItems)
            .map((e) => {
              if (e.type === "seven_day_rest") return "七休一";
              if (e.type === "daily_12h") return "超過12h";
              if (e.type === "four_week_176h") return "四週超176h";
              return e.type === "rest_11h" ? "輪班間隔不足11h" : "四週工時超160h";
            })
            .join("、");
          await dispatchService.createDispatchShiftIfAbsent(
            {
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
            },
            tx,
          );
          dispatched.push(`${date} ${employee.name}（${reason}）`);
          continue;
        }
      }

      if (existingShift) {
        const updated = await shiftRepository.updateShift(
          existingShift.id,
          { venueId, startTime, endTime, role },
          `system:import-batch|by:${actor}`,
          true,
          tx,
        );
        if (updated) {
          created.push(updated);
          existingByKey.set(existingKey, updated);
          const idx = existingShiftsForMonth.findIndex((s) => s.id === existingShift.id);
          if (idx >= 0) Object.assign(existingShiftsForMonth[idx], updated);
        }
        continue;
      }

      const shift = await shiftRepository.createShift(
        { employeeId, venueId, date, startTime, endTime, role, isDispatch: false },
        `system:import-batch|by:${actor}`,
        tx,
      );
      created.push(shift);
      existingByKey.set(existingKey, shift);
      existingShiftsForMonth.push(shift);
    }

    return { created: created.length, skipped: skipped.length, errors, warnings, dispatched, shifts: created };
  });
}

export async function batchUpdateShifts(body: any, actor: string) {
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
  } = body;

  if (!currentShiftId || !employeeId || !Array.isArray(targetDates)) {
    throw httpError(400, "缺少必要欄位");
  }

  // Task #50 protection: safe-by-default. Active shifts are NEVER
  // overwritten unless caller explicitly sets force=true. Admin UI sends
  // force:true on the "apply to multiple dates" button; automation
  // (ragic sync etc.) is blocked at the repository layer with a clear error.
  const forceFlag = body.force === true;

  const empId = Number(employeeId);
  const isLeave = LEAVE_TYPES.includes(role);
  const effectiveVenueId = isLeave ? (venueId || 1) : parseInt(venueId);
  const effectiveStart = isLeave ? "00:00" : startTime;
  const effectiveEnd = isLeave ? "00:00" : endTime;

  return withTx(async (tx) => {
    await lockEmployees(tx, [empId]);

    const updated: any[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    const existingShifts = isLeave ? [] : await shiftRepository.getShiftsByEmployee(empId, tx);
    const refConfig = isLeave ? null : await systemService.findSystemConfig("four_week_reference_date", tx);
    const fourWeekRef = refConfig?.value || "2025-01-06";
    let otRecords: { employeeId: number; date: string; startTime: string; endTime: string }[] = [];
    if (!isLeave) {
      const currentShiftData = existingShifts.find((s: any) => s.id === Number(currentShiftId));
      const allDatesForOT = [currentShiftData?.date, ...targetDates].filter(Boolean).sort() as string[];
      if (allDatesForOT.length > 0) {
        const pStart = getFourWeekPeriod(allDatesForOT[0], fourWeekRef);
        const pEnd = getFourWeekPeriod(allDatesForOT[allDatesForOT.length - 1], fourWeekRef);
        const approvedOT = await overtimeService.getApprovedOvertimeByDateRange(pStart.start, pEnd.end, tx);
        otRecords = approvedOT.map((ot) => ({
          employeeId: ot.employeeId,
          date: ot.date,
          startTime: ot.startTime,
          endTime: ot.endTime,
        }));
      }
    }

    /** The one rule set for every day of this request, the current shift included: 12 hours blocks, the rest warn. */
    const dayIsBlocked = (date: string, excludeShiftId: number | undefined) => {
      const dayErrors = validateAllRules(empId, date, effectiveStart, effectiveEnd, existingShifts, excludeShiftId, fourWeekRef, otRecords);
      const blocking = dayErrors.filter((e: ShiftValidationError) => e.type === "daily_12h");
      if (blocking.length > 0) {
        errors.push(`${date}: ${blocking[0].message}`);
        return true;
      }
      const warnItems = dayErrors.filter(
        (e: ShiftValidationError) =>
          e.type === "rest_11h" ||
          e.type === "four_week_160h" ||
          e.type === "seven_day_rest" ||
          e.type === "four_week_176h",
      );
      for (const w of warnItems) warnings.push(`${date}: ${w.message}`);
      return false;
    };

    const currentShift = existingShifts.find((s: any) => s.id === Number(currentShiftId));
    const currentDate = currentShift?.date;
    const checksRules = !isLeave && !(isDispatch || false);
    const currentBlocked = checksRules && currentDate ? dayIsBlocked(currentDate, Number(currentShiftId)) : false;

    const currentUpdated = currentBlocked ? undefined : await shiftRepository.updateShift(
      Number(currentShiftId),
      {
        venueId: effectiveVenueId,
        startTime: effectiveStart,
        endTime: effectiveEnd,
        role,
        isDispatch: isLeave ? false : (isDispatch || false),
      },
      `system:batch-update|by:${actor}`,
      forceFlag,
      tx,
    );
    if (currentUpdated) {
      updated.push(currentUpdated);
      const idx = existingShifts.findIndex((s: any) => s.id === Number(currentShiftId));
      if (idx >= 0) Object.assign(existingShifts[idx], currentUpdated);
    }

    for (const date of targetDates) {
      const dayShifts = await shiftRepository.getShiftsByEmployeeAndDateRange(empId, date, date, tx);
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

      if (checksRules && dayIsBlocked(date, shiftToUpdate?.id)) continue;

      if (!shiftToUpdate) {
        const created = await shiftRepository.createShift(
          {
            employeeId: empId,
            venueId: effectiveVenueId,
            date,
            startTime: effectiveStart,
            endTime: effectiveEnd,
            role,
            isDispatch: isLeave ? false : (isDispatch || false),
          },
          `system:batch-update|by:${actor}`,
          tx,
        );
        updated.push(created);
        existingShifts.push(created as any);
      } else {
        const result = await shiftRepository.updateShift(
          shiftToUpdate.id,
          {
            venueId: effectiveVenueId,
            startTime: effectiveStart,
            endTime: effectiveEnd,
            role,
            isDispatch: isLeave ? false : (isDispatch || false),
          },
          `system:batch-update|by:${actor}`,
          forceFlag,
          tx,
        );
        if (result) {
          updated.push(result);
          const idx = existingShifts.findIndex((s: any) => s.id === shiftToUpdate.id);
          if (idx >= 0) Object.assign(existingShifts[idx], result);
        }
      }
    }

    return { updated: updated.length, errors, warnings, shifts: updated };
  });
}

export async function copyShiftsFromPreviousMonth(body: any, actor: string) {
  const { regionCode, targetYear, targetMonth } = body;
  if (!regionCode || !targetYear || !targetMonth) {
    throw httpError(400, "缺少必要欄位");
  }
  const region = await regionService.findByCode(regionCode);
  if (!region) throw httpError(404, "找不到區域");

  const prevDate = new Date(targetYear, targetMonth - 2, 1);
  const prevYear = prevDate.getFullYear();
  const prevMonth = prevDate.getMonth() + 1;
  const prevStart = `${prevYear}-${String(prevMonth).padStart(2, "0")}-01`;
  const prevLastDay = new Date(prevYear, prevMonth, 0).getDate();
  const prevEnd = `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(prevLastDay).padStart(2, "0")}`;

  const targetStart = `${targetYear}-${String(targetMonth).padStart(2, "0")}-01`;
  const targetLastDay = new Date(targetYear, targetMonth, 0).getDate();
  const targetEnd = `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(targetLastDay).padStart(2, "0")}`;

  return withTx(async (tx) => {
    // One copy per region and month at a time: the emptiness check below is only true while this lock is held.
    await lockXact(tx, LOCK_NS.shiftRegionMonth, `${region.id}:${targetYear}-${String(targetMonth).padStart(2, "0")}`);

    const existingTargetShifts = await shiftRepository.getShiftsByRegionAndDateRange(region.id, targetStart, targetEnd, tx);
    if (existingTargetShifts.length > 0) {
      throw httpError(400, "目標月份已有排班資料，無法覆蓋");
    }

    const prevShifts = await shiftRepository.getShiftsByRegionAndDateRange(region.id, prevStart, prevEnd, tx);
    if (prevShifts.length === 0) {
      throw httpError(400, "上個月無排班資料可複製");
    }

    // Resigned employees keep last month's shifts as a record but are not scheduled into the new month.
    const regionEmployees = await employeeService.getEmployeesByRegion(region.id, tx);
    const activeEmployeeIds = new Set(regionEmployees.filter((e) => e.status === "active").map((e) => e.id));

    const results: any[] = [];
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

      const shift = await shiftRepository.createShift(
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
        `system:copy-prev|by:${actor}`,
        tx,
      );
      results.push(shift);
    }

    const skippedNote = skippedInactive > 0 ? `，略過離職人員 ${skippedInactive} 筆` : "";
    return { created: results.length, skippedInactive, errors: [] as string[], message: `已從${prevMonth}月複製 ${results.length} 筆班表${skippedNote}` };
  });
}

export const shiftService = {
  createShiftRecord: shiftRepository.createShift,
  deleteShift: shiftRepository.deleteShift,
  getAllShiftsByDateRange: shiftRepository.getAllShiftsByDateRange,
  getDispatchedShiftsToRegion: shiftRepository.getDispatchedShiftsToRegion,
  getShift: shiftRepository.getShift,
  getShiftsByDate: shiftRepository.getShiftsByDate,
  getShiftsByEmployeeAndDateRange: shiftRepository.getShiftsByEmployeeAndDateRange,
  getShiftsByRegionAndDateRange: shiftRepository.getShiftsByRegionAndDateRange,
  getShiftsByVenueAndDate: shiftRepository.getShiftsByVenueAndDate,
  updateShiftRecord: shiftRepository.updateShift,
};
