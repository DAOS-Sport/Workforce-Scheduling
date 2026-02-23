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

async function replyToLine(replyToken: string, text: string): Promise<void> {
  try {
    await fetch("https://api.line.me/v2/bot/message/reply", {
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
  } catch (err) {
    console.error("[LINE] Reply failed:", err);
  }
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

    const employee = await storage.getEmployeeByLineId(lineUserId);
    if (!employee) {
      await replyToLine(replyToken, "❌ 您的 LINE 帳號尚未綁定員工資料，請聯繫管理員。");
      continue;
    }

    if (employee.status !== "active") {
      await replyToLine(replyToken, "❌ 您的帳號目前為非在職狀態，無法打卡。");
      continue;
    }

    const now = getTaiwanNow();
    const todayStr = formatTaiwanDate(now);
    const timeStr = formatTaiwanTime(now);

    const allVenues = await storage.getAllVenues();
    const validVenues = allVenues.filter(
      (v) => v.latitude && v.longitude && !v.isInternal
    );

    let closestVenue: Venue | null = null;
    let closestDistance = Infinity;

    for (const venue of validVenues) {
      const dist = haversineDistance(userLat, userLng, venue.latitude!, venue.longitude!);
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
        latitude: userLat,
        longitude: userLng,
        distance: closestDistance === Infinity ? null : Math.round(closestDistance),
        status: "fail",
        failReason: "不在任何場館範圍內",
        matchedVenueName: closestVenue?.shortName || null,
      });

      const distText = closestVenue
        ? `\n最近場館：${closestVenue.shortName}（距離 ${Math.round(closestDistance)}m，需在 ${closestVenue.radius || 100}m 內）`
        : "";
      await replyToLine(
        replyToken,
        `❌ 打卡失敗！\n您不在任何場館的 GPS 範圍內。${distText}\n\n時間：${timeStr}\n如有問題請聯繫管理員。`
      );
      continue;
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
        latitude: userLat,
        longitude: userLng,
        distance: Math.round(closestDistance),
        status: "warning",
        failReason: "今日無排班",
        matchedVenueName: closestVenue.shortName,
      });

      await replyToLine(
        replyToken,
        `⚠️ 打卡紀錄已儲存（無排班）\n\n場館：${closestVenue.shortName}\n距離：${Math.round(closestDistance)}m\n時間：${timeStr}\n\n提醒：今日您在此場館無排班紀錄。`
      );
      continue;
    }

    const clockType = determineClockType(now, venueShifts);

    await storage.createClockRecord({
      employeeId: employee.id,
      venueId: closestVenue.id,
      shiftId: matchingShift?.id || venueShifts[0].id,
      clockType,
      latitude: userLat,
      longitude: userLng,
      distance: Math.round(closestDistance),
      status: "success",
      failReason: null,
      matchedVenueName: closestVenue.shortName,
    });

    const shiftInfo = matchingShift || venueShifts[0];
    const clockLabel = clockType === "in" ? "上班" : "下班";

    await replyToLine(
      replyToken,
      `✅ ${clockLabel}打卡成功！\n\n場館：${closestVenue.shortName}\n距離：${Math.round(closestDistance)}m\n時間：${timeStr}\n班別：${shiftInfo.startTime.slice(0, 5)}-${shiftInfo.endTime.slice(0, 5)}`
    );
  }
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
