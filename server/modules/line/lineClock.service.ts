import type { Shift } from "@shared/schema";
import { formatTaipeiTime, taipeiClock } from "../../core/time/taipei";
import {
  classifyTiming,
  clockTypeForShift,
  coveredByApprovedOvertime,
  duplicateClock,
  isAccidentalRepeat,
  isInShiftWindow,
  lateDepartureReason,
  nearbyVenueList,
  nextClockType,
  pickVenue,
  rankVenues,
  successfulNewestFirst,
  type NearbyVenue,
} from "../../core/clock/clockRules";
import { venueService } from "../venue/venue.service";
import { employeeService } from "../employee/employee.service";
import { clockService } from "../clock/clock.service";
import { shiftService } from "../shift/shift.service";
import { overtimeService } from "../overtime/overtime.service";

let _venueCache: { venues: import("@shared/schema").Venue[]; cachedAt: number } | null = null;
const VENUE_CACHE_TTL = 5 * 60 * 1000;

async function getCachedVenues(): Promise<import("@shared/schema").Venue[]> {
  const now = Date.now();
  if (_venueCache && now - _venueCache.cachedAt < VENUE_CACHE_TTL) return _venueCache.venues;
  const all = await venueService.findAll();
  // Only active venues should participate in GPS clock-in matching.
  const venues = all.filter((v) => v.isActive !== false);
  _venueCache = { venues, cachedAt: now };
  return venues;
}

export function invalidateVenueCache() {
  _venueCache = null;
}

export type { NearbyVenue };

export interface ClockInResult {
  status: "success" | "warning" | "fail" | "error";
  clockType: "in" | "out";
  venueName: string | null;
  distance: number | null;
  time: string;
  date: string;
  shiftInfo: string | null;
  failReason: string | null;
  employeeName: string | null;
  radius: number | null;
  nearbyVenues: NearbyVenue[];
  userLat: number | null;
  userLng: number | null;
  recordId?: number;
  earlyArrival?: boolean;
  earlyMinutes?: number;
  lateDeparture?: boolean;
  lateMinutes?: number;
}

export async function processClockIn(
  params: { lineUserId?: string; employeeId?: number },
  lat: number,
  lng: number,
  forcedClockType?: "in" | "out",
  accuracy?: number
): Promise<ClockInResult> {
  // 一律用絕對時間；台北的日期與時刻明確換算，不依賴伺服器時區（GitHub #6）。
  const now = new Date();
  const { date: todayStr, minutes: nowMinutes } = taipeiClock(now);
  const timeStr = formatTaipeiTime(now);

  let employee;
  if (params.employeeId) {
    employee = await employeeService.getEmployee(params.employeeId);
  } else if (params.lineUserId) {
    employee = await employeeService.getEmployeeByLineId(params.lineUserId);
  }

  if (!employee) {
    return {
      status: "error",
      clockType: "in",
      venueName: null,
      distance: null,
      time: timeStr,
      date: todayStr,
      shiftInfo: null,
      failReason: params.lineUserId ? "LINE 帳號尚未綁定員工資料" : "找不到員工資料",
      employeeName: null,
      radius: null,
      nearbyVenues: [],
      userLat: lat,
      userLng: lng,
    };
  }

  if (employee.status !== "active") {
    return {
      status: "error",
      clockType: "in",
      venueName: null,
      distance: null,
      time: timeStr,
      date: todayStr,
      shiftInfo: null,
      failReason: "帳號目前為非在職狀態",
      employeeName: employee.name,
      radius: null,
      nearbyVenues: [],
      userLat: lat,
      userLng: lng,
    };
  }

  const recentRecords = await clockService.getClockRecordsByEmployee(employee.id, todayStr, todayStr);

  // 今日所有「成功」打卡，依時間新→舊排序；最新一筆用來判斷方向與防呆。
  const successRecords = successfulNewestFirst(recentRecords);
  const lastSuccess = successRecords[0] ?? null;

  // 重複打卡：距上次成功打卡不足 5 分鐘、同方向就擋下，並留一筆失敗紀錄給管理者看。
  // 只有指定方向（強制上班或下班）才會同方向；自動判斷方向一定換方向，不會被這裡擋。
  const duplicate = duplicateClock(lastSuccess, now.getTime(), forcedClockType);
  if (duplicate && lastSuccess) {
    try {
      await clockService.createClockRecord({
        employeeId: employee.id,
        venueId: lastSuccess.venueId ?? null,
        shiftId: null,
        clockType: duplicate.clockType,
        latitude: lat,
        longitude: lng,
        accuracy: accuracy ?? null,
        distance: null,
        status: "fail",
        failReason: duplicate.failReason,
        matchedVenueName: lastSuccess.matchedVenueName || null,
      });
    } catch (err) {
      console.error("[clock] failed to write dedup audit record", err);
    }
    return {
      status: "fail",
      clockType: duplicate.clockType as "in" | "out",
      venueName: lastSuccess.matchedVenueName || null,
      distance: null,
      time: timeStr,
      date: todayStr,
      shiftInfo: null,
      failReason: duplicate.failReason,
      employeeName: employee.name,
      radius: null,
      nearbyVenues: [],
      userLat: lat,
      userLng: lng,
    };
  }

  // 防呆翻轉守門：剛「上班打卡」成功後極短時間內又被點一次時，自動方向判斷會把它
  // 翻成「下班」、偷偷記一筆早退。這裡擋下 → 視為同一次上班、不重複建檔、也不翻面。
  // 注意：只擋「上班後的快速重點」；下班打卡不受限，確保下班後可以無限補打卡。
  if (lastSuccess && isAccidentalRepeat(lastSuccess, now.getTime(), forcedClockType)) {
    return {
      status: "success",
      clockType: "in",
      venueName: lastSuccess.matchedVenueName ?? null,
      distance: null,
      time: formatTaipeiTime(new Date(lastSuccess.clockTime!)),
      date: todayStr,
      shiftInfo: null,
      failReason: "您剛才已完成上班打卡，無需重複",
      employeeName: employee.name,
      radius: null,
      nearbyVenues: [],
      userLat: lat,
      userLng: lng,
      recordId: lastSuccess.id,
    };
  }

  const allVenues = await getCachedVenues();
  const ranked = rankVenues(lat, lng, allVenues);
  const nearbyVenues: NearbyVenue[] = nearbyVenueList(ranked);
  const picked = pickVenue(ranked);
  if (!picked) {
    return {
      status: "fail",
      clockType: "in",
      venueName: null,
      distance: null,
      time: timeStr,
      date: todayStr,
      shiftInfo: null,
      failReason: "系統中沒有設定場館座標",
      employeeName: employee.name,
      radius: null,
      nearbyVenues: [],
      userLat: lat,
      userLng: lng,
    };
  }

  const closestVenue = picked.venue;
  const closestDistance = picked.distance;
  const effectiveRadius = picked.radius;

  if (!picked.inRange) {
    const failClockType = forcedClockType || nextClockType(recentRecords);
    await clockService.createClockRecord({
      employeeId: employee.id,
      venueId: null,
      shiftId: null,
      clockType: failClockType,
      latitude: lat,
      longitude: lng,
      accuracy: accuracy ?? null,
      distance: Math.round(closestDistance),
      status: "fail",
      failReason: "不在任何場館範圍內",
      matchedVenueName: closestVenue.shortName,
    });

    return {
      status: "fail",
      clockType: failClockType,
      venueName: closestVenue.shortName,
      distance: Math.round(closestDistance),
      time: timeStr,
      date: todayStr,
      shiftInfo: null,
      failReason: "不在任何場館範圍內",
      employeeName: employee.name,
      radius: effectiveRadius,
      nearbyVenues,
      userLat: lat,
      userLng: lng,
    };
  }

  const todayShifts = await shiftService.getShiftsByEmployeeAndDateRange(employee.id, todayStr, todayStr);
  const venueShifts = todayShifts.filter((s) => s.venueId === closestVenue.id);
  const matchingShift = venueShifts.find((s) => isInShiftWindow(nowMinutes, s));

  if (venueShifts.length === 0) {
    const warnClockType = forcedClockType || nextClockType(recentRecords);
    await clockService.createClockRecord({
      employeeId: employee.id,
      venueId: closestVenue.id,
      shiftId: null,
      clockType: warnClockType,
      latitude: lat,
      longitude: lng,
      accuracy: accuracy ?? null,
      distance: Math.round(closestDistance),
      status: "warning",
      failReason: "今日無排班",
      matchedVenueName: closestVenue.shortName,
    });

    return {
      status: "warning",
      clockType: warnClockType,
      venueName: closestVenue.shortName,
      distance: Math.round(closestDistance),
      time: timeStr,
      date: todayStr,
      shiftInfo: null,
      failReason: "今日無排班",
      employeeName: employee.name,
      radius: effectiveRadius,
      nearbyVenues,
      userLat: lat,
      userLng: lng,
    };
  }

  const shiftInfo = matchingShift || venueShifts[0];
  // 方向判斷（下班後可無限打卡的核心）：同一班別只要已有「上班」成功紀錄，
  // 之後在該班別的每一次打卡都算「下班」，不會再翻回上班 → 下班可重複、無限打。
  const clockType = clockTypeForShift(successRecords, shiftInfo.id, forcedClockType);

  let lateReason: string | null = null;
  let earlyArrival = false;
  let earlyMinutes = 0;
  let lateDeparture = false;
  let lateMinutes = 0;

  const timing = classifyTiming(clockType, nowMinutes, shiftInfo);
  if (timing.kind === "late" || timing.kind === "early_leave") {
    lateReason = timing.reason;
  } else if (timing.kind === "early_arrival") {
    earlyArrival = true;
    earlyMinutes = timing.minutes;
    lateReason = timing.reason;
  } else if (timing.kind === "after_shift") {
    const approvedOT = await overtimeService.getOvertimeRequestsByEmployeeAndDate(employee.id, todayStr);
    if (coveredByApprovedOvertime(nowMinutes, approvedOT)) {
      lateReason = "加班打卡";
    } else {
      lateDeparture = true;
      lateMinutes = timing.minutes;
      lateReason = lateDepartureReason(timing.minutes);
    }
  }

  const clockRecord = await clockService.createClockRecord({
    employeeId: employee.id,
    venueId: closestVenue.id,
    shiftId: matchingShift?.id || venueShifts[0].id,
    clockType,
    latitude: lat,
    longitude: lng,
    accuracy: accuracy ?? null,
    distance: Math.round(closestDistance),
    status: "success",
    failReason: lateReason,
    matchedVenueName: closestVenue.shortName,
  });

  return {
    status: "success",
    clockType,
    venueName: closestVenue.shortName,
    distance: Math.round(closestDistance),
    time: timeStr,
    date: todayStr,
    shiftInfo: `${shiftInfo.startTime.slice(0, 5)}-${shiftInfo.endTime.slice(0, 5)}`,
    failReason: lateReason,
    employeeName: employee.name,
    radius: effectiveRadius,
    nearbyVenues,
    userLat: lat,
    userLng: lng,
    recordId: clockRecord.id,
    earlyArrival,
    earlyMinutes,
    lateDeparture,
    lateMinutes,
  };
}

export function formatClockInMessage(result: ClockInResult): string {
  const liffHint = "\n\n💡 建議使用選單中的「打卡」按鈕，定位更準確。";

  if (result.status === "error") {
    return `❌ ${result.failReason}\n如有問題請聯繫管理員。`;
  }

  if (result.status === "fail") {
    // Distinguish dedup / generic fails from GPS-out-of-range so the user
    // sees the actual reason instead of always "you are not in GPS range".
    const isOutOfRange = result.distance != null && result.radius != null;
    if (!isOutOfRange) {
      const reason = result.failReason || "打卡失敗";
      return `❌ ${reason}\n\n時間：${result.time}\n如有問題請聯繫管理員。${liffHint}`;
    }
    const distText = result.venueName
      ? `\n最近場館：${result.venueName}（距離 ${result.distance}m，需在 ${result.radius}m 內）`
      : "";
    return `❌ 打卡失敗！\n您不在任何場館的 GPS 範圍內。${distText}\n\n時間：${result.time}\n如有問題請聯繫管理員。${liffHint}`;
  }

  if (result.status === "warning") {
    return `⚠️ 打卡紀錄已儲存（無排班）\n\n場館：${result.venueName}\n距離：${result.distance}m\n時間：${result.time}\n\n提醒：今日您在此場館無排班紀錄。${liffHint}`;
  }

  const clockLabel = result.clockType === "in" ? "上班" : "下班";
  const lateText = result.failReason ? `\n⚠️ ${result.failReason}` : "";
  return `✅ ${clockLabel}打卡成功！\n\n場館：${result.venueName}\n距離：${result.distance}m\n時間：${result.time}\n班別：${result.shiftInfo}${lateText}${liffHint}`;
}
