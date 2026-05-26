import type { Shift, ShiftValidationError } from "@shared/schema";
import { getFourWeekPeriod, calcShiftHours } from "@shared/schema";
import { addDays, subDays, parseISO, differenceInMinutes, format } from "date-fns";

const LEAVE_TYPES = ["休假", "特休", "病假", "事假", "喪假", "公假", "生理假", "國定假"];

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

export function validateSevenDayRest(
  employeeId: number,
  date: string,
  existingShifts: Shift[]
): ShiftValidationError | null {
  const targetDate = parseISO(date);
  const employeeShifts = existingShifts.filter((s) => s.employeeId === employeeId);

  let consecutiveDays = 0;
  for (let i = 1; i <= 6; i++) {
    const checkDate = format(subDays(targetDate, i), "yyyy-MM-dd");
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

export function validateDaily12Hours(
  employeeId: number,
  date: string,
  startTime: string,
  endTime: string,
  existingShifts: Shift[]
): ShiftValidationError | null {
  const employeeShiftsOnDate = existingShifts.filter(
    (s) => s.employeeId === employeeId && s.date === date
  );

  let totalMinutes = shiftDurationMinutes(startTime, endTime);
  for (const s of employeeShiftsOnDate) {
    totalMinutes += shiftDurationMinutes(s.startTime, s.endTime);
  }

  if (totalMinutes > 12 * 60) {
    const totalHours = (totalMinutes / 60).toFixed(1);
    return {
      type: "daily_12h",
      message: `違反單日工時上限：該員當日總工時${totalHours}小時，超過12小時上限`,
      employeeId,
      date,
    };
  }
  return null;
}

export function validateRestGap(
  employeeId: number,
  date: string,
  startTime: string,
  existingShifts: Shift[]
): ShiftValidationError | null {
  const targetDate = parseISO(date);
  const prevDate = format(subDays(targetDate, 1), "yyyy-MM-dd");

  const prevDayShifts = existingShifts.filter(
    (s) => s.employeeId === employeeId && s.date === prevDate
  );

  if (prevDayShifts.length === 0) return null;

  const latestEndTime = prevDayShifts.reduce((latest, s) => {
    return timeToMinutes(s.endTime) > timeToMinutes(latest) ? s.endTime : latest;
  }, prevDayShifts[0].endTime);

  const endMinutes = timeToMinutes(latestEndTime);
  const startMinutes = timeToMinutes(startTime);
  const restMinutes = (24 * 60 - endMinutes) + startMinutes;

  if (restMinutes < 11 * 60) {
    const restHours = (restMinutes / 60).toFixed(1);
    return {
      type: "rest_11h",
      message: `輪班間隔不足：前日下班至今日上班僅${restHours}小時，未達11小時最低休息`,
      employeeId,
      date,
    };
  }
  return null;
}

export function validateFourWeekLimit(
  employeeId: number,
  date: string,
  startTime: string,
  endTime: string,
  existingShifts: Shift[],
  referenceDate: string,
  approvedOvertimeRecords?: { employeeId: number; date: string; startTime: string; endTime: string }[]
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

  if (approvedOvertimeRecords) {
    for (const ot of approvedOvertimeRecords) {
      if (ot.employeeId !== employeeId) continue;
      if (ot.date < period.start || ot.date > period.end) continue;
      totalHours += calcShiftHours(ot.startTime, ot.endTime);
    }
  }

  const rounded = Math.round(totalHours * 10) / 10;

  if (rounded > 176) {
    errors.push({
      type: "four_week_176h",
      message: `違反四週加班上限：該員工在 ${period.start} ~ ${period.end} 期間總工時 ${rounded} 小時（含加班），超過 176 小時上限`,
      employeeId,
      date,
    });
  } else if (rounded > 160) {
    errors.push({
      type: "four_week_160h",
      message: `四週正常工時警告：該員工在 ${period.start} ~ ${period.end} 期間總工時 ${rounded} 小時（含加班），超過 160 小時正常上限（加班上限 176h）`,
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
  const filteredShifts = shiftIdToExclude
    ? existingShifts.filter((s) => s.id !== shiftIdToExclude)
    : existingShifts;
  
  const errors: ShiftValidationError[] = [];

  const sevenDayError = validateSevenDayRest(employeeId, date, filteredShifts);
  if (sevenDayError) errors.push(sevenDayError);

  const dailyError = validateDaily12Hours(employeeId, date, startTime, endTime, filteredShifts);
  if (dailyError) errors.push(dailyError);

  const restError = validateRestGap(employeeId, date, startTime, filteredShifts);
  if (restError) errors.push(restError);

  if (fourWeekReferenceDate) {
    const fourWeekErrors = validateFourWeekLimit(employeeId, date, startTime, endTime, filteredShifts, fourWeekReferenceDate);
    errors.push(...fourWeekErrors);
  }

  return errors;
}
