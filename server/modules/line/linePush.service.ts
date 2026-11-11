import { createHash } from "node:crypto";
import { pushMessages, pushMessagesResult } from "../../adapters/line";
import { MAIL_SENDER, sendMail } from "../../adapters/mail";
import { wrapNotificationHtml } from "../../shared/email/notificationLayout";
import type { Venue, Shift, Employee, DispatchShift } from "@shared/schema";
import { getTaiwanNow, formatTaiwanDate } from "./lineHelpers";
import { isValidLineUserId } from "./lineSignature";
import { isReviewableWorkShift, shiftReviewService } from "../shift/shiftReview.service";
import { guidelineService } from "../guideline/guideline.service";
import { shiftService } from "../shift/shift.service";
import { venueService } from "../venue/venue.service";
import { dispatchService } from "../dispatch/dispatch.service";
import { employeeService } from "../employee/employee.service";
import { systemService } from "../system/system.service";
import { clockService } from "../clock/clock.service";
import { notificationService } from "../notification/notification.service";
import { availabilityService } from "../availability/availability.service";
import { pushOnce, prunePushRecords } from "./pushOnce.service";

const LINE_FLEX_TEXT_LIMIT = 5000;

/** 員工入口系統連結（LIFF 或 Web Portal） */
function getSystemLink(): string {
  const liffId = process.env.VITE_LIFF_ID;
  if (liffId) return `https://liff.line.me/${liffId}`;
  return "";
}

function clampLineText(text: string, max = LINE_FLEX_TEXT_LIMIT): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 24).trimEnd()}\n\n...內容較長，請至系統查看完整資訊`;
}

function detectTone(text: string): { accent: string; softAccent: string; titleIcon: string } {
  if (/❌|🔴|失敗|錯誤|異常|未打卡/.test(text)) {
    return { accent: "#DC2626", softAccent: "#FEF2F2", titleIcon: "!" };
  }
  if (/⚠|遲到|早退|提醒|尚未|警告/.test(text)) {
    return { accent: "#D97706", softAccent: "#FFFBEB", titleIcon: "!" };
  }
  if (/✅|成功|正常|完成/.test(text)) {
    return { accent: "#059669", softAccent: "#ECFDF5", titleIcon: "✓" };
  }
  return { accent: "#2563EB", softAccent: "#EFF6FF", titleIcon: "i" };
}

function buildDecoratedFlexMessage(text: string): object {
  const safeText = clampLineText(text.trim() || "系統通知");
  const lines = safeText.split("\n");
  const firstNonEmpty = lines.find(line => line.trim())?.trim() || "系統通知";
  const title = firstNonEmpty.replace(/^[^\p{L}\p{N}]+/u, "").trim() || "系統通知";
  const bodyText = safeText;
  const tone = detectTone(safeText);

  return {
    type: "flex",
    altText: title.slice(0, 400),
    contents: {
      type: "bubble",
      size: "mega",
      styles: {
        body: { backgroundColor: "#FFFFFF" },
        footer: { backgroundColor: "#FFFFFF" },
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "0px",
        backgroundColor: "#FFFFFF",
        contents: [
          {
            type: "box",
            layout: "vertical",
            paddingAll: "18px",
            backgroundColor: tone.softAccent,
            borderWidth: "2px",
            borderColor: tone.accent,
            cornerRadius: "18px",
            contents: [
              {
                type: "box",
                layout: "horizontal",
                spacing: "10px",
                alignItems: "center",
                contents: [
                  {
                    type: "box",
                    layout: "vertical",
                    width: "30px",
                    height: "30px",
                    cornerRadius: "15px",
                    backgroundColor: tone.accent,
                    justifyContent: "center",
                    alignItems: "center",
                    contents: [
                      {
                        type: "text",
                        text: tone.titleIcon,
                        color: "#FFFFFF",
                        weight: "bold",
                        size: "md",
                        align: "center",
                      },
                    ],
                  },
                  {
                    type: "text",
                    text: title,
                    size: "lg",
                    weight: "bold",
                    color: "#111827",
                    wrap: true,
                    flex: 1,
                  },
                ],
              },
              {
                type: "separator",
                margin: "md",
                color: "#E5E7EB",
              },
              {
                type: "text",
                text: bodyText,
                size: "sm",
                color: "#1F2937",
                wrap: true,
                margin: "md",
                lineSpacing: "5px",
              },
            ],
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingTop: "8px",
        paddingBottom: "12px",
        paddingStart: "16px",
        paddingEnd: "16px",
        contents: [
          {
            type: "text",
            text: "Juns Sports Smart Schedule",
            size: "xxs",
            color: "#9CA3AF",
            align: "center",
          },
        ],
      },
    },
  };
}

export async function pushToLine(userId: string, text: string, extraMessages?: object[]): Promise<boolean> {
  const messages: object[] = [buildDecoratedFlexMessage(text)];
  if (extraMessages) messages.push(...extraMessages);
  return pushMessages(userId, messages);
}

export function pushToLineResult(userId: string, text: string, retryKey: string): ReturnType<typeof pushMessagesResult> {
  return pushMessagesResult(userId, [buildDecoratedFlexMessage(text)], retryKey);
}

export async function pushPendingGuidelinesIfAny(employeeId: number, lineId: string): Promise<void> {
  if (!isValidLineUserId(lineId)) return;
  try {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const monthStart = `${yearMonth}-01`;
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const monthEnd = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;

    const [allGuidelines, acks, empShifts] = await Promise.all([
      guidelineService.getGuidelines(),
      guidelineService.getGuidelineAcksByEmployee(employeeId),
      shiftService.getShiftsByEmployeeAndDateRange(employeeId, monthStart, monthEnd),
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
    const toPush = relevant.slice(0, 2);
    const total = relevant.length;
    const intro = `📋 您有 ${total} 條守則尚未確認\n`;
    const list = toPush.map(g => `▶ ${g.title}`).join("\n");
    const suffix = total > 2 ? `\n…等共 ${total} 條` : "";
    const link = "\n\n請至員工入口「守則」頁面確認閱讀。";
    // The signature changes when the unread set or a guideline changes, and a long one would not fit a key.
    const digest = createHash("sha1").update(signature).digest("hex");
    await pushOnce({ scope: "guideline", period: yearMonth, employeeId, refId: digest }, (retryKey) => pushToLineResult(lineId, intro + list + suffix + link, retryKey));
  } catch (err) {
    console.error("[Guidelines Push] Error:", err);
  }
}

export async function sendShiftReminders(): Promise<{ sent: number; unknown: number; skipped: number; noLineId: number }> {
  const taipeiNow = getTaiwanNow();

  const tomorrow = new Date(taipeiNow);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = formatTaiwanDate(tomorrow);

  const dayNames = ["日", "一", "二", "三", "四", "五", "六"];
  const tomorrowDay = dayNames[tomorrow.getDay()];
  const displayDate = `${tomorrow.getMonth() + 1}/${tomorrow.getDate()}（${tomorrowDay}）`;

  const allShifts = await shiftService.getShiftsByDate(tomorrowStr);
  const workShifts = allShifts.filter(isReviewableWorkShift);

  const allVenues = await venueService.findAll();
  const venueMap = new Map<number, Venue>();
  for (const v of allVenues) venueMap.set(v.id, v);

  const shiftsByEmployee = new Map<number, Shift[]>();
  for (const s of workShifts) {
    const arr = shiftsByEmployee.get(s.employeeId) || [];
    arr.push(s);
    shiftsByEmployee.set(s.employeeId, arr);
  }

  const dispatchTomorrow = await dispatchService.getDispatchShiftsByDate(tomorrowStr);
  const linkedDispatchByEmployee = new Map<number, DispatchShift[]>();
  for (const d of dispatchTomorrow) {
    if (!d.linkedEmployeeId) continue;
    if (!isReviewableWorkShift(d)) continue;
    const arr = linkedDispatchByEmployee.get(d.linkedEmployeeId) || [];
    arr.push(d);
    linkedDispatchByEmployee.set(d.linkedEmployeeId, arr);
  }

  const allEmpIds = new Set([...shiftsByEmployee.keys(), ...linkedDispatchByEmployee.keys()]);

  if (allEmpIds.size === 0) {
    console.log(`[推撥] ${tomorrowStr} 無上班班次，跳過推撥`);
    return { sent: 0, unknown: 0, skipped: 0, noLineId: 0 };
  }

  let sent = 0;
  let unknown = 0;
  let skipped = 0;
  let noLineId = 0;

  for (const empId of allEmpIds) {
    const emp = await employeeService.getEmployee(empId);
    if (!emp) { skipped++; continue; }
    if (!emp.lineId) { noLineId++; continue; }

    const empShifts = shiftsByEmployee.get(empId) || [];
    const empDispatch = linkedDispatchByEmployee.get(empId) || [];
    const reviewedShifts: Shift[] = [];
    const reviewedDispatch: DispatchShift[] = [];
    for (const shift of empShifts) {
      const reviewed = await shiftReviewService.reviewRegularShiftForPush(shift);
      if (reviewed) reviewedShifts.push(reviewed);
    }
    for (const dispatchShift of empDispatch) {
      const reviewed = await shiftReviewService.reviewDispatchShiftForPush(dispatchShift);
      if (reviewed) reviewedDispatch.push(reviewed);
    }
    if (reviewedShifts.length === 0 && reviewedDispatch.length === 0) {
      console.log(`[推撥] 跳過（推播前班表審查無有效班）: empId=${empId} date=${tomorrowStr}`);
      skipped++;
      continue;
    }
    const sortedShifts = reviewedShifts.sort((a, b) => a.startTime.localeCompare(b.startTime));
    const sortedDispatch = reviewedDispatch.sort((a, b) => a.startTime.localeCompare(b.startTime));

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
    const lineId = emp.lineId;

    const { outcome } = await pushOnce({ scope: "shift-reminder", period: tomorrowStr, employeeId: empId }, (retryKey) => pushToLineResult(lineId, message, retryKey));
    if (outcome === "sent") {
      sent++;
    } else {
      if (outcome !== "skipped") console.error(`[推撥] 發送失敗或結果不明 empId=${empId} (${outcome})`);
      if (outcome === "unknown") unknown++; else skipped++;
    }
  }

  console.log(`[推撥] 完成: 發送 ${sent}, 結果不明 ${unknown}, 跳過 ${skipped}, 無LINE ${noLineId}`);
  return { sent, unknown, skipped, noLineId };
}

// 未打卡通知的去重存在資料庫（missing_clock_notifications），重啟不會重複發。

async function sendMissingClockInEmail(to: string[], subject: string, html: string) {
  await sendMail({
    from: `"DAOS 打卡提醒系統" <${MAIL_SENDER}>`,
    to: to.join(", "),
    subject,
    html: wrapNotificationHtml(html),
  });
}

export async function checkMissingClockIn(): Promise<{ notified: number; unknown: number; skipped: number }> {
  const taipeiNow = getTaiwanNow();
  const todayStr = formatTaiwanDate(taipeiNow);
  const currentHour = taipeiNow.getHours();

  // Load today's already-sent notifications from DB (survives server restarts)
  const alreadySentRows = await systemService.getMissingClockNotificationsForDate(todayStr);
  const alreadySentKeys = new Set(alreadySentRows.map(r => `${r.employeeId}-${r.shiftId}`));

  // Clean up old notification records (older than yesterday) to keep the table lean
  const yesterday = new Date(taipeiNow);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,"0")}-${String(yesterday.getDate()).padStart(2,"0")}`;
  await systemService.clearOldMissingClockNotifications(yesterdayStr).catch(() => {}); // non-critical
  await prunePushRecords().catch(() => {}); // non-critical

  const currentMinute = taipeiNow.getMinutes();
  const currentTimeStr = `${String(currentHour).padStart(2, "0")}:${String(currentMinute).padStart(2, "0")}`;

  const allShifts = await shiftService.getShiftsByDate(todayStr);
  const workShifts = allShifts.filter(isReviewableWorkShift);

  if (workShifts.length === 0) {
    console.log(`[未打卡提醒] ${todayStr} 無上班班次`);
    return { notified: 0, unknown: 0, skipped: 0 };
  }

  const clockRecords = await clockService.getClockRecordsByDateRange(todayStr, todayStr);
  const clockedInEmployees = new Set<number>();
  for (const cr of clockRecords) {
    if (cr.clockType === "in" && (cr.status === "success" || cr.status === "warning")) {
      clockedInEmployees.add(cr.employeeId);
    }
  }
  console.log(`[未打卡提醒] 今日有效上班打卡人數: ${clockedInEmployees.size}，員工ID列表: [${Array.from(clockedInEmployees).join(", ")}]`);
  console.log(`[未打卡提醒] 今日班次總數: ${workShifts.length}，當前時間: ${currentTimeStr}`);

  const allVenues = await venueService.findAll();
  const venueMap = new Map<number, Venue>();
  for (const v of allVenues) venueMap.set(v.id, v);

  const missingEmployees: Array<{ emp: Employee; shift: Shift; venueName: string }> = [];
  let skipped = 0;

  for (const candidateShift of workShifts) {
    const shift = await shiftReviewService.reviewRegularShiftForPush(candidateShift);
    if (!shift) {
      console.log(`[未打卡提醒] 跳過（推播前班表審查無有效班）: 員工ID=${candidateShift.employeeId} shiftId=${candidateShift.id}`);
      skipped++;
      continue;
    }

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

    const emp = await employeeService.getEmployee(shift.employeeId);
    if (!emp || emp.status !== "active") continue;

    const venue = venueMap.get(shift.venueId);
    const venueName = venue?.shortName || venue?.name || "未知場館";

    missingEmployees.push({ emp, shift, venueName });
    // Mark in local set so within this run we don't double-process
    alreadySentKeys.add(notifyKey);
  }

  if (missingEmployees.length === 0) {
    return { notified: 0, unknown: 0, skipped };
  }

  let notified = 0;
  let unknown = 0;
  // Only a newly inserted slot adds the employee to the managers' email; refused and stale retries stay quiet.
  const reported: typeof missingEmployees = [];

  for (const item of missingEmployees) {
    const { emp, shift, venueName } = item;
    const shiftStart = shift.startTime.substring(0, 5);
    const shiftEnd = shift.endTime.substring(0, 5);
    const lineId = emp.lineId;

    console.log(`[未打卡提醒] 發送通知: 員工 ID=${emp.id}班次=${shiftStart}-${shiftEnd} 場館=${venueName} lineId=${lineId ? "有" : "無"}`);
    const sendLine = async (retryKey: string) => {
      if (!lineId) return "accepted" as const; // nobody to push to: the slot is settled so the managers' email does not repeat it
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
      return pushToLineResult(lineId, lineMsg, retryKey);
    };

    const { outcome, attempt, reclaimed } = await pushOnce({ scope: "missing-clock", period: todayStr, employeeId: emp.id, refId: String(shift.id) }, sendLine);
    if (outcome === "sent") {
      console.log(`[未打卡提醒] LINE推播成功: 員工 ID=${emp.id}`);
      notified++;
    } else if (outcome !== "skipped") {
      if (outcome === "unknown") unknown++;
      console.error(`[未打卡提醒] LINE推播失敗或結果不明 員工 ID=${emp.id} (${outcome})，${outcome === "failed" ? "下一輪重推" : "租約到期後可接手重試"}`);
    }
    if (attempt === 1 && !reclaimed) reported.push(item);
  }

  try {
    const recipients = reported.length > 0 ? await notificationService.findAll() : [];
    const targets = recipients.filter(r => r.enabled && r.notifyNewReport);
    if (targets.length > 0) {
      const dayNames = ["日", "一", "二", "三", "四", "五", "六"];
      const dayName = dayNames[taipeiNow.getDay()];
      const displayDate = `${taipeiNow.getMonth() + 1}/${taipeiNow.getDate()}（${dayName}）`;

      const tableRows = reported.map(({ emp, shift, venueName }) => {
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
        `⚠️ 員工未打卡提醒 — ${displayDate}（${reported.length} 位）`,
        emailHtml
      );
      console.log(`[未打卡提醒] 已發送 email 給 ${targets.length} 位管理員`);
    }
  } catch (err) {
    console.error("[未打卡提醒] Email發送失敗:", err);
  }

  console.log(`[未打卡提醒] 完成: 通知 ${notified}, 結果不明 ${unknown}, 跳過 ${skipped}`);
  return { notified, unknown, skipped };
}

// ── 每週班表推播（週日 12:00 推下週班表，排程見 bootstrap/scheduler.ts）─────────────────────────────────────
export async function sendWeeklySchedulePush(): Promise<{ sent: number; unknown: number; skipped: number; noLineId: number }> {
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
  await systemService.clearOldWeeklyPushNotifications(formatTaiwanDate(fourWeeksAgo)).catch(() => {});

  const weekShifts = await shiftService.getAllShiftsByDateRange(weekStartStr, weekEndStr);
  const workShifts = weekShifts.filter(isReviewableWorkShift);

  if (workShifts.length === 0) {
    console.log(`[週班表推播] ${weekStartStr}~${weekEndStr} 無班次，跳過`);
    return { sent: 0, unknown: 0, skipped: 0, noLineId: 0 };
  }

  const allVenues = await venueService.findAll();
  const venueMap = new Map<number, Venue>();
  for (const v of allVenues) venueMap.set(v.id, v);

  const shiftsByEmployee = new Map<number, Shift[]>();
  for (const s of workShifts) {
    const arr = shiftsByEmployee.get(s.employeeId) || [];
    arr.push(s);
    shiftsByEmployee.set(s.employeeId, arr);
  }

  const dayNames = ["日", "一", "二", "三", "四", "五", "六"];
  let sent = 0, unknown = 0, skipped = 0, noLineId = 0;

  for (const [empId, empShifts] of shiftsByEmployee) {
    // Weeks pushed before push_dedup existed were recorded here; nothing writes to it any more.
    if (await systemService.hasWeeklyPushNotification(weekStartStr, empId, "schedule")) { skipped++; continue; }

    const emp = await employeeService.getEmployee(empId);
    if (!emp) { skipped++; continue; }
    if (!emp.lineId) { noLineId++; continue; }

    const reviewedShifts: Shift[] = [];
    for (const shift of empShifts) {
      const reviewed = await shiftReviewService.reviewRegularShiftForPush(shift);
      if (reviewed) reviewedShifts.push(reviewed);
    }
    if (reviewedShifts.length === 0) {
      console.log(`[週班表推播] 跳過（推播前班表審查無有效班）: empId=${empId} week=${weekStartStr}`);
      skipped++;
      continue;
    }

    const shiftsByDate = new Map<string, Shift[]>();
    for (const s of reviewedShifts) {
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
    lines.push("");
    lines.push("⚠️ 該通知訊息僅做提醒用，實際班別請以系統公告為主。");
    const sysLinkWeekly = getSystemLink();
    if (sysLinkWeekly) {
      lines.push(`🔗 請登入系統查看: ${sysLinkWeekly}`);
    }

    const message = lines.join("\n").trim();
    const lineId = emp.lineId;
    const { outcome } = await pushOnce({ scope: "weekly-schedule", period: weekStartStr, employeeId: empId }, (retryKey) => pushToLineResult(lineId, message, retryKey));
    if (outcome === "sent") {
      sent++;
    } else {
      if (outcome !== "skipped") console.error(`[週班表推播] 發送失敗或結果不明 empId=${empId} (${outcome})`);
      if (outcome === "unknown") unknown++; else skipped++;
    }
  }

  console.log(`[週班表推播] 完成: 發送 ${sent}, 結果不明 ${unknown}, 跳過 ${skipped}, 無LINE ${noLineId}`);
  return { sent, unknown, skipped, noLineId };
}

// ── 每週遲到報告（週一 09:00 推上週異常）────────────────────────────────────
export async function sendWeeklyLateReport(): Promise<{ sent: number; unknown: number; skipped: number; noLineId: number }> {
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

  const weekShifts = await shiftService.getAllShiftsByDateRange(weekStartStr, weekEndStr);
  const workShifts = weekShifts.filter(isReviewableWorkShift);

  const clockRecs = await clockService.getClockRecordsByDateRange(weekStartStr, weekEndStr);

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

  let sent = 0, unknown = 0, skipped = 0, noLineId = 0;

  for (const [empId, empShifts] of shiftsByEmployee) {
    // Weeks pushed before push_dedup existed were recorded here; nothing writes to it any more.
    if (await systemService.hasWeeklyPushNotification(weekStartStr, empId, "late_report")) { skipped++; continue; }

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

    const emp = await employeeService.getEmployee(empId);
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
    const lineId = emp.lineId;
    const { outcome } = await pushOnce({ scope: "weekly-late", period: weekStartStr, employeeId: empId }, (retryKey) => pushToLineResult(lineId, message, retryKey));
    if (outcome === "sent") {
      sent++;
    } else {
      if (outcome !== "skipped") console.error(`[週遲到報告] 發送失敗或結果不明 empId=${empId} (${outcome})`);
      if (outcome === "unknown") unknown++; else skipped++;
    }
  }

  console.log(`[週遲到報告] 完成: 發送 ${sent}, 結果不明 ${unknown}, 跳過 ${skipped}, 無LINE ${noLineId}`);
  return { sent, unknown, skipped, noLineId };
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
): Promise<{ sent: number; unknown: number; skipped: number; noLineId: number; windowClosed: boolean }> {
  const taipeiNow = getTaiwanNow();
  const todayStr = formatTaiwanDate(taipeiNow);

  const cfg = await systemService.findSystemConfig("availability_window");
  if (!cfg?.value) {
    console.log("[意願提醒] 尚未設定意願填寫視窗，略過");
    return { sent: 0, unknown: 0, skipped: 0, noLineId: 0, windowClosed: true };
  }

  let raw: AvailWindowConfig;
  try { raw = JSON.parse(cfg.value) as AvailWindowConfig; } catch {
    console.log("[意願提醒] 意願填寫設定格式錯誤，略過");
    return { sent: 0, unknown: 0, skipped: 0, noLineId: 0, windowClosed: true };
  }

  if (!/^\d{4}-\d{2}$/.test(raw.targetYearMonth)) {
    console.log("[意願提醒] targetYearMonth 格式錯誤，略過");
    return { sent: 0, unknown: 0, skipped: 0, noLineId: 0, windowClosed: true };
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
    return { sent: 0, unknown: 0, skipped: 0, noLineId: 0, windowClosed: true };
  }

  const { targetYearMonth } = raw;
  console.log(`[意願提醒] 視窗 ${activeWindow.openFrom}~${activeWindow.openUntil}，目標月份 ${targetYearMonth}，開始檢查未填員工`);

  const [allEmployees, submittedEntries] = await Promise.all([
    employeeService.getAllEmployees(),
    availabilityService.getByYearMonth(targetYearMonth),
  ]);

  const submittedEmployeeIds = new Set(submittedEntries.map(e => e.employeeId));

  const activeEmployees = allEmployees.filter(e => e.status === "active");
  const unsubmitted = activeEmployees.filter(e => !submittedEmployeeIds.has(e.id));

  console.log(`[意願提醒] 活躍員工 ${activeEmployees.length} 人，已填 ${submittedEmployeeIds.size} 人，未填 ${unsubmitted.length} 人`);

  if (unsubmitted.length === 0) {
    return { sent: 0, unknown: 0, skipped: 0, noLineId: 0, windowClosed: false };
  }

  const [y, mStr] = targetYearMonth.split("-");
  const monthLabel = `${y} 年 ${parseInt(mStr, 10)} 月`;
  const deadlineLabel = `${activeWindow.openUntil.slice(5, 7)}/${activeWindow.openUntil.slice(8, 10)}`;
  const sysLink = getSystemLink();

  let sent = 0, unknown = 0, skipped = 0, noLineId = 0;

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
    const lineId = emp.lineId;
    const { outcome } = await pushOnce({ scope: "availability-reminder", period: todayStr, employeeId: emp.id, refId: targetYearMonth }, (retryKey) => pushToLineResult(lineId, message, retryKey));
    if (outcome === "sent") {
      sent++;
    } else {
      if (outcome !== "skipped") console.error(`[意願提醒] LINE 推播失敗或結果不明 empId=${emp.id} (${outcome})`);
      if (outcome === "unknown") unknown++; else skipped++;
    }
  }

  console.log(`[意願提醒] 完成: 發送 ${sent}, 結果不明 ${unknown}, 跳過 ${skipped}, 無LINE ${noLineId}`);
  return { sent, unknown, skipped, noLineId, windowClosed: false };
}
