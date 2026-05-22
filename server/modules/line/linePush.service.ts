import nodemailer from "nodemailer";
import { storage } from "../../storage";
import type { Venue, Shift, Employee, DispatchShift } from "@shared/schema";
import { getTaiwanNow, formatTaiwanDate } from "./lineHelpers";
import { isValidLineUserId } from "./lineSignature";
import { availabilityRepository } from "../availability/availability.repository";
import { isNonWorkRole } from "@shared/scheduleMapping";

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";

/** 員工入口系統連結（LIFF 或 Web Portal） */
function getSystemLink(): string {
  const liffId = process.env.VITE_LIFF_ID;
  if (liffId) return `https://liff.line.me/${liffId}`;
  return "";
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

const _guidelinePushRecord = new Map<number, string>();

export async function pushPendingGuidelinesIfAny(employeeId: number, lineId: string): Promise<void> {
  if (!isValidLineUserId(lineId)) return;
  try {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const monthStart = `${yearMonth}-01`;
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const monthEnd = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;

    const [allGuidelines, acks, empShifts, empDispatchShifts] = await Promise.all([
      storage.getGuidelines(),
      storage.getGuidelineAcksByEmployee(employeeId),
      storage.getShiftsByEmployeeAndDateRange(employeeId, monthStart, monthEnd),
      storage.getDispatchShiftsByLinkedEmployee(employeeId, monthStart, monthEnd),
    ]);

    const myVenueIds = Array.from(new Set([
      ...empShifts.filter(s => !isNonWorkRole(s.role)).map(s => s.venueId),
      ...empDispatchShifts.map(s => s.venueId).filter((venueId): venueId is number => venueId != null),
    ]));

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
  const workShifts = allShifts.filter(s => !isNonWorkRole(s.role));

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
    lines.push("⚠️ 該通知訊息僅做提醒用，實際班別/課表請以系統公告為主。");
    const sysLink = getSystemLink();
    if (sysLink) {
      lines.push(`🔗 請登入系統查看: ${sysLink}`);
    }

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
export function resetMissingClockInTracker() {
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

  const [allShifts, allRegions] = await Promise.all([
    storage.getShiftsByDate(todayStr),
    storage.getRegions(),
  ]);
  const dispatchNested = await Promise.all(
    allRegions.map((region) => storage.getDispatchShifts(region.id, todayStr, todayStr)),
  );
  const workShifts = allShifts.filter(s =>
    !isNonWorkRole(s.role) &&
    s.startTime.substring(0, 5) !== s.endTime.substring(0, 5)
  );
  const linkedDispatchShifts = dispatchNested.flat().filter((d) =>
    d.linkedEmployeeId != null &&
    d.startTime.substring(0, 5) !== d.endTime.substring(0, 5)
  );

  if (workShifts.length === 0 && linkedDispatchShifts.length === 0) {
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
  console.log(`[未打卡提醒] 今日班次總數: ${workShifts.length + linkedDispatchShifts.length}，當前時間: ${currentTimeStr}`);

  const allVenues = await storage.getAllVenues();
  const venueMap = new Map<number, Venue>();
  for (const v of allVenues) venueMap.set(v.id, v);

  type MissingClockAssignment = {
    employeeId: number;
    assignmentId: number;
    startTime: string;
    endTime: string;
    venueId: number | null;
    isDispatch: boolean;
  };
  const assignments: MissingClockAssignment[] = [
    ...workShifts.map((shift) => ({
      employeeId: shift.employeeId,
      assignmentId: shift.id,
      startTime: shift.startTime,
      endTime: shift.endTime,
      venueId: shift.venueId,
      isDispatch: false,
    })),
    ...linkedDispatchShifts.map((shift) => ({
      employeeId: shift.linkedEmployeeId!,
      assignmentId: -shift.id,
      startTime: shift.startTime,
      endTime: shift.endTime,
      venueId: shift.venueId,
      isDispatch: true,
    })),
  ];

  const missingEmployees: Array<{ emp: Employee; assignment: MissingClockAssignment; venueName: string }> = [];

  for (const assignment of assignments) {
    const shiftStart = assignment.startTime.substring(0, 5);
    const [shiftH, shiftM] = shiftStart.split(":").map(Number);
    const lateThresholdMin = (shiftH * 60 + shiftM) + 15;
    const currentMin = currentHour * 60 + currentMinute;

    if (currentMin < lateThresholdMin) {
      console.log(`[未打卡提醒] 跳過（未到閾值）: 員工ID=${assignment.employeeId} 班次=${shiftStart} 閾值=${Math.floor(lateThresholdMin/60)}:${String(lateThresholdMin%60).padStart(2,"0")}`);
      continue;
    }

    if (clockedInEmployees.has(assignment.employeeId)) {
      console.log(`[未打卡提醒] 跳過（已打卡）: 員工ID=${assignment.employeeId} 班次=${shiftStart}`);
      continue;
    }

    const notifyKey = `${assignment.employeeId}-${assignment.assignmentId}`;
    if (alreadySentKeys.has(notifyKey)) {
      console.log(`[未打卡提醒] 跳過（DB已記錄通知過）: 員工ID=${assignment.employeeId} 班次=${shiftStart}`);
      continue;
    }

    const emp = await storage.getEmployee(assignment.employeeId);
    if (!emp || emp.status !== "active") continue;

    const venue = assignment.venueId ? venueMap.get(assignment.venueId) : null;
    const venueName = venue?.shortName || venue?.name || (assignment.isDispatch ? "派遣" : "未知場館");

    missingEmployees.push({ emp, assignment, venueName });
    // Mark in local set so within this run we don't double-process
    alreadySentKeys.add(notifyKey);
  }

  if (missingEmployees.length === 0) {
    return { notified: 0, skipped: 0 };
  }

  let notified = 0;
  let skipped = 0;

  for (const { emp, assignment, venueName } of missingEmployees) {
    const shiftStart = assignment.startTime.substring(0, 5);
    const shiftEnd = assignment.endTime.substring(0, 5);

    console.log(`[未打卡提醒] 發送通知: ${emp.name}（ID=${emp.id}）班次=${shiftStart}-${shiftEnd} 場館=${venueName} lineId=${emp.lineId ? "有" : "無"}`);
    if (emp.lineId) {
      const sysLinkClock = getSystemLink();
      const lineMsg = [
        `⚠️ 打卡提醒`,
        ``,
        `${emp.name} 您好，`,
        `您今日 ${venueName} 的班次（${shiftStart}-${shiftEnd}）已超過上班時間，但系統尚未收到您的打卡紀錄。`,
        ``,
        `您尚未打卡，如需補卡請證明您早上未遲到。`,
        ...(sysLinkClock ? [`🔗 請登入系統: ${sysLinkClock}`] : []),
      ].join("\n");

      try {
        await pushToLine(emp.lineId, lineMsg);
        console.log(`[未打卡提醒] LINE推播成功: ${emp.name}`);
      } catch (err) {
        console.error(`[未打卡提醒] LINE推播失敗 ${emp.name}:`, err);
      }
    }

    // Persist to DB so server restarts don't cause re-notification for this shift
    await storage.createMissingClockNotification(todayStr, emp.id, assignment.assignmentId).catch((e) =>
      console.error(`[未打卡提醒] DB 寫入失敗 empId=${emp.id} shiftId=${assignment.assignmentId}:`, e)
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

      const tableRows = missingEmployees.map(({ emp, assignment, venueName }) => {
        const shiftStart = assignment.startTime.substring(0, 5);
        const shiftEnd = assignment.endTime.substring(0, 5);
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

  const [weekShifts, regions] = await Promise.all([
    storage.getAllShiftsByDateRange(weekStartStr, weekEndStr),
    storage.getRegions(),
  ]);
  const weekDispatch = await Promise.all(
    regions.map((region) => storage.getDispatchShifts(region.id, weekStartStr, weekEndStr)),
  );
  const workShifts = weekShifts.filter(s => !isNonWorkRole(s.role));
  const linkedDispatch = weekDispatch.flat().filter((d) => d.linkedEmployeeId != null);

  if (workShifts.length === 0 && linkedDispatch.length === 0) {
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
  const dispatchByEmployee = new Map<number, DispatchShift[]>();
  for (const d of linkedDispatch) {
    const empId = d.linkedEmployeeId!;
    const arr = dispatchByEmployee.get(empId) || [];
    arr.push(d);
    dispatchByEmployee.set(empId, arr);
  }

  const dayNames = ["日", "一", "二", "三", "四", "五", "六"];
  let sent = 0, skipped = 0, noLineId = 0;

  const employeeIds = new Set([...shiftsByEmployee.keys(), ...dispatchByEmployee.keys()]);
  for (const empId of employeeIds) {
    if (!force) {
      const alreadySent = await storage.hasWeeklyPushNotification(weekStartStr, empId, "schedule");
      if (alreadySent) { skipped++; continue; }
    }

    const emp = await storage.getEmployee(empId);
    if (!emp) { skipped++; continue; }
    if (!emp.lineId) { noLineId++; continue; }

    const empShifts = shiftsByEmployee.get(empId) || [];
    const empDispatch = dispatchByEmployee.get(empId) || [];
    const shiftsByDate = new Map<string, Shift[]>();
    for (const s of empShifts) {
      const arr = shiftsByDate.get(s.date) || [];
      arr.push(s);
      shiftsByDate.set(s.date, arr);
    }
    const dispatchByDate = new Map<string, DispatchShift[]>();
    for (const d of empDispatch) {
      const arr = dispatchByDate.get(d.date) || [];
      arr.push(d);
      dispatchByDate.set(d.date, arr);
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
      const dayDispatch = (dispatchByDate.get(dateStr) || []).sort((a, b) => a.startTime.localeCompare(b.startTime));
      if (dayShifts.length === 0 && dayDispatch.length === 0) continue;

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
      for (const ds of dayDispatch) {
        const venue = ds.venueId ? venueMap.get(ds.venueId) : null;
        const venueName = venue?.shortName || venue?.name || "外派場館";
        const start = ds.startTime.substring(0, 5);
        const end = ds.endTime.substring(0, 5);
        lines.push(`  🏢 ${venueName}  ${start}-${end}`);
        lines.push(`  🔸 外部派遣班次`);
      }
      lines.push("");
    }

    lines.push("請準時出勤，如需請假請提前告知主管 🙏");
    lines.push("");
    lines.push("⚠️ 該通知訊息僅做提醒用，實際班別請以系統公告為主。");
    const sysLinkWeekly = getSystemLink();
    if (sysLinkWeekly) {
      lines.push(`🔗 請登入系統查看: ${sysLinkWeekly}`);
    }

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

  const [weekShifts, regions] = await Promise.all([
    storage.getAllShiftsByDateRange(weekStartStr, weekEndStr),
    storage.getRegions(),
  ]);
  const weekDispatch = await Promise.all(
    regions.map((region) => storage.getDispatchShifts(region.id, weekStartStr, weekEndStr)),
  );
  const workShifts = weekShifts.filter(s => !isNonWorkRole(s.role));
  const linkedDispatch = weekDispatch.flat().filter((d) => d.linkedEmployeeId != null);

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

  // Group work assignments by employee.
  type WorkAssignment = {
    employeeId: number;
    date: string;
    startTime: string;
    endTime: string;
    isDispatch: boolean;
  };
  const assignmentsByEmployee = new Map<number, WorkAssignment[]>();
  for (const s of workShifts) {
    const arr = assignmentsByEmployee.get(s.employeeId) || [];
    arr.push({
      employeeId: s.employeeId,
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
      isDispatch: false,
    });
    assignmentsByEmployee.set(s.employeeId, arr);
  }
  for (const d of linkedDispatch) {
    const employeeId = d.linkedEmployeeId!;
    const arr = assignmentsByEmployee.get(employeeId) || [];
    arr.push({
      employeeId,
      date: d.date,
      startTime: d.startTime,
      endTime: d.endTime,
      isDispatch: true,
    });
    assignmentsByEmployee.set(employeeId, arr);
  }

  const LATE_THRESHOLD_MIN  = 10;
  const EARLY_THRESHOLD_MIN = 10;

  let sent = 0, skipped = 0, noLineId = 0;

  for (const [empId, empAssignments] of assignmentsByEmployee) {
    if (!force) {
      const alreadySent = await storage.hasWeeklyPushNotification(weekStartStr, empId, "late_report");
      if (alreadySent) { skipped++; continue; }
    }

    // Collect anomalies for this employee
    type AnomalyEntry = { date: string; dayName: string; shiftLabel: string; issues: string[] };
    const anomalies: AnomalyEntry[] = [];
    const dayNames = ["日", "一", "二", "三", "四", "五", "六"];

    for (const assignment of empAssignments) {
      const key: ClockKey = `${empId}:${assignment.date}`;
      const clocks = clocksByEmpDate.get(key);
      const issues: string[] = [];

      const [sh, sm] = assignment.startTime.split(":").map(Number);
      const [eh, em] = assignment.endTime.split(":").map(Number);
      const shiftStartMin = sh * 60 + sm;
      const shiftEndMin   = eh * 60 + em;

      if (clocks?.in) {
        const h = clocks.in.getHours(), m = clocks.in.getMinutes();
        const clockInMin = h * 60 + m;
        if (clockInMin - shiftStartMin > LATE_THRESHOLD_MIN) {
          const lateBy = clockInMin - shiftStartMin;
          issues.push(`遲到 ${lateBy} 分鐘（${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")} 上班，預計 ${assignment.startTime.substring(0,5)}）`);
        }
      }

      if (clocks?.out) {
        const h = clocks.out.getHours(), m = clocks.out.getMinutes();
        const clockOutMin = h * 60 + m;
        if (shiftEndMin - clockOutMin > EARLY_THRESHOLD_MIN) {
          const earlyBy = shiftEndMin - clockOutMin;
          issues.push(`早退 ${earlyBy} 分鐘（${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")} 下班，預計 ${assignment.endTime.substring(0,5)}）`);
        }
      }

      if (issues.length > 0) {
        const d = new Date(assignment.date + "T00:00:00+08:00");
        const dayName = dayNames[d.getDay()];
        const m2 = d.getMonth() + 1;
        const dd = d.getDate();
        anomalies.push({
          date: assignment.date,
          dayName,
          shiftLabel: `${m2}/${dd}（${dayName}）${assignment.startTime.substring(0,5)}-${assignment.endTime.substring(0,5)}${assignment.isDispatch ? " 派遣" : ""}`,
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

// ── 意願填報截止前提醒（每日 10:00 檢查）────────────────────────────────────

interface AvailWindowEntry { openFrom: string; openUntil: string; }
interface AvailWindowConfig {
  targetYearMonth: string;
  windows?: AvailWindowEntry[];
  openFrom?: string;
  openUntil?: string;
}

/**
 * 若目前有開放中的意願填寫視窗且距截止日 ≤ reminderDaysBeforeClose 天，
 * 對尚未在該視窗對應月份填過任何意願的活躍員工發送 LINE 提醒。
 */
export async function sendAvailabilityReminders(
  force = false,
  reminderDaysBeforeClose = 3
): Promise<{ sent: number; skipped: number; noLineId: number; windowClosed: boolean }> {
  const taipeiNow = getTaiwanNow();
  const todayStr = formatTaiwanDate(taipeiNow);

  const cfg = await storage.getSystemConfig("availability_window");
  if (!cfg?.value) {
    console.log("[意願提醒] 尚未設定意願填寫視窗，略過");
    return { sent: 0, skipped: 0, noLineId: 0, windowClosed: true };
  }

  let raw: AvailWindowConfig;
  try { raw = JSON.parse(cfg.value) as AvailWindowConfig; } catch {
    console.log("[意願提醒] 意願填寫設定格式錯誤，略過");
    return { sent: 0, skipped: 0, noLineId: 0, windowClosed: true };
  }

  if (!/^\d{4}-\d{2}$/.test(raw.targetYearMonth)) {
    console.log("[意願提醒] targetYearMonth 格式錯誤，略過");
    return { sent: 0, skipped: 0, noLineId: 0, windowClosed: true };
  }

  // Support both new shape (windows array) and legacy flat shape (openFrom/openUntil at top level)
  const windows: AvailWindowEntry[] = raw.windows ??
    (raw.openFrom ? [{ openFrom: raw.openFrom, openUntil: raw.openUntil ?? "" }] : []);

  // Find a window that is currently open AND closes within reminderDaysBeforeClose days
  const activeWindow = windows.find(w => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(w.openFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(w.openUntil)) return false;
    if (todayStr < w.openFrom || todayStr > w.openUntil) return false;
    const closeDate = new Date(w.openUntil + "T00:00:00+08:00");
    const today = new Date(todayStr + "T00:00:00+08:00");
    const daysLeft = Math.round((closeDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return force || daysLeft <= reminderDaysBeforeClose;
  });

  if (!activeWindow) {
    console.log(`[意願提醒] 目前無符合提醒條件的開放視窗（今日=${todayStr}，提醒條件：距截止 ≤ ${reminderDaysBeforeClose} 天），略過`);
    return { sent: 0, skipped: 0, noLineId: 0, windowClosed: true };
  }

  const { targetYearMonth } = raw;
  console.log(`[意願提醒] 視窗 ${activeWindow.openFrom}~${activeWindow.openUntil}，目標月份 ${targetYearMonth}，開始檢查未填員工`);

  const [allEmployees, submittedEntries] = await Promise.all([
    storage.getAllEmployees(),
    availabilityRepository.getByYearMonth(targetYearMonth),
  ]);

  const submittedEmployeeIds = new Set(submittedEntries.map(e => e.employeeId));

  const activeEmployees = allEmployees.filter(e => e.status === "active");
  const unsubmitted = activeEmployees.filter(e => !submittedEmployeeIds.has(e.id));

  console.log(`[意願提醒] 活躍員工 ${activeEmployees.length} 人，已填 ${submittedEmployeeIds.size} 人，未填 ${unsubmitted.length} 人`);

  if (unsubmitted.length === 0) {
    return { sent: 0, skipped: 0, noLineId: 0, windowClosed: false };
  }

  const [y, mStr] = targetYearMonth.split("-");
  const monthLabel = `${y} 年 ${parseInt(mStr, 10)} 月`;
  const deadlineLabel = `${activeWindow.openUntil.slice(5, 7)}/${activeWindow.openUntil.slice(8, 10)}`;
  const sysLink = getSystemLink();

  let sent = 0, skipped = 0, noLineId = 0;

  for (const emp of unsubmitted) {
    if (!emp.lineId) { noLineId++; continue; }
    if (!isValidLineUserId(emp.lineId)) { noLineId++; continue; }

    const lines: string[] = [
      `📝 排班意願填報提醒`,
      ``,
      `${emp.name} 您好，`,
      `${monthLabel}的排班意願填報視窗尚未截止，`,
      `但系統顯示您尚未填寫任何意願。`,
      ``,
      `📅 截止日期：${deadlineLabel}`,
      ``,
      `請盡快登入員工入口完成填報，謝謝！`,
    ];
    if (sysLink) lines.push(`🔗 ${sysLink}`);

    const message = lines.join("\n");
    const ok = await pushToLine(emp.lineId, message);
    if (ok) {
      sent++;
    } else {
      console.error(`[意願提醒] LINE 推播失敗 empId=${emp.id}`);
      skipped++;
    }
  }

  console.log(`[意願提醒] 完成: 發送 ${sent}, 跳過 ${skipped}, 無LINE ${noLineId}`);
  return { sent, skipped, noLineId, windowClosed: false };
}
