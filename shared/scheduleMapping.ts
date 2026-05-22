export interface ScheduleSlotLike {
  venueId: number;
  date: string;
  startTime: string;
  endTime: string;
  role: string;
  requiredCount?: number;
}

export interface ShiftLike {
  venueId: number | null;
  date: string;
  startTime: string;
  endTime: string;
  role?: string | null;
}

const ROLE_ALIASES: Record<string, string> = {
  lifeguard: "救生",
  counter: "櫃檯",
  cleaning: "清潔",
  manager: "管理",
  櫃台: "櫃檯",
  櫃臺: "櫃檯",
  主管職: "管理",
  指導員: "教練",
  行政專員: "行政",
  資訊班: "資訊",
  在校實習: "無職",
};

export const NON_WORK_ROLES = [
  "休假",
  "特休",
  "病假",
  "事假",
  "喪假",
  "公假",
  "生理假",
  "國定假",
  "婚假",
  "補休",
  "曠職",
  "育嬰",
  "留職停薪",
] as const;

export function normalizeScheduleRole(role?: string | null): string {
  const raw = (role || "").replace(/\s+/g, "").trim();
  if (!raw) return "";
  return ROLE_ALIASES[raw] || raw;
}

export function isNonWorkRole(role?: string | null): boolean {
  const normalized = normalizeScheduleRole(role);
  return (NON_WORK_ROLES as readonly string[]).includes(normalized);
}

export function scheduleRolesMatch(a?: string | null, b?: string | null): boolean {
  return normalizeScheduleRole(a) === normalizeScheduleRole(b);
}

export function normalizeCoworkerGroupRole(role?: string | null): string {
  const normalized = normalizeScheduleRole(role);
  return normalized === "守望" ? "救生" : normalized;
}

function timeToMinutes(time: string): number {
  const [h = 0, m = 0] = time.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

function intervalMinutes(startTime: string, endTime: string): [number, number] {
  const start = timeToMinutes(startTime);
  let end = timeToMinutes(endTime);
  if (end <= start) end += 24 * 60;
  return [start, end];
}

export function shiftOverlapsScheduleSlot(
  shift: ShiftLike,
  slot: ScheduleSlotLike,
  minSlotOverlapRatio = 0.5,
): boolean {
  if (shift.venueId !== slot.venueId || shift.date !== slot.date) return false;
  if (!scheduleRolesMatch(shift.role, slot.role)) return false;

  const [shiftStart, shiftEnd] = intervalMinutes(shift.startTime, shift.endTime);
  const [slotStart, slotEnd] = intervalMinutes(slot.startTime, slot.endTime);
  const overlap = Math.min(shiftEnd, slotEnd) - Math.max(shiftStart, slotStart);
  const slotDuration = slotEnd - slotStart;
  return slotDuration > 0 && overlap >= slotDuration * minSlotOverlapRatio;
}

export function countAssignedToScheduleSlot(
  slot: ScheduleSlotLike,
  shifts: ShiftLike[],
  dispatchShifts: ShiftLike[] = [],
): number {
  return [...shifts, ...dispatchShifts].filter((shift) => shiftOverlapsScheduleSlot(shift, slot)).length;
}
