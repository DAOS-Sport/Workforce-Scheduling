import { formatTaipeiTime, taipeiClock } from "../time/taipei";

/**
 * The overtime a late clock-out stands for, when the employee gave 加班 as the reason.
 * Everything is measured from the shift's own date, so a clock-out after midnight still belongs
 * to the shift it ends and the overtime is dated by that shift.
 */

const DAY = 24 * 60;

const minutesOf = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

const dayNumber = (date: string) => Math.round(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000);

export interface ShiftTimes {
  date: string;
  startTime: string;
  endTime: string;
}

/**
 * `{ startTime, endTime }` from the shift end to the clock-out (Taipei `HH:MM`), or null when the
 * clock-out is not after the shift end. An end at or before the start ends the next day. A clock-out
 * more than a day after the shift's date is not counted.
 */
export function overtimeAfterShift(shift: ShiftTimes, clockOut: Date): { startTime: string; endTime: string } | null {
  const out = taipeiClock(clockOut);
  const days = dayNumber(out.date) - dayNumber(shift.date);
  if (days < 0 || days > 1) return null;
  const start = minutesOf(shift.startTime);
  let end = minutesOf(shift.endTime);
  if (end <= start) end += DAY;
  if (out.minutes + days * DAY <= end) return null;
  return { startTime: shift.endTime, endTime: formatTaipeiTime(clockOut) };
}
