import { storage } from "../../storage";
import type { ClockRecord, DispatchShift, Shift } from "@shared/schema";
import { OFF_DUTY_ROLES } from "@shared/leave";

function hm(value: string | null | undefined): string {
  return String(value || "").slice(0, 5);
}

function isDayOffWindow(startTime: string, endTime: string): boolean {
  return hm(startTime) === "00:00" && hm(endTime) === "00:00";
}

export function isAttendanceRequiredShift(shift: { role?: string | null; notes?: string | null }): boolean {
  const role = String(shift.role || "").trim();
  const notes = String(shift.notes || "").trim();
  if (role === "教練") return false;
  if (role.toLowerCase().includes("coach")) return false;
  if (notes.includes("暑假課程") || notes.includes("手動課程")) return false;
  return true;
}

export function isReviewableWorkShift(
  shift: { role?: string | null; notes?: string | null; startTime: string; endTime: string },
): boolean {
  const role = String(shift.role || "").trim();
  if (OFF_DUTY_ROLES.has(role)) return false;
  if (!isAttendanceRequiredShift(shift)) return false;
  if (isDayOffWindow(shift.startTime, shift.endTime)) return false;
  return hm(shift.startTime) !== hm(shift.endTime);
}

function isActiveShift(shift: Shift | undefined): shift is Shift {
  return !!shift && shift.status === "active" && isReviewableWorkShift(shift);
}

function isActiveDispatchShift(shift: DispatchShift | undefined): shift is DispatchShift {
  return !!shift && shift.status !== "cancelled" && isReviewableWorkShift(shift);
}

function sameRegularIdentity(candidate: Shift, current: Shift): boolean {
  return current.employeeId === candidate.employeeId && current.date === candidate.date;
}

function sameRegularExactShift(candidate: Shift, current: Shift): boolean {
  return sameRegularIdentity(candidate, current) &&
    current.venueId === candidate.venueId &&
    hm(current.startTime) === hm(candidate.startTime) &&
    hm(current.endTime) === hm(candidate.endTime) &&
    String(current.role || "").trim() === String(candidate.role || "").trim();
}

function sameDispatchIdentity(candidate: DispatchShift, current: DispatchShift): boolean {
  return current.linkedEmployeeId === candidate.linkedEmployeeId && current.date === candidate.date;
}

function sameDispatchExactShift(candidate: DispatchShift, current: DispatchShift): boolean {
  return sameDispatchIdentity(candidate, current) &&
    current.venueId === candidate.venueId &&
    hm(current.startTime) === hm(candidate.startTime) &&
    hm(current.endTime) === hm(candidate.endTime) &&
    String(current.role || "").trim() === String(candidate.role || "").trim();
}

export const shiftReviewService = {
  async reviewRegularShiftForPush(candidate: Shift): Promise<Shift | null> {
    const currentById = await storage.getShift(candidate.id);
    if (isActiveShift(currentById) && sameRegularIdentity(candidate, currentById)) {
      return currentById;
    }

    const currentShifts = await storage.getShiftsByEmployeeAndDateRange(
      candidate.employeeId,
      candidate.date,
      candidate.date,
    );
    return currentShifts.find((shift) => isActiveShift(shift) && sameRegularExactShift(candidate, shift)) ?? null;
  },

  async reviewDispatchShiftForPush(candidate: DispatchShift): Promise<DispatchShift | null> {
    if (!candidate.linkedEmployeeId) return null;

    const currentById = await storage.getDispatchShift(candidate.id);
    if (isActiveDispatchShift(currentById) && sameDispatchIdentity(candidate, currentById)) {
      return currentById;
    }

    const currentShifts = await storage.getDispatchShiftsByLinkedEmployee(
      candidate.linkedEmployeeId,
      candidate.date,
      candidate.date,
    );
    return currentShifts.find((shift) => isActiveDispatchShift(shift) && sameDispatchExactShift(candidate, shift)) ?? null;
  },

  async reviewClockRecordShiftForPush(recordId: number | undefined): Promise<Shift | null> {
    if (!recordId) return null;
    const record = await storage.getClockRecord(recordId) as ClockRecord | undefined;
    if (!record?.shiftId) return null;
    const shift = await storage.getShift(record.shiftId);
    if (!isActiveShift(shift)) return null;
    if (shift.employeeId !== record.employeeId) return null;
    return shift;
  },
};
