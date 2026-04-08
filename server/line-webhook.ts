import crypto from "crypto";
import nodemailer from "nodemailer";
import { storage } from "./storage";
import type { Venue, Shift, Employee } from "@shared/schema";

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || "";
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";

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

export function isValidLineUserId(id: string): boolean {
  return /^U[0-9a-f]{32}$/.test(id);
}

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

  if (recentRecords.length > 0) {
    const lastValidRecord = recentRecords.find(r => r.status === "success" || r.status === "warning");
    if (lastValidRecord?.clockTime) {
      const lastTime = new Date(lastValidRecord.clockTime).getTime();
      const nowTime = now.getTime();
      const diffMinutes = (nowTime - lastTime) / (1000 * 60);
      if (diffMinutes < 60) {
        // Only block if trying to repeat the same clock type within 60 minutes.
        // Switching direction (in→out or out→in) is always allowed.
        const expectedNextType: "in" | "out" = lastValidRecord.clockType === "in" ? "out" : "in";
        const intendedType = forcedClockType ?? expectedNextType;
        if (intendedType === lastValidRecord.clockType) {
          const remaining = Math.ceil(60 - diffMinutes);
          const lastType = lastValidRecord.clockType === "in" ? "上班" : "下班";
          return {
            status: "fail",
            clockType: forcedClockType || lastValidRecord.clockType,
            venueName: lastValidRecord.matchedVenueName || null,
            distance: null,
            time: timeStr,
            date: todayStr,
            shiftInfo: null,
            failReason: `重複打卡：距上次${lastType}打卡不足 60 分鐘（還需等待 ${remaining} 分鐘）`,
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


export async function pushToLine(userId: string, text: string, extraMessages?: object[]): Promise<boolean> {
  const messages: object[] = [{ type: "text", text }];
  if (extraMessages) messages.push(...extraMessages);
  try {
    const resp = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ to: userId, messages }),
    });
    if (!resp.ok) {
      console.error("[LINE] Push failed:", resp.status, await resp.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("[LINE] Push failed:", err);
    return false;
  }
}

async function replyToLine(replyToken: string, text: string, fallbackUserId?: string, extraMessages?: object[]): Promise<void> {
  const messages: object[] = [{ type: "text", text }];
  if (extraMessages) messages.push(...extraMessages);
  try {
    const resp = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ replyToken, messages }),
    });
    if (!resp.ok && fallbackUserId) {
      console.log("[LINE] Reply token expired, using push message instead");
      await pushToLine(fallbackUserId, text, extraMessages);
    }
  } catch (err) {
    console.error("[LINE] Reply failed, trying push:", err);
    if (fallbackUserId) {
      await pushToLine(fallbackUserId, text, extraMessages);
    }
  }
}

export function formatClockInMessage(result: ClockInResult): string {
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

async function handleFollowEvent(event: any): Promise<void> {
  const lineUserId = event.source?.userId;
  const replyToken = event.replyToken;
  if (!lineUserId) return;

  const existingEmp = await storage.getEmployeeByLineId(lineUserId);
  if (existingEmp) {
    await replyToLine(replyToken, `👋 歡迎回來，${existingEmp.name}！\n\n您的帳號已綁定，可直接傳送「位置訊息」進行 GPS 打卡。`, lineUserId);
    return;
  }

  await replyToLine(replyToken,
    `👋 歡迎加入駿斯排班系統！\n\n` +
    `📌 請回覆您的「員工編號」來完成帳號綁定。\n` +
    `（例如：1305374）\n\n` +
    `綁定完成後即可使用以下功能：\n` +
    `✅ GPS 打卡\n` +
    `✅ 班表查詢\n` +
    `✅ 接收通知\n\n` +
    `如不確定員工編號，請洽詢您的主管或 HR。`,
    lineUserId
  );
}

async function handleTextMessage(event: any): Promise<void> {
  const lineUserId = event.source?.userId;
  const replyToken = event.replyToken;
  const text = (event.message?.text || "").trim();
  if (!lineUserId || !text) return;

  const alreadyBound = await storage.getEmployeeByLineId(lineUserId);
  if (alreadyBound) {
    await replyToLine(replyToken,
      `ℹ️ 您的帳號已綁定為：${alreadyBound.name}（${alreadyBound.employeeCode}）\n\n` +
      `如需打卡，請傳送「位置訊息」。`,
      lineUserId
    );
    return;
  }

  if (!/^\d{4,10}$/.test(text)) {
    await replyToLine(replyToken,
      `📌 請輸入您的「員工編號」（純數字）來完成帳號綁定。\n` +
      `例如：1305374\n\n` +
      `如不確定員工編號，請洽詢您的主管或 HR。`,
      lineUserId
    );
    return;
  }

  const employee = await storage.getEmployeeByCode(text);
  if (!employee) {
    await replyToLine(replyToken,
      `❌ 查無員工編號「${text}」，請確認後重新輸入。\n\n如有疑問請洽詢主管或 HR。`,
      lineUserId
    );
    return;
  }

  if (employee.lineId && isValidLineUserId(employee.lineId) && employee.lineId !== lineUserId) {
    await replyToLine(replyToken,
      `⚠️ 員工編號「${text}」（${employee.name}）已綁定其他 LINE 帳號。\n\n如需更換綁定，請聯繫 HR 處理。`,
      lineUserId
    );
    return;
  }

  if (employee.status !== "active") {
    await replyToLine(replyToken,
      `⚠️ 員工編號「${text}」目前為非在職狀態，無法綁定。\n\n如有疑問請洽詢 HR。`,
      lineUserId
    );
    return;
  }

  await storage.updateEmployee(employee.id, { lineId: lineUserId });
  console.log(`[LINE Bind] 員工 ${employee.name}(${employee.employeeCode}) 綁定 LINE ID: ${lineUserId}`);

  await replyToLine(replyToken,
    `✅ 綁定成功！\n\n` +
    `👤 ${employee.name}（${employee.employeeCode}）\n\n` +
    `您現在可以使用以下功能：\n` +
    `📍 傳送「位置訊息」進行 GPS 打卡\n` +
    `📱 員工入口網站查詢班表\n` +
    `🔔 接收班表通知\n\n` +
    `如有問題請洽詢主管。`,
    lineUserId
  );
}

const _guidelinePushRecord = new Map<number, string>();

export async function pushPendingGuidelinesIfAny(employeeId: number, lineId: string): Promise<void> {
  if (!isValidLineUserId(lineId)) return;
  try {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const monthStart = `${yearMonth}-01`;
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const monthEnd = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;

    const [allGuidelines, acks, empShifts] = await Promise.all([
      storage.getGuidelines(),
      storage.getGuidelineAcksByEmployee(employeeId),
      storage.getShiftsByEmployeeAndDateRange(employeeId, monthStart, monthEnd),
    ]);

    const myVenueIds = Array.from(new Set(empShifts.map(s => s.venueId)));

    const thisMonthAckedIds = new Set(
      acks.filter(a => {
        if (!a.acknowledgedAt) return false;
        const d = new Date(a.acknowledgedAt);
        if (d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth()) return false;
        const g = allGuidelines.find(g => g.id === a.guidelineId);
        if (g?.updatedAt && new Date(g.updatedAt) > d) return false;
        return true;
      }).map(a => a.guidelineId)
    );

    const relevant = allGuidelines.filter(g => {
      if (!g.isActive) return false;
      if (thisMonthAckedIds.has(g.id)) return false;
      if (g.category === "fixed") return g.venueId ? myVenueIds.includes(g.venueId) : true;
      if (g.category === "monthly") return g.yearMonth === yearMonth;
      if (g.category === "confidentiality") return true;
      return false;
    });

    if (relevant.length === 0) return;

    const signature = relevant.map(g => `${g.id}:${g.updatedAt?.toISOString() ?? g.createdAt?.toISOString() ?? g.id}`).sort().join("|");
    const pushKey = `${yearMonth}:${signature}`;
    if (_guidelinePushRecord.get(employeeId) === pushKey) return;

    const toPush = relevant.slice(0, 2);
    const total = relevant.length;
    const intro = `📋 您有 ${total} 條守則尚未確認\n`;
    const list = toPush.map(g => `▶ ${g.title}`).join("\n");
    const suffix = total > 2 ? `\n…等共 ${total} 條` : "";
    const link = "\n\n請至員工入口「守則」頁面確認閱讀。";
    await pushToLine(lineId, intro + list + suffix + link);
    _guidelinePushRecord.set(employeeId, pushKey);
  } catch (err) {
    console.error("[Guidelines Push] Error:", err);
  }
}

export async function handleLineWebhook(body: any): Promise<void> {
  const events = body.events || [];

  for (const event of events) {
    try {
      if (event.type === "follow") {
        await handleFollowEvent(event);
        continue;
      }

      if (event.type === "message" && event.message.type === "text") {
        await handleTextMessage(event);
        continue;
      }

      if (event.type === "message" && event.message.type === "location") {
        const replyToken = event.replyToken;
        const lineUserId = event.source?.userId;
        const userLat = event.message.latitude;
        const userLng = event.message.longitude;

        if (!lineUserId) {
          await replyToLine(replyToken, "❌ 無法識別您的 LINE 帳號，請聯繫管理員。");
          continue;
        }

        const emp = await storage.getEmployeeByLineId(lineUserId);
        if (!emp) {
          await replyToLine(replyToken,
            `❌ 您的 LINE 帳號尚未綁定員工資料。\n\n` +
            `📌 請先回覆您的「員工編號」完成綁定，再傳送位置打卡。\n` +
            `（例如：1305374）`,
            lineUserId
          );
          continue;
        }

        const result = await processClockIn({ lineUserId }, userLat, userLng);
        const message = formatClockInMessage(result);
        await replyToLine(replyToken, message, lineUserId);
        if ((result.status === "success" || result.status === "warning") && result.clockType === "in" && emp?.id && emp?.lineId) {
          pushPendingGuidelinesIfAny(emp.id, emp.lineId).catch(() => {});
        }
        continue;
      }
    } catch (err) {
      console.error("[LINE Webhook] Error processing event:", err);
      const lineUserId = event.source?.userId;
      if (lineUserId) {
        await pushToLine(lineUserId, "❌ 系統處理時發生錯誤，請稍後再試或聯繫管理員。");
      }
    }
  }
}

const LEAVE_TYPES = ["休假", "特休", "病假", "事假", "喪假", "公假", "生理假", "國定假"];

let lastReminderSentDate: string | null = null;

export async function sendShiftReminders(force = false): Promise<{ sent: number; skipped: number; noLineId: number }> {
  const taipeiNow = getTaiwanNow();
  const todayStr = formatTaiwanDate(taipeiNow);

  if (!force && lastReminderSentDate === todayStr) {
    console.log(`[推撥] 今日 ${todayStr} 班表提醒已發送過，跳過重複發送`);
    return { sent: 0, skipped: 0, noLineId: 0 };
  }

  const tomorrow = new Date(taipeiNow);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = formatTaiwanDate(tomorrow);

  const dayNames = ["日", "一", "二", "三", "四", "五", "六"];
  const tomorrowDay = dayNames[tomorrow.getDay()];
  const displayDate = `${tomorrow.getMonth() + 1}/${tomorrow.getDate()}（${tomorrowDay}）`;

  const allShifts = await storage.getShiftsByDate(tomorrowStr);
  const workShifts = allShifts.filter(s => !LEAVE_TYPES.includes(s.role));

  const allVenues = await storage.getAllVenues();
  const venueMap = new Map<number, Venue>();
  for (const v of allVenues) venueMap.set(v.id, v);

  const shiftsByEmployee = new Map<number, Shift[]>();
  for (const s of workShifts) {
    const arr = shiftsByEmployee.get(s.employeeId) || [];
    arr.push(s);
    shiftsByEmployee.set(s.employeeId, arr);
  }

  const dispatchTomorrow = await storage.getDispatchShiftsByDate(tomorrowStr);
  const linkedDispatchByEmployee = new Map<number, typeof dispatchTomorrow>();
  for (const d of dispatchTomorrow) {
    if (!d.linkedEmployeeId) continue;
    const arr = linkedDispatchByEmployee.get(d.linkedEmployeeId) || [];
    arr.push(d);
    linkedDispatchByEmployee.set(d.linkedEmployeeId, arr);
  }

  const allEmpIds = new Set([...shiftsByEmployee.keys(), ...linkedDispatchByEmployee.keys()]);

  if (allEmpIds.size === 0) {
    console.log(`[推撥] ${tomorrowStr} 無上班班次，跳過推撥`);
    return { sent: 0, skipped: 0, noLineId: 0 };
  }

  let sent = 0;
  let skipped = 0;
  let noLineId = 0;

  for (const empId of allEmpIds) {
    const emp = await storage.getEmployee(empId);
    if (!emp) { skipped++; continue; }
    if (!emp.lineId) { noLineId++; continue; }

    const empShifts = shiftsByEmployee.get(empId) || [];
    const empDispatch = linkedDispatchByEmployee.get(empId) || [];
    const sortedShifts = empShifts.sort((a, b) => a.startTime.localeCompare(b.startTime));
    const sortedDispatch = empDispatch.sort((a, b) => a.startTime.localeCompare(b.startTime));

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

    for (const ds of sortedDispatch) {
      const venue = ds.venueId ? venueMap.get(ds.venueId) : undefined;
      const venueName = venue?.shortName || venue?.name || "外派場館";
      const start = ds.startTime.substring(0, 5);
      const end = ds.endTime.substring(0, 5);
      lines.push(`🏢 ${venueName}`);
      lines.push(`⏰ ${start} - ${end}`);
      lines.push(`👤 ${ds.role}`);
      lines.push(`🔸 外部派遣班次`);
      if (ds.dispatchCompany) lines.push(`🏬 ${ds.dispatchCompany}`);
      lines.push("");
    }

    lines.push("請準時出勤，如需請假請提前告知主管 🙏");
    lines.push("");
    lines.push("該通知訊息僅做提醒用，實際班別/課表請以系統公告之。");

    const message = lines.join("\n").trim();

    try {
      await pushToLine(emp.lineId, message);
      sent++;
    } catch (err) {
      console.error(`[推撥] 發送失敗 empId=${empId}:`, err);
      skipped++;
    }
  }

  lastReminderSentDate = todayStr;
  console.log(`[推撥] 完成: 發送 ${sent}, 跳過 ${skipped}, 無LINE ${noLineId}`);
  return { sent, skipped, noLineId };
}

// NOTE: Notification deduplication is now stored in the DB (missing_clock_notifications table)
// so server restarts no longer cause duplicate LINE messages.
// resetMissingClockInTracker is kept for compatibility but is a no-op.
function resetMissingClockInTracker() {
  console.log("[未打卡提醒] DB 追蹤已啟用，無需重置記憶體狀態");
}

async function sendMissingClockInEmail(to: string[], subject: string, html: string) {
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: process.env.GMAIL_USER || "daos.ragic.system@gmail.com",
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: `"DAOS 打卡提醒系統" <${process.env.GMAIL_USER || "daos.ragic.system@gmail.com"}>`,
    to: to.join(", "),
    subject,
    html: `<div style="font-family: 'Microsoft JhengHei', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      ${html}
      <hr style="margin-top: 20px; border: none; border-top: 1px solid #e5e7eb;" />
      <p style="color: #9ca3af; font-size: 12px;">此為系統自動發送的通知郵件，請勿直接回覆。</p>
    </div>`,
  });
}

export async function checkMissingClockIn(): Promise<{ notified: number; skipped: number }> {
  const taipeiNow = getTaiwanNow();
  const todayStr = formatTaiwanDate(taipeiNow);
  const currentHour = taipeiNow.getHours();

  // Load today's already-sent notifications from DB (survives server restarts)
  const alreadySentRows = await storage.getMissingClockNotificationsForDate(todayStr);
  const alreadySentKeys = new Set(alreadySentRows.map(r => `${r.employeeId}-${r.shiftId}`));

  // Clean up old notification records (older than yesterday) to keep the table lean
  const yesterday = new Date(taipeiNow);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,"0")}-${String(yesterday.getDate()).padStart(2,"0")}`;
  await storage.clearOldMissingClockNotifications(yesterdayStr).catch(() => {}); // non-critical

  const currentMinute = taipeiNow.getMinutes();
  const currentTimeStr = `${String(currentHour).padStart(2, "0")}:${String(currentMinute).padStart(2, "0")}`;

  const allShifts = await storage.getShiftsByDate(todayStr);
  const workShifts = allShifts.filter(s =>
    !LEAVE_TYPES.includes(s.role) &&
    s.startTime.substring(0, 5) !== s.endTime.substring(0, 5)
  );

  if (workShifts.length === 0) {
    console.log(`[未打卡提醒] ${todayStr} 無上班班次`);
    return { notified: 0, skipped: 0 };
  }

  const clockRecords = await storage.getClockRecordsByDateRange(todayStr, todayStr);
  const clockedInEmployees = new Set<number>();
  for (const cr of clockRecords) {
    if (cr.clockType === "in" && (cr.status === "success" || cr.status === "warning")) {
      clockedInEmployees.add(cr.employeeId);
    }
  }
  console.log(`[未打卡提醒] 今日有效上班打卡人數: ${clockedInEmployees.size}，員工ID列表: [${Array.from(clockedInEmployees).join(", ")}]`);
  console.log(`[未打卡提醒] 今日班次總數: ${workShifts.length}，當前時間: ${currentTimeStr}`);

  const allVenues = await storage.getAllVenues();
  const venueMap = new Map<number, Venue>();
  for (const v of allVenues) venueMap.set(v.id, v);

  const missingEmployees: Array<{ emp: Employee; shift: Shift; venueName: string }> = [];

  for (const shift of workShifts) {
    const shiftStart = shift.startTime.substring(0, 5);
    const [shiftH, shiftM] = shiftStart.split(":").map(Number);
    const lateThresholdMin = (shiftH * 60 + shiftM) + 15;
    const currentMin = currentHour * 60 + currentMinute;

    if (currentMin < lateThresholdMin) {
      console.log(`[未打卡提醒] 跳過（未到閾值）: 員工ID=${shift.employeeId} 班次=${shiftStart} 閾值=${Math.floor(lateThresholdMin/60)}:${String(lateThresholdMin%60).padStart(2,"0")}`);
      continue;
    }

    if (clockedInEmployees.has(shift.employeeId)) {
      console.log(`[未打卡提醒] 跳過（已打卡）: 員工ID=${shift.employeeId} 班次=${shiftStart}`);
      continue;
    }

    const notifyKey = `${shift.employeeId}-${shift.id}`;
    if (alreadySentKeys.has(notifyKey)) {
      console.log(`[未打卡提醒] 跳過（DB已記錄通知過）: 員工ID=${shift.employeeId} 班次=${shiftStart}`);
      continue;
    }

    const emp = await storage.getEmployee(shift.employeeId);
    if (!emp || emp.status !== "active") continue;

    const venue = venueMap.get(shift.venueId);
    const venueName = venue?.shortName || venue?.name || "未知場館";

    missingEmployees.push({ emp, shift, venueName });
    // Mark in local set so within this run we don't double-process
    alreadySentKeys.add(notifyKey);
  }

  if (missingEmployees.length === 0) {
    return { notified: 0, skipped: 0 };
  }

  let notified = 0;
  let skipped = 0;

  for (const { emp, shift, venueName } of missingEmployees) {
    const shiftStart = shift.startTime.substring(0, 5);
    const shiftEnd = shift.endTime.substring(0, 5);

    console.log(`[未打卡提醒] 發送通知: ${emp.name}（ID=${emp.id}）班次=${shiftStart}-${shiftEnd} 場館=${venueName} lineId=${emp.lineId ? "有" : "無"}`);
    if (emp.lineId) {
      const lineMsg = [
        `⚠️ 打卡提醒`,
        ``,
        `${emp.name} 您好，`,
        `您今日 ${venueName} 的班次（${shiftStart}-${shiftEnd}）已超過上班時間，但系統尚未收到您的打卡紀錄。`,
        ``,
        `如果您已到達現場，請盡快透過選單中的「打卡」按鈕進行打卡。`,
        `如需請假或有其他狀況，請聯繫您的主管。`,
      ].join("\n");

      try {
        await pushToLine(emp.lineId, lineMsg);
        console.log(`[未打卡提醒] LINE推播成功: ${emp.name}`);
      } catch (err) {
        console.error(`[未打卡提醒] LINE推播失敗 ${emp.name}:`, err);
      }
    }

    // Persist to DB so server restarts don't cause re-notification for this shift
    await storage.createMissingClockNotification(todayStr, emp.id, shift.id).catch((e) =>
      console.error(`[未打卡提醒] DB 寫入失敗 empId=${emp.id} shiftId=${shift.id}:`, e)
    );
    notified++;
  }

  try {
    const recipients = await storage.getNotificationRecipients();
    const targets = recipients.filter(r => r.enabled && r.notifyNewReport);
    if (targets.length > 0) {
      const dayNames = ["日", "一", "二", "三", "四", "五", "六"];
      const dayName = dayNames[taipeiNow.getDay()];
      const displayDate = `${taipeiNow.getMonth() + 1}/${taipeiNow.getDate()}（${dayName}）`;

      const tableRows = missingEmployees.map(({ emp, shift, venueName }) => {
        const shiftStart = shift.startTime.substring(0, 5);
        const shiftEnd = shift.endTime.substring(0, 5);
        return `<tr>
          <td style="padding: 8px; border: 1px solid #e5e7eb;">${emp.name}</td>
          <td style="padding: 8px; border: 1px solid #e5e7eb;">${emp.employeeCode}</td>
          <td style="padding: 8px; border: 1px solid #e5e7eb;">${venueName}</td>
          <td style="padding: 8px; border: 1px solid #e5e7eb;">${shiftStart}-${shiftEnd}</td>
        </tr>`;
      }).join("");

      const emailHtml = `
        <h2 style="color: #dc2626;">⚠️ 員工未打卡提醒</h2>
        <p>以下員工今日（${displayDate}）已超過上班時間 15 分鐘，但尚未進行打卡：</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <thead>
            <tr style="background: #f3f4f6;">
              <th style="padding: 8px; border: 1px solid #e5e7eb; text-align: left;">姓名</th>
              <th style="padding: 8px; border: 1px solid #e5e7eb; text-align: left;">員工編號</th>
              <th style="padding: 8px; border: 1px solid #e5e7eb; text-align: left;">場館</th>
              <th style="padding: 8px; border: 1px solid #e5e7eb; text-align: left;">班次時間</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
        <p>請確認是否忘記打卡或有其他異常狀況。</p>
        <p style="color: #6b7280; font-size: 13px;">檢查時間：${currentTimeStr}</p>
      `;

      await sendMissingClockInEmail(
        targets.map(r => r.email),
        `⚠️ 員工未打卡提醒 — ${displayDate}（${missingEmployees.length} 位）`,
        emailHtml
      );
      console.log(`[未打卡提醒] 已發送 email 給 ${targets.length} 位管理員`);
    }
  } catch (err) {
    console.error("[未打卡提醒] Email發送失敗:", err);
  }

  console.log(`[未打卡提醒] 完成: 通知 ${notified}, 跳過 ${skipped}`);
  return { notified, skipped };
}

export { resetMissingClockInTracker };

// ── 每週班表推播（週日 19:00 推下週班表）─────────────────────────────────────
export async function sendWeeklySchedulePush(force = false): Promise<{ sent: number; skipped: number; noLineId: number }> {
  const taipeiNow = getTaiwanNow();

  // Compute next Monday
  const dow = taipeiNow.getDay(); // 0=Sun
  const daysUntilNextMon = dow === 0 ? 1 : 8 - dow;
  const nextMonday = new Date(taipeiNow);
  nextMonday.setDate(taipeiNow.getDate() + daysUntilNextMon);
  nextMonday.setHours(0, 0, 0, 0);

  const nextSunday = new Date(nextMonday);
  nextSunday.setDate(nextMonday.getDate() + 6);

  const weekStartStr = formatTaiwanDate(nextMonday);
  const weekEndStr   = formatTaiwanDate(nextSunday);

  // Prune old dedup records (keep last 4 weeks)
  const fourWeeksAgo = new Date(taipeiNow);
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
  await storage.clearOldWeeklyPushNotifications(formatTaiwanDate(fourWeeksAgo)).catch(() => {});

  const weekShifts = await storage.getAllShiftsByDateRange(weekStartStr, weekEndStr);
  const workShifts = weekShifts.filter(s => !LEAVE_TYPES.includes(s.role));

  if (workShifts.length === 0) {
    console.log(`[週班表推播] ${weekStartStr}~${weekEndStr} 無班次，跳過`);
    return { sent: 0, skipped: 0, noLineId: 0 };
  }

  const allVenues = await storage.getAllVenues();
  const venueMap = new Map<number, Venue>();
  for (const v of allVenues) venueMap.set(v.id, v);

  const shiftsByEmployee = new Map<number, Shift[]>();
  for (const s of workShifts) {
    const arr = shiftsByEmployee.get(s.employeeId) || [];
    arr.push(s);
    shiftsByEmployee.set(s.employeeId, arr);
  }

  const dayNames = ["日", "一", "二", "三", "四", "五", "六"];
  let sent = 0, skipped = 0, noLineId = 0;

  for (const [empId, empShifts] of shiftsByEmployee) {
    if (!force) {
      const alreadySent = await storage.hasWeeklyPushNotification(weekStartStr, empId, "schedule");
      if (alreadySent) { skipped++; continue; }
    }

    const emp = await storage.getEmployee(empId);
    if (!emp) { skipped++; continue; }
    if (!emp.lineId) { noLineId++; continue; }

    const shiftsByDate = new Map<string, Shift[]>();
    for (const s of empShifts) {
      const arr = shiftsByDate.get(s.date) || [];
      arr.push(s);
      shiftsByDate.set(s.date, arr);
    }

    const lines: string[] = [];
    lines.push(`📋 下週班表通知`);
    lines.push(`📅 ${nextMonday.getMonth() + 1}/${nextMonday.getDate()} - ${nextSunday.getMonth() + 1}/${nextSunday.getDate()}`);
    lines.push("");

    for (let i = 0; i < 7; i++) {
      const d = new Date(nextMonday);
      d.setDate(nextMonday.getDate() + i);
      const dateStr = formatTaiwanDate(d);
      const dayShifts = (shiftsByDate.get(dateStr) || []).sort((a, b) => a.startTime.localeCompare(b.startTime));
      if (dayShifts.length === 0) continue;

      const dayName = dayNames[d.getDay()];
      lines.push(`▸ ${d.getMonth() + 1}/${d.getDate()}（${dayName}）`);

      for (const shift of dayShifts) {
        const venue = venueMap.get(shift.venueId);
        const venueName = venue?.shortName || venue?.name || "未知場館";
        const start = shift.startTime.substring(0, 5);
        const end   = shift.endTime.substring(0, 5);
        lines.push(`  🏢 ${venueName}  ${start}-${end}`);
        if (shift.isDispatch) lines.push(`  🔸 派遣`);
      }
      lines.push("");
    }

    lines.push("請準時出勤，如需請假請提前告知主管 🙏");
    lines.push("該通知訊息僅做提醒用，實際班別請以系統公告為主。");

    const message = lines.join("\n").trim();
    const ok = await pushToLine(emp.lineId, message);
    if (ok) {
      await storage.createWeeklyPushNotification(weekStartStr, empId, "schedule").catch(e =>
        console.error(`[週班表推播] 去重寫入失敗 empId=${empId}:`, e)
      );
      sent++;
    } else {
      console.error(`[週班表推播] 發送失敗 empId=${empId}`);
      skipped++;
    }
  }

  console.log(`[週班表推播] 完成: 發送 ${sent}, 跳過 ${skipped}, 無LINE ${noLineId}`);
  return { sent, skipped, noLineId };
}

// ── 每週遲到報告（週一 09:00 推上週異常）────────────────────────────────────
export async function sendWeeklyLateReport(force = false): Promise<{ sent: number; skipped: number; noLineId: number }> {
  const taipeiNow = getTaiwanNow();

  // Compute last Monday (start of last week)
  const dow = taipeiNow.getDay(); // 0=Sun, 1=Mon
  const daysToLastMon = dow === 0 ? 6 : dow - 1;
  const lastMonday = new Date(taipeiNow);
  lastMonday.setDate(taipeiNow.getDate() - daysToLastMon - 7);
  lastMonday.setHours(0, 0, 0, 0);

  const lastSunday = new Date(lastMonday);
  lastSunday.setDate(lastMonday.getDate() + 6);

  const weekStartStr = formatTaiwanDate(lastMonday);
  const weekEndStr   = formatTaiwanDate(lastSunday);

  const weekShifts = await storage.getAllShiftsByDateRange(weekStartStr, weekEndStr);
  const workShifts = weekShifts.filter(s => !LEAVE_TYPES.includes(s.role));

  const clockRecs = await storage.getClockRecordsByDateRange(weekStartStr, weekEndStr);

  // Group clock records by employee + date
  type ClockKey = string; // `${empId}:${dateStr}`
  const clocksByEmpDate = new Map<ClockKey, { in?: Date; out?: Date }>();

  for (const cr of clockRecs) {
    if (!cr.clockTime) continue;
    if (cr.status !== "success" && cr.status !== "warning") continue;
    const crDate = new Date(cr.clockTime.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    const dateStr = formatTaiwanDate(crDate);
    const key: ClockKey = `${cr.employeeId}:${dateStr}`;
    const entry = clocksByEmpDate.get(key) || {};

    if (cr.clockType === "in") {
      if (!entry.in || crDate < entry.in) entry.in = crDate; // earliest in
    } else if (cr.clockType === "out") {
      if (!entry.out || crDate > entry.out) entry.out = crDate; // latest out
    }
    clocksByEmpDate.set(key, entry);
  }

  // Group shifts by employee
  const shiftsByEmployee = new Map<number, Shift[]>();
  for (const s of workShifts) {
    const arr = shiftsByEmployee.get(s.employeeId) || [];
    arr.push(s);
    shiftsByEmployee.set(s.employeeId, arr);
  }

  const LATE_THRESHOLD_MIN  = 10;
  const EARLY_THRESHOLD_MIN = 10;

  let sent = 0, skipped = 0, noLineId = 0;

  for (const [empId, empShifts] of shiftsByEmployee) {
    if (!force) {
      const alreadySent = await storage.hasWeeklyPushNotification(weekStartStr, empId, "late_report");
      if (alreadySent) { skipped++; continue; }
    }

    // Collect anomalies for this employee
    type AnomalyEntry = { date: string; dayName: string; shiftLabel: string; issues: string[] };
    const anomalies: AnomalyEntry[] = [];
    const dayNames = ["日", "一", "二", "三", "四", "五", "六"];

    for (const shift of empShifts) {
      const key: ClockKey = `${empId}:${shift.date}`;
      const clocks = clocksByEmpDate.get(key);
      const issues: string[] = [];

      const [sh, sm] = shift.startTime.split(":").map(Number);
      const [eh, em] = shift.endTime.split(":").map(Number);
      const shiftStartMin = sh * 60 + sm;
      const shiftEndMin   = eh * 60 + em;

      if (clocks?.in) {
        const h = clocks.in.getHours(), m = clocks.in.getMinutes();
        const clockInMin = h * 60 + m;
        if (clockInMin - shiftStartMin > LATE_THRESHOLD_MIN) {
          const lateBy = clockInMin - shiftStartMin;
          issues.push(`遲到 ${lateBy} 分鐘（${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")} 上班，預計 ${shift.startTime.substring(0,5)}）`);
        }
      }

      if (clocks?.out) {
        const h = clocks.out.getHours(), m = clocks.out.getMinutes();
        const clockOutMin = h * 60 + m;
        if (shiftEndMin - clockOutMin > EARLY_THRESHOLD_MIN) {
          const earlyBy = shiftEndMin - clockOutMin;
          issues.push(`早退 ${earlyBy} 分鐘（${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")} 下班，預計 ${shift.endTime.substring(0,5)}）`);
        }
      }

      if (issues.length > 0) {
        const d = new Date(shift.date + "T00:00:00+08:00");
        const dayName = dayNames[d.getDay()];
        const m2 = d.getMonth() + 1;
        const dd = d.getDate();
        anomalies.push({
          date: shift.date,
          dayName,
          shiftLabel: `${m2}/${dd}（${dayName}）${shift.startTime.substring(0,5)}-${shift.endTime.substring(0,5)}`,
          issues,
        });
      }
    }

    if (anomalies.length === 0) continue; // no anomalies → don't send

    const emp = await storage.getEmployee(empId);
    if (!emp) { skipped++; continue; }
    if (!emp.lineId) { noLineId++; continue; }

    const lines: string[] = [];
    lines.push(`📊 上週出勤異常通知`);
    lines.push(`📅 ${lastMonday.getMonth()+1}/${lastMonday.getDate()} - ${lastSunday.getMonth()+1}/${lastSunday.getDate()}`);
    lines.push("");

    for (const a of anomalies) {
      lines.push(`▸ ${a.shiftLabel}`);
      for (const issue of a.issues) lines.push(`  ⚠️ ${issue}`);
      lines.push("");
    }

    lines.push("如有疑問，請與主管確認打卡記錄 🙏");

    const message = lines.join("\n").trim();
    const ok = await pushToLine(emp.lineId, message);
    if (ok) {
      await storage.createWeeklyPushNotification(weekStartStr, empId, "late_report").catch(e =>
        console.error(`[週遲到報告] 去重寫入失敗 empId=${empId}:`, e)
      );
      sent++;
    } else {
      console.error(`[週遲到報告] 發送失敗 empId=${empId}`);
      skipped++;
    }
  }

  console.log(`[週遲到報告] 完成: 發送 ${sent}, 跳過 ${skipped}, 無LINE ${noLineId}`);
  return { sent, skipped, noLineId };
}
