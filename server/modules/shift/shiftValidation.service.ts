/**
 * Shift validation service. Wraps the labor-law validator with:
 *   - load four_week_reference_date from system_configs
 *   - load approved overtime requests for the relevant date range
 *   - bucket the resulting errors into "blocking" vs "warning"
 *
 * The actual labor-law rules live in server/core/labor/laborValidation.ts;
 * this service only owns the orchestration, not the rules themselves.
 */
import { storage } from "../../storage";
import { getFourWeekPeriod, type ShiftValidationError } from "./shift.types";

export type ValidationOTRecord = {
  employeeId: number;
  date: string;
  startTime: string;
  endTime: string;
};

/**
 * Pre-load the data that validateAllRules needs for a single (employee, date)
 * check. Used by single create / update and the four-week precheck.
 */
export async function loadValidationContext(
  employeeId: number,
  date: string,
): Promise<{
  fourWeekRef: string;
  existingShifts: Awaited<ReturnType<typeof storage.getShiftsByEmployee>>;
  otRecords: ValidationOTRecord[];
}> {
  const refConfig = await storage.getSystemConfig("four_week_reference_date");
  const fourWeekRef = refConfig?.value || "2025-01-06";
  const existingShifts = await storage.getShiftsByEmployee(employeeId);
  const period = getFourWeekPeriod(date, fourWeekRef);
  const approvedOT = await storage.getApprovedOvertimeByDateRange(period.start, period.end);
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
