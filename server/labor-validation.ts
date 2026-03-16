import type { Shift, ShiftValidationError } from "@shared/schema";
import { getFourWeekPeriod, calcShiftHours } from "@shared/schema";

const LEAVE_TYPES = ["休假", "特休", "病假", "事假", "喪假", "公假", "生理假"];

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function shiftDurationMinutes(startTime: string, endTime: string): number {
  const start = timeToMinutes(startTime);
  let end = timeToMinutes(endTime);
  if (end <= start) end += 24 * 60;
  return end - start;
}

function addDaysToDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

function validateSevenDayRest(
  employeeId: number,
  date: string,
  existingShifts: Shift[]
): ShiftValidationError | null {
  const employeeShifts = existingShifts.filter(
    (s) => s.employeeId === employeeId && !LEAVE_TYPES.includes(s.role)
  );
  let consecutiveDays = 0;
  for (let i = 1; i <= 6; i++) {
    const checkDate = addDaysToDate(date, -i);
    const hasShift = employeeShifts.some((s) => s.date === checkDate);
    if (hasShift) {
      consecutiveDays++;
    } else {
      break;
    }
  }
  if (consecutiveDays >= 6) {
    return {
      type: "seven_day_rest",
      message: "違反七休一規定：該員工已連續工作6天，第7天禁止排班",
      employeeId,
      date,
    };
  }
  return null;
}

function validateDaily12Hours(
  employeeId: number,
  date: string,
  startTime: string,
  endTime: string,
  existingShifts: Shift[]
): ShiftValidationError | null {
  const sameDayShifts = existingShifts.filter(
    (s) => s.employeeId === employeeId && s.date === date
  );
  let totalMinutes = shiftDurationMinutes(startTime, endTime);
  for (const s of sameDayShifts) {
    totalMinutes += shiftDurationMinutes(s.startTime, s.endTime);
  }
  if (totalMinutes > 12 * 60) {
    return {
      type: "daily_12h",
      message: `違反單日工時上限：該員當日總工時${(totalMinutes / 60).toFixed(1)}小時，超過12小時`,
      employeeId,
      date,
    };
  }
  return null;
}

function validateRestGap(
  employeeId: number,
  date: string,
  startTime: string,
  existingShifts: Shift[]
): ShiftValidationError | null {
  const prevDate = addDaysToDate(date, -1);
  const prevDayShifts = existingShifts.filter(
    (s) => s.employeeId === employeeId && s.date === prevDate && !LEAVE_TYPES.includes(s.role)
  );
  if (prevDayShifts.length === 0) return null;

  const latestEnd = prevDayShifts.reduce((max, s) => {
    const mins = timeToMinutes(s.endTime);
    return mins > max ? mins : max;
  }, 0);

  const startMins = timeToMinutes(startTime);
  const restMinutes = (24 * 60 - latestEnd) + startMins;

  if (restMinutes < 11 * 60) {
    return {
      type: "rest_11h",
      message: `輪班間隔不足：前日下班至今日上班僅${(restMinutes / 60).toFixed(1)}小時，未達11小時`,
      employeeId,
      date,
    };
  }
  return null;
}

function validateFourWeekLimit(
  employeeId: number,
  date: string,
  startTime: string,
  endTime: string,
  existingShifts: Shift[],
  referenceDate: string
): ShiftValidationError[] {
  const errors: ShiftValidationError[] = [];
  const period = getFourWeekPeriod(date, referenceDate);

  const periodShifts = existingShifts.filter(
    (s) => s.employeeId === employeeId && s.date >= period.start && s.date <= period.end && !LEAVE_TYPES.includes(s.role)
  );

  let totalHours = calcShiftHours(startTime, endTime);
  for (const s of periodShifts) {
    totalHours += calcShiftHours(s.startTime, s.endTime);
  }
  const rounded = Math.round(totalHours * 10) / 10;

  if (rounded > 176) {
    errors.push({
      type: "four_week_176h",
      message: `違反四週加班上限：該員工在 ${period.start} ~ ${period.end} 期間總工時 ${rounded} 小時，超過 176 小時上限`,
      employeeId,
      date,
    });
  } else if (rounded > 160) {
    errors.push({
      type: "four_week_160h",
      message: `四週正常工時警告：該員工在 ${period.start} ~ ${period.end} 期間總工時 ${rounded} 小時，超過 160 小時正常上限（加班上限 176h）`,
      employeeId,
      date,
    });
  }

  return errors;
}

export function validateAllRules(
  employeeId: number,
  date: string,
  startTime: string,
  endTime: string,
  existingShifts: Shift[],
  shiftIdToExclude?: number,
  fourWeekReferenceDate?: string
): ShiftValidationError[] {
  const filtered = shiftIdToExclude
    ? existingShifts.filter((s) => s.id !== shiftIdToExclude)
    : existingShifts;

  const errors: ShiftValidationError[] = [];

  const sevenDay = validateSevenDayRest(employeeId, date, filtered);
  if (sevenDay) errors.push(sevenDay);

  const daily = validateDaily12Hours(employeeId, date, startTime, endTime, filtered);
  if (daily) errors.push(daily);

  const rest = validateRestGap(employeeId, date, startTime, filtered);
  if (rest) errors.push(rest);

  if (fourWeekReferenceDate) {
    const fourWeekErrors = validateFourWeekLimit(employeeId, date, startTime, endTime, filtered, fourWeekReferenceDate);
    errors.push(...fourWeekErrors);
  }

  return errors;
}
