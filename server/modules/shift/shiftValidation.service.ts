/**
 * Shift validation service. Wraps the labor-law validator with:
 *   - load four_week_reference_date from system_configs
 *   - load approved overtime requests for the relevant date range
 *   - bucket the resulting errors into "blocking" vs "warning"
 *
 * The actual labor-law rules live in server/core/labor/laborValidation.ts;
 * this service only owns the orchestration, not the rules themselves.
 */
import { getFourWeekPeriod, type ShiftValidationError } from "./shift.types";
import type { Executor } from "../../infra/db/tx";
import { shiftRepository } from "./shift.repository";
import { systemService } from "../system/system.service";
import { overtimeService } from "../overtime/overtime.service";

export type ValidationOTRecord = {
  employeeId: number;
  date: string;
  startTime: string;
  endTime: string;
};

/**
 * Pre-load the data that validateAllRules needs for a single (employee, date)
 * check. Used by single create / update / restore and the four-week precheck.
 * Pass the transaction that holds the employee's shift lock so the read sees
 * everything committed before the lock was granted.
 */
export async function loadValidationContext(
  employeeId: number,
  date: string,
  tx?: Executor,
): Promise<{
  fourWeekRef: string;
  existingShifts: Awaited<ReturnType<typeof shiftRepository.getShiftsByEmployee>>;
  otRecords: ValidationOTRecord[];
}> {
  const refConfig = await systemService.findSystemConfig("four_week_reference_date", tx);
  const fourWeekRef = refConfig?.value || "2025-01-06";
  const existingShifts = await shiftRepository.getShiftsByEmployee(employeeId, tx);
  const period = getFourWeekPeriod(date, fourWeekRef);
  const approvedOT = await overtimeService.getApprovedOvertimeByDateRange(period.start, period.end, tx);
  const otRecords: ValidationOTRecord[] = approvedOT.map((ot) => ({
    employeeId: ot.employeeId,
    date: ot.date,
    startTime: ot.startTime,
    endTime: ot.endTime,
  }));
  return { fourWeekRef, existingShifts, otRecords };
}

/**
 * Hard-block error types that a single-shift create/update must reject:
 *   seven_day_rest, daily_12h, four_week_176h
 */
export function pickBlockingErrors(errors: ShiftValidationError[]): ShiftValidationError[] {
  return errors.filter(
    (e) => e.type === "seven_day_rest" || e.type === "daily_12h" || e.type === "four_week_176h",
  );
}

/**
 * Soft-warning error types that a single-shift create/update should pass
 * through to the client (they are NOT blocking):
 *   rest_11h, four_week_160h
 */
export function pickWarningErrors(errors: ShiftValidationError[]): ShiftValidationError[] {
  return errors.filter((e) => e.type === "rest_11h" || e.type === "four_week_160h");
}
