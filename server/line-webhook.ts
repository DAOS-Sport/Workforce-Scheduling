import crypto from "crypto";
import { storage } from "./storage";
import type { Venue, Shift } from "@shared/schema";

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
}

export async function processClockIn(lineUserId: string, lat: number, lng: number): Promise<ClockInResult> {
  const now = getTaiwanNow();
  const todayStr = formatTaiwanDate(now);
  const timeStr = formatTaiwanTime(now);

  const employee = await storage.getEmployeeByLineId(lineUserId);
  if (!employee) {
    return {
      status: "error",
      clockType: "in",
      venueName: null,
      distance: null,
      time: timeStr,
      date: todayStr,
      shiftInfo: null,
      failReason: "LINE 帳號尚未綁定員工資料",
      employeeName: null,
      radius: null,
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
    };
  }

  const allVenues = await storage.getAllVenues();
  const validVenues = allVenues.filter((v) => v.latitude && v.longitude);

  let closestVenue: Venue | null = null;
  let closestDistance = Infinity;

  for (const venue of validVenues) {
    const dist = haversineDistance(lat, lng, venue.latitude!, venue.longitude!);
    if (dist < closestDistance) {
      closestDistance = dist;
      closestVenue = venue;
    }
  }

  if (!closestVenue || closestDistance > (closestVenue.radius || 100)) {
    await storage.createClockRecord({
      employeeId: employee.id,
      venueId: null,
      shiftId: null,
      clockType: "in",
      latitude: lat,
      longitude: lng,
      distance: closestDistance === Infinity ? null : Math.round(closestDistance),
      status: "fail",
      failReason: "不在任何場館範圍內",
      matchedVenueName: closestVenue?.shortName || null,
    });

    return {
      status: "fail",
      clockType: "in",
      venueName: closestVenue?.shortName || null,
      distance: closestDistance === Infinity ? null : Math.round(closestDistance),
      time: timeStr,
      date: todayStr,
      shiftInfo: null,
      failReason: "不在任何場館範圍內",
      employeeName: employee.name,
      radius: closestVenue?.radius || 100,
    };
  }

  const todayShifts = await storage.getShiftsByEmployeeAndDateRange(employee.id, todayStr, todayStr);
  const venueShifts = todayShifts.filter((s) => s.venueId === closestVenue!.id);
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
      radius: closestVenue.radius || 100,
    };
  }

  const clockType = determineClockType(now, venueShifts);
  const shiftInfo = matchingShift || venueShifts[0];

  await storage.createClockRecord({
    employeeId: employee.id,
    venueId: closestVenue.id,
    shiftId: matchingShift?.id || venueShifts[0].id,
    clockType,
    latitude: lat,
    longitude: lng,
    distance: Math.round(closestDistance),
    status: "success",
    failReason: null,
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
    failReason: null,
    employeeName: employee.name,
    radius: closestVenue.radius || 100,
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
  return `✅ ${clockLabel}打卡成功！\n\n場館：${result.venueName}\n距離：${result.distance}m\n時間：${result.time}\n班別：${result.shiftInfo}${liffHint}`;
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
      const result = await processClockIn(lineUserId, userLat, userLng);
      const message = formatClockInMessage(result);
      await replyToLine(replyToken, message, lineUserId);
    } catch (err) {
      console.error("[LINE Webhook] Error processing clock-in:", err);
      await pushToLine(lineUserId, "❌ 系統處理打卡時發生錯誤，請稍後再試或聯繫管理員。");
    }
  }
}
