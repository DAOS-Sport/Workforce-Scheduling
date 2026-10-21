import { storage } from "../../storage";
import { httpError } from "../../shared/http/response";
import { availabilityRepository } from "../availability/availability.repository";
import { portalService } from "./portal.service";

interface AvailWindowEntry { openFrom: string; openUntil: string; }

/** Returns today's date string (yyyy-MM-dd) in Asia/Taipei timezone. */
function todayTaipei(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
}

/** Load and validate the current availability window. Returns error string if closed, null if open. */
async function checkWindowOpen(targetDate?: string): Promise<string | null> {
  const cfg = await storage.getSystemConfig("availability_window");
  if (!cfg?.value) return "管理員尚未設定意願填寫開放時間";
  let raw: any;
  try { raw = JSON.parse(cfg.value); } catch { return "意願填寫設定格式錯誤"; }
  if (!/^\d{4}-\d{2}$/.test(raw.targetYearMonth)) return "意願填寫設定格式錯誤";
  // Backward compat: old flat format had openFrom/openUntil at top level
  const windows: AvailWindowEntry[] = raw.windows ??
    (raw.openFrom ? [{ openFrom: raw.openFrom, openUntil: raw.openUntil }] : []);
  const today = todayTaipei();
  const isOpen = windows.some(w =>
    /^\d{4}-\d{2}-\d{2}$/.test(w.openFrom) &&
    /^\d{4}-\d{2}-\d{2}$/.test(w.openUntil) &&
    today >= w.openFrom && today <= w.openUntil
  );
  if (!isOpen) return "目前不在開放填寫期間";
  if (targetDate) {
    const dateMonth = targetDate.slice(0, 7);
    if (dateMonth !== raw.targetYearMonth) {
      return `填寫日期須屬於開放月份（${raw.targetYearMonth}）`;
    }
  }
  return null;
}

/** Returns the array of holiday date strings (yyyy-MM-dd) for a given yearMonth from system_config. */
async function getHolidaysForMonth(yearMonth: string): Promise<string[]> {
  const cfg = await storage.getSystemConfig("monthly_holidays");
  if (!cfg?.value) return [];
  try {
    const map = JSON.parse(cfg.value) as Record<string, string[]>;
    return map[yearMonth] ?? [];
  } catch { return []; }
}

async function assertCaller(employeeId: number, lineUserId: string | undefined): Promise<void> {
  const auth = await portalService.verifyCaller(employeeId, lineUserId);
  if (!auth.ok) throw httpError(auth.status, auth.message ?? "未授權", { code: auth.code });
}

export async function getMonthlyHolidays(yearMonth: string): Promise<string[]> {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) throw httpError(400, "yearMonth 格式須為 YYYY-MM");
  return getHolidaysForMonth(yearMonth);
}

export async function getAvailabilityWindow(): Promise<unknown> {
  const cfg = await storage.getSystemConfig("availability_window");
  if (!cfg) return null;
  try {
    return JSON.parse(cfg.value);
  } catch {
    return null;
  }
}

export async function listMyAvailabilities(employeeIdParam: string, yearMonth: string, lineUserId: string | undefined) {
  const employeeId = parseInt(employeeIdParam);
  if (isNaN(employeeId)) throw httpError(400, "無效的員工 ID");
  await assertCaller(employeeId, lineUserId);
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) throw httpError(400, "yearMonth 格式須為 YYYY-MM");
  return availabilityRepository.getByEmployeeAndYearMonth(employeeId, yearMonth);
}

export async function submitAvailability(body: any, lineUserId: string | undefined) {
  const { employeeId, date, startTime, endTime, note, entryType } = body;
  const isOffRequest = entryType === "off_request";
  if (!employeeId || !date) throw httpError(400, "缺少必要欄位");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError(400, "date 格式須為 YYYY-MM-DD");
  // Time-slot format validation (only when startTime/endTime are provided)
  if (!isOffRequest && (startTime || endTime)) {
    if (!startTime || !endTime) throw httpError(400, "缺少必要欄位");
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(startTime) || !/^\d{2}:\d{2}(:\d{2})?$/.test(endTime)) {
      throw httpError(400, "時間格式須為 HH:MM");
    }
    if (startTime >= endTime) throw httpError(400, "結束時間必須晚於開始時間");
  }
  const windowErr = await checkWindowOpen(date);
  if (windowErr) throw httpError(403, windowErr);
  await assertCaller(Number(employeeId), lineUserId);
  const emp = await storage.getEmployee(Number(employeeId));
  if (!emp) throw httpError(404, "找不到員工資料");
  const empType = emp.employmentType ?? "full_time";
  if (isOffRequest && empType !== "full_time") {
    throw httpError(400, "兼職員工無法填寫休假意願，請選擇可上班時段");
  }
  // Full-time may only submit off_request entries.
  if (!isOffRequest && empType === "full_time") {
    throw httpError(400, "正職員工僅可填寫休假意願");
  }
  // Part-time without startTime/endTime is only allowed when note is "都可以"
  if (!isOffRequest && empType !== "full_time" && !startTime && !endTime) {
    const n = (note as string | undefined)?.trim() ?? "";
    if (n !== "都可以") throw httpError(400, "兼職員工填寫可上班時段時須提供時間");
  }
  // 同一天不得重複填寫（正職、兼職皆適用）
  const alreadyExists = await availabilityRepository.existsOnDate(Number(employeeId), date);
  if (alreadyExists) {
    throw httpError(400, "該日已有填寫記錄，請先刪除後再重新填寫");
  }
  if (isOffRequest) {
    // 勞工請假規則第7條：事假每年上限 14 天
    const leaveNote = (note as string | undefined)?.trim() ?? "";
    if (leaveNote === "事假") {
      const year = Number(date.slice(0, 4));
      const yearCount = await availabilityRepository.countOffRequestsByNoteAndYear(Number(employeeId), "事假", year);
      if (yearCount >= 14) {
        throw httpError(400, `事假已達今年上限 14 天（勞工請假規則第7條）`);
      }
    }
  }
  // 假日（休館日）不得填寫意願
  const holidays = await getHolidaysForMonth(date.slice(0, 7));
  if (holidays.includes(date)) {
    throw httpError(400, "該日為休館日，無法填寫排班意願");
  }
  if (!isOffRequest && emp.regionId) {
    const regionVenues = await storage.getVenuesByRegion(emp.regionId);
    const operated = regionVenues.filter((v) => v.openTime && v.closeTime);
    if (operated.length > 0) {
      const regionOpen = operated.map((v) => v.openTime!).sort()[0];
      const regionClose = operated.map((v) => v.closeTime!).sort().reverse()[0];
      const st = (startTime as string).slice(0, 5);
      const et = (endTime as string).slice(0, 5);
      if (st < regionOpen || et > regionClose) {
        throw httpError(400, `時段超出場館開放時間（${regionOpen}–${regionClose}）`);
      }
    }
  }
  const leaveType = isOffRequest ? (note?.trim() || null) : null;
  return availabilityRepository.create({
    employeeId: Number(employeeId),
    date,
    entryType: isOffRequest ? "off_request" : "available",
    startTime: isOffRequest ? null : startTime,
    endTime: isOffRequest ? null : endTime,
    note: isOffRequest ? leaveType : (note?.trim() || null),
  });
}

export async function withdrawAvailability(idParam: string, lineUserId: string | undefined) {
  const id = parseInt(idParam);
  if (isNaN(id)) throw httpError(400, "無效的 ID");
  const row = await availabilityRepository.getById(id);
  if (!row) throw httpError(404, "找不到此意願紀錄");
  const windowErr = await checkWindowOpen(row.date);
  if (windowErr) throw httpError(403, windowErr);
  await assertCaller(row.employeeId, lineUserId);
  await availabilityRepository.delete(id);
  return { success: true };
}
