import crypto from "crypto";
import { storage } from "./storage";
import type { Venue, Shift, Employee } from "@shared/schema";

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || "";
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";

export function verifyLineSignature(body: string, signature: string): boolean {
  const hash = crypto
    .createHmac("SHA256", LINE_CHANNEL_SECRET)
    .update(body)
    .digest("base64");
  return hash === signature;
}

export function verifyForwardedRequest(secret: string): boolean {
  if (!LINE_CHANNEL_SECRET) return false;
  return secret === LINE_CHANNEL_SECRET;
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

function getTaiwanNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
}

function formatTaiwanTime(date: Date): string {
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

function formatTaiwanDate(date: Date): string {
  const y = date.getFullYear();
  const mo = (date.getMonth() + 1).toString().padStart(2, "0");
  const d = date.getDate().toString().padStart(2, "0");
  return `${y}-${mo}-${d}`;
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

  for (const shift of shifts) {
    const [sh, sm] = shift.startTime.split(":").map(Number);
    const [eh, em] = shift.endTime.split(":").map(Number);
    const midpoint = ((sh * 60 + sm) + (eh * 60 + em)) / 2;
    if (nowMinutes >= midpoint) {
      return "out";
    }
  }
  return "in";
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

  const allVenues = await storage.getAllVenues();
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
    await storage.createClockRecord({
      employeeId: employee.id,
      venueId: null,
      shiftId: null,
      clockType: "in",
      latitude: lat,
      longitude: lng,
      distance: Math.round(closestDistance),
      status: "fail",
      failReason: "不在任何場館範圍內",
      matchedVenueName: closestVenue.shortName,
    });

    return {
      status: "fail",
      clockType: "in",
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
    await storage.createClockRecord({
      employeeId: employee.id,
      venueId: closestVenue.id,
      shiftId: null,
      clockType: "in",
      latitude: lat,
      longitude: lng,
      distance: Math.round(closestDistance),
      status: "warning",
      failReason: "今日無排班",
      matchedVenueName: closestVenue.shortName,
    });

    return {
      status: "warning",
      clockType: "in",
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
      lateMinutes = Math.abs(diff);
      lateDeparture = true;
      const hours = Math.floor(lateMinutes / 60);
      const mins = lateMinutes % 60;
      lateReason = hours > 0
        ? `晚下班 ${hours} 小時 ${mins} 分鐘`
        : `晚下班 ${mins} 分鐘`;
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

async function pushToLine(userId: string, text: string): Promise<void> {
  try {
    const resp = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        to: userId,
        messages: [{ type: "text", text }],
      }),
    });
    if (!resp.ok) {
      console.error("[LINE] Push failed:", resp.status, await resp.text());
    }
  } catch (err) {
    console.error("[LINE] Push failed:", err);
  }
}

async function replyToLine(replyToken: string, text: string, fallbackUserId?: string): Promise<void> {
  try {
    const resp = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        replyToken,
        messages: [{ type: "text", text }],
      }),
    });
    if (!resp.ok && fallbackUserId) {
      console.log("[LINE] Reply token expired, using push message instead");
      await pushToLine(fallbackUserId, text);
    }
  } catch (err) {
    console.error("[LINE] Reply failed, trying push:", err);
    if (fallbackUserId) {
      await pushToLine(fallbackUserId, text);
    }
  }
}

function formatClockInMessage(result: ClockInResult): string {
  const liffHint = "\n\n💡 建議使用選單中的「打卡」按鈕，定位更準確。";

  if (result.status === "error") {
    return `❌ ${result.failReason}\n如有問題請聯繫管理員。`;
  }

  if (result.status === "fail") {
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

export async function handleLineWebhook(body: any): Promise<void> {
  const events = body.events || [];

  for (const event of events) {
    if (event.type !== "message" || event.message.type !== "location") {
      continue;
    }

    const replyToken = event.replyToken;
    const lineUserId = event.source?.userId;
    const userLat = event.message.latitude;
    const userLng = event.message.longitude;

    if (!lineUserId) {
      await replyToLine(replyToken, "❌ 無法識別您的 LINE 帳號，請聯繫管理員。");
      continue;
    }

    try {
      const result = await processClockIn({ lineUserId }, userLat, userLng);
      const message = formatClockInMessage(result);
      await replyToLine(replyToken, message, lineUserId);
    } catch (err) {
      console.error("[LINE Webhook] Error processing clock-in:", err);
      await pushToLine(lineUserId, "❌ 系統處理打卡時發生錯誤，請稍後再試或聯繫管理員。");
    }
  }
}

const LEAVE_TYPES = ["休假", "特休", "病假", "事假", "喪假", "公假", "生理假"];

export async function sendShiftReminders(): Promise<{ sent: number; skipped: number; noLineId: number }> {
  const taipeiNow = getTaiwanNow();
  const tomorrow = new Date(taipeiNow);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = formatTaiwanDate(tomorrow);

  const dayNames = ["日", "一", "二", "三", "四", "五", "六"];
  const tomorrowDay = dayNames[tomorrow.getDay()];
  const displayDate = `${tomorrow.getMonth() + 1}/${tomorrow.getDate()}（${tomorrowDay}）`;

  const allShifts = await storage.getShiftsByDate(tomorrowStr);
  const workShifts = allShifts.filter(s => !LEAVE_TYPES.includes(s.role));

  if (workShifts.length === 0) {
    console.log(`[推撥] ${tomorrowStr} 無上班班次，跳過推撥`);
    return { sent: 0, skipped: 0, noLineId: 0 };
  }

  const shiftsByEmployee = new Map<number, Shift[]>();
  for (const s of workShifts) {
    const arr = shiftsByEmployee.get(s.employeeId) || [];
    arr.push(s);
    shiftsByEmployee.set(s.employeeId, arr);
  }

  const allVenues = await storage.getAllVenues();
  const venueMap = new Map<number, Venue>();
  for (const v of allVenues) venueMap.set(v.id, v);

  let sent = 0;
  let skipped = 0;
  let noLineId = 0;

  for (const [empId, empShifts] of shiftsByEmployee) {
    const emp = await storage.getEmployee(empId);
    if (!emp) { skipped++; continue; }
    if (!emp.lineId) { noLineId++; continue; }

    const sortedShifts = empShifts.sort((a, b) => a.startTime.localeCompare(b.startTime));
    const lines: string[] = [];
    lines.push(`📋 明日班表通知`);
    lines.push(`📅 ${displayDate}`);
    lines.push("");

    for (const shift of sortedShifts) {
      const venue = venueMap.get(shift.venueId);
      const venueName = venue?.shortName || venue?.name || "未知場館";
      const start = shift.startTime.substring(0, 5);
      const end = shift.endTime.substring(0, 5);
      lines.push(`🏢 ${venueName}`);
      lines.push(`⏰ ${start} - ${end}`);
      lines.push(`👤 ${shift.role}`);
      if (shift.isDispatch) lines.push(`🔸 派遣`);
      lines.push("");
    }

    lines.push("請準時出勤，如需請假請提前告知主管 🙏");

    const message = lines.join("\n").trim();

    try {
      await pushToLine(emp.lineId, message);
      sent++;
    } catch (err) {
      console.error(`[推撥] 發送失敗 empId=${empId}:`, err);
      skipped++;
    }
  }

  console.log(`[推撥] 完成: 發送 ${sent}, 跳過 ${skipped}, 無LINE ${noLineId}`);
  return { sent, skipped, noLineId };
}
