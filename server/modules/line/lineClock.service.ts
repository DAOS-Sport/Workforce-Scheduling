import { storage } from "../../storage";
import type { Shift } from "@shared/schema";
import { getTaiwanNow, formatTaiwanTime, formatTaiwanDate } from "./lineHelpers";

let _venueCache: { venues: import("@shared/schema").Venue[]; cachedAt: number } | null = null;
const VENUE_CACHE_TTL = 5 * 60 * 1000;

async function getCachedVenues(): Promise<import("@shared/schema").Venue[]> {
  const now = Date.now();
  if (_venueCache && now - _venueCache.cachedAt < VENUE_CACHE_TTL) return _venueCache.venues;
  const venues = await storage.getAllVenues();
  _venueCache = { venues, cachedAt: now };
  return venues;
}

export function invalidateVenueCache() {
  _venueCache = null;
}

function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function isTimeInShiftWindow(now: Date, shift: Shift, bufferMinutes: number = 30): boolean {
  const [sh, sm] = shift.startTime.split(":").map(Number);
  const [eh, em] = shift.endTime.split(":").map(Number);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const shiftStart = sh * 60 + sm - bufferMinutes;
  const shiftEnd = eh * 60 + em + bufferMinutes;
  return nowMinutes >= shiftStart && nowMinutes <= shiftEnd;
}

function determineClockType(now: Date, shifts: Shift[]): "in" | "out" {
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  // Pick the shift whose midpoint is closest to the current time,
  // then determine in/out based on that shift alone.
  let bestShift = shifts[0];
  let bestDist = Infinity;
  for (const shift of shifts) {
    const [sh, sm] = shift.startTime.split(":").map(Number);
    const [eh, em] = shift.endTime.split(":").map(Number);
    const midpoint = ((sh * 60 + sm) + (eh * 60 + em)) / 2;
    const dist = Math.abs(nowMinutes - midpoint);
    if (dist < bestDist) {
      bestDist = dist;
      bestShift = shift;
    }
  }
  const [bsh, bsm] = bestShift.startTime.split(":").map(Number);
  const [beh, bem] = bestShift.endTime.split(":").map(Number);
  const midpoint = ((bsh * 60 + bsm) + (beh * 60 + bem)) / 2;
  return nowMinutes >= midpoint ? "out" : "in";
}

export interface NearbyVenue {
  id: number;
  name: string;
  shortName: string;
  distance: number;
  radius: number;
  inRange: boolean;
}

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
  forcedClockType?: "in" | "out"
): Promise<ClockInResult> {
  const now = getTaiwanNow();
  const todayStr = formatTaiwanDate(now);
  const timeStr = formatTaiwanTime(now);

  let employee;
  if (params.employeeId) {
    employee = await storage.getEmployee(params.employeeId);
  } else if (params.lineUserId) {
    employee = await storage.getEmployeeByLineId(params.lineUserId);
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

  const recentRecords = await storage.getClockRecordsByEmployee(employee.id, todayStr, todayStr);

  // Dedup window: 5 minutes (was 60). Only "success" records count — warnings
  // (e.g. "no shift / outside window") MUST NOT block a subsequent legitimate
  // attempt that has now entered the shift window. See Task #49.
  const DEDUP_WINDOW_MIN = 5;
  if (recentRecords.length > 0) {
    const lastValidRecord = recentRecords.find(r => r.status === "success");
    if (lastValidRecord?.clockTime) {
      const lastTime = new Date(lastValidRecord.clockTime).getTime();
      const nowTime = now.getTime();
      const diffMinutes = (nowTime - lastTime) / (1000 * 60);
      if (diffMinutes < DEDUP_WINDOW_MIN) {
        // Only block if trying to repeat the same clock type.
        // Switching direction (in→out or out→in) is always allowed.
        const expectedNextType: "in" | "out" = lastValidRecord.clockType === "in" ? "out" : "in";
        const intendedType = forcedClockType ?? expectedNextType;
        if (intendedType === lastValidRecord.clockType) {
          const remaining = Math.ceil(DEDUP_WINDOW_MIN - diffMinutes);
          const lastType = lastValidRecord.clockType === "in" ? "上班" : "下班";
          const failReason = `重複打卡：距上次${lastType}打卡不足 ${DEDUP_WINDOW_MIN} 分鐘（還需等待 ${remaining} 分鐘）`;
          // Persist an audit-only fail record so admins can see the employee
          // actually tried to clock in but was blocked by the dedup rule.
          // Without this the attempt vanishes from the DB entirely.
          try {
            await storage.createClockRecord({
              employeeId: employee.id,
              venueId: lastValidRecord.venueId ?? null,
              shiftId: null,
              clockType: forcedClockType || lastValidRecord.clockType,
              latitude: lat,
              longitude: lng,
              distance: null,
              status: "fail",
              failReason,
              matchedVenueName: lastValidRecord.matchedVenueName || null,
            });
          } catch (err) {
            console.error("[clock] failed to write dedup audit record", err);
          }
          return {
            status: "fail",
            clockType: forcedClockType || lastValidRecord.clockType,
            venueName: lastValidRecord.matchedVenueName || null,
            distance: null,
            time: timeStr,
            date: todayStr,
            shiftInfo: null,
            failReason,
            employeeName: employee.name,
            radius: null,
            nearbyVenues: [],
            userLat: lat,
            userLng: lng,
          };
        }
      }
    }
  }

  const allVenues = await getCachedVenues();
  const validVenues = allVenues.filter((v) => v.latitude && v.longitude);

  const venueDistances = validVenues.map((v) => ({
    venue: v,
    distance: haversineDistance(lat, lng, v.latitude!, v.longitude!),
  }));
  venueDistances.sort((a, b) => a.distance - b.distance);

  const nearbyVenues: NearbyVenue[] = venueDistances.slice(0, 5).map((vd) => ({
    id: vd.venue.id,
    name: vd.venue.name,
    shortName: vd.venue.shortName,
    distance: Math.round(vd.distance),
    radius: vd.venue.radius || 300,
    inRange: vd.distance <= (vd.venue.radius || 300),
  }));

  const closest = venueDistances[0];
  if (!closest) {
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

  const closestVenue = closest.venue;
  const closestDistance = closest.distance;
  const effectiveRadius = closestVenue.radius || 300;

  if (closestDistance > effectiveRadius) {
    const failClockType = forcedClockType || "in";
    await storage.createClockRecord({
      employeeId: employee.id,
      venueId: null,
      shiftId: null,
      clockType: failClockType,
      latitude: lat,
      longitude: lng,
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

  const todayShifts = await storage.getShiftsByEmployeeAndDateRange(employee.id, todayStr, todayStr);
  const venueShifts = todayShifts.filter((s) => s.venueId === closestVenue.id);
  const matchingShift = venueShifts.find((s) => isTimeInShiftWindow(now, s));

  if (venueShifts.length === 0) {
    const warnClockType = forcedClockType || "in";
    await storage.createClockRecord({
      employeeId: employee.id,
      venueId: closestVenue.id,
      shiftId: null,
      clockType: warnClockType,
      latitude: lat,
      longitude: lng,
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

  const clockType = forcedClockType || determineClockType(now, venueShifts);
  const shiftInfo = matchingShift || venueShifts[0];

  let lateReason: string | null = null;
  let earlyArrival = false;
  let earlyMinutes = 0;
  let lateDeparture = false;
  let lateMinutes = 0;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  if (clockType === "in") {
    const [sh, sm] = shiftInfo.startTime.split(":").map(Number);
    const shiftStartMinutes = sh * 60 + sm;
    const diff = nowMinutes - shiftStartMinutes;
    if (diff > 0) {
      const hours = Math.floor(diff / 60);
      const mins = diff % 60;
      lateReason = hours > 0
        ? `遲到 ${hours} 小時 ${mins} 分鐘`
        : `遲到 ${mins} 分鐘`;
    } else if (diff <= -15) {
      earlyMinutes = Math.abs(diff);
      earlyArrival = true;
      const hours = Math.floor(earlyMinutes / 60);
      const mins = earlyMinutes % 60;
      lateReason = hours > 0
        ? `提早 ${hours} 小時 ${mins} 分鐘到`
        : `提早 ${mins} 分鐘到`;
    }
  } else if (clockType === "out") {
    const [eh, em] = shiftInfo.endTime.split(":").map(Number);
    const shiftEndMinutes = eh * 60 + em;
    const diff = shiftEndMinutes - nowMinutes;
    if (diff > 0) {
      const hours = Math.floor(diff / 60);
      const mins = diff % 60;
      lateReason = hours > 0
        ? `早退 ${hours} 小時 ${mins} 分鐘`
        : `早退 ${mins} 分鐘`;
    } else if (diff <= -15) {
      const approvedOT = await storage.getOvertimeRequestsByEmployeeAndDate(employee.id, todayStr);
      const hasApprovedCoverage = approvedOT.some(ot => {
        if (ot.status !== "approved") return false;
        const [otSh, otSm] = ot.startTime.split(":").map(Number);
        const [otEh, otEm] = ot.endTime.split(":").map(Number);
        const otStart = otSh * 60 + otSm;
        const otEnd = otEh * 60 + otEm;
        return nowMinutes >= otStart && nowMinutes <= otEnd + 15;
      });
      if (hasApprovedCoverage) {
        lateReason = "加班打卡";
      } else {
        lateMinutes = Math.abs(diff);
        lateDeparture = true;
        const hours = Math.floor(lateMinutes / 60);
        const mins = lateMinutes % 60;
        lateReason = hours > 0
          ? `晚下班 ${hours} 小時 ${mins} 分鐘`
          : `晚下班 ${mins} 分鐘`;
      }
    }
  }

  const clockRecord = await storage.createClockRecord({
    employeeId: employee.id,
    venueId: closestVenue.id,
    shiftId: matchingShift?.id || venueShifts[0].id,
    clockType,
    latitude: lat,
    longitude: lng,
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
