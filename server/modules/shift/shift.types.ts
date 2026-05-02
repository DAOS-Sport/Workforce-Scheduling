/**
 * Shift module's public type surface. Re-exported from @shared/schema so
 * that other modules within /modules/shift/* never import from the
 * top-level shared package directly — keeps the module boundary clear.
 */
export type {
  Shift,
  InsertShift,
  ShiftAuditLog,
  ShiftValidationError,
} from "@shared/schema";

export {
  insertShiftSchema,
  getFourWeekPeriod,
} from "@shared/schema";

/**
 * The set of role values that mark a shift as a leave entry rather than
 * a real working shift. Leave shifts skip labor-law validation, are not
 * counted toward 12h/4-week ceilings, and never trigger seven-day-rest
 * blocks.
 */
export const LEAVE_TYPES = [
  "休假",
  "特休",
  "病假",
  "事假",
  "喪假",
  "公假",
  "生理假",
  "國定假",
] as const;

export function isLeaveRole(role: string | null | undefined): boolean {
  return !!role && (LEAVE_TYPES as readonly string[]).includes(role);
}
