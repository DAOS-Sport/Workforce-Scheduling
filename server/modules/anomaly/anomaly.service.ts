/**
 * Anomaly-report service.
 *
 * Owns:
 *  - The full report-text formatter used by the LIFF "send anomaly" button.
 *  - Recipient fan-out (email) on create / resolve / batch-resolve.
 *  - Batch and single resolution updates with shared notification logic.
 *
 * Storage and email-fanout side effects always run AFTER the canonical
 * persistence write so a failed email never loses the report.
 */
import { sendAnomalyEmail } from "../../shared/email/sendAnomalyEmail";
import { notificationService } from "../notification/notification.service";
import { anomalyRepository } from "./anomaly.repository";
import { httpError } from "../../shared/errors";

export interface AnomalyReportInput {
  employee?: { id?: number; name?: string; employeeCode?: string; role?: string; lineUserId?: string };
  clockResult?: {
    status?: string;
    clockType?: string;
    time?: string;
    date?: string;
    venueName?: string;
    distance?: number | null;
    radius?: number | null;
    failReason?: string;
  };
  errorMsg?: string;
  context: string;
  userNote?: string;
  imageUrls: string[];
}

function formatReportText(input: AnomalyReportInput): string {
  const { employee, clockResult, errorMsg, context, userNote, imageUrls } = input;
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const timestamp = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const lines: string[] = [
    "!!!打卡異常報告!!!",
    `報告時間：${timestamp}`,
    `異常類型：${context}`,
    "──────────────",
  ];

  if (employee) {
    if (employee.name) lines.push(`員工姓名：${employee.name}`);
    if (employee.employeeCode) lines.push(`員工編號：${employee.employeeCode}`);
    if (employee.role) lines.push(`職務角色：${employee.role}`);
    if (employee.lineUserId) lines.push(`LINE User ID：${employee.lineUserId}`);
  } else {
    lines.push("員工資訊：尚未登入 / 無法取得");
  }
  lines.push("──────────────");

  if (clockResult) {
    lines.push(`打卡狀態：${clockResult.status === "success" ? "成功" : clockResult.status === "warning" ? "警告（無排班）" : "失敗"}`);
    if (clockResult.clockType) lines.push(`打卡類型：${clockResult.clockType === "in" ? "上班" : "下班"}`);
    if (clockResult.time) lines.push(`打卡時間：${clockResult.date || ""} ${clockResult.time}`);
    if (clockResult.venueName) lines.push(`場館名稱：${clockResult.venueName}`);
    if (clockResult.distance !== null && clockResult.distance !== undefined) {
      lines.push(`距離場館：${clockResult.distance}m${clockResult.radius ? ` (需在${clockResult.radius}m內)` : ""}`);
    }
    if (clockResult.failReason) lines.push(`異常原因：${clockResult.failReason}`);
  }

  if (errorMsg) lines.push(`錯誤訊息：${errorMsg}`);
  if (userNote) lines.push(`使用者備註：${userNote}`);
  if (imageUrls.length > 0) lines.push(`附件圖片：${imageUrls.length} 張`);

  lines.push("──────────────");
  lines.push("※ 此為系統自動產生之異常報告，請勿修改內容，將此文字訊息以及異常畫面圖片傳送至400感謝配合。");

  return lines.join("\n");
}

async function notifyRecipients(filterFn: (r: any) => boolean, subject: string, html: string) {
  try {
    const recipients = await notificationService.findAll();
    const targets = recipients.filter(filterFn);
    if (targets.length === 0) return;
    await sendAnomalyEmail(targets.map((r) => r.email), subject, html);
  } catch (emailErr) {
    console.error("[EMAIL] notification failed:", emailErr);
  }
}

export const anomalyService = {
  async create(input: AnomalyReportInput) {
    if (!input.context) {
      throw httpError(400, "缺少異常類型 (context)");
    }
    const reportText = formatReportText(input);

    const record = await anomalyRepository.createAnomalyReport({
      employeeId: input.employee?.id || null,
      employeeName: input.employee?.name || null,
      employeeCode: input.employee?.employeeCode || null,
      role: input.employee?.role || null,
      lineUserId: input.employee?.lineUserId || null,
      context: input.context,
      clockStatus: input.clockResult?.status || null,
      clockType: input.clockResult?.clockType || null,
      clockTime: input.clockResult?.time
        ? `${input.clockResult.date || ""} ${input.clockResult.time}`
        : null,
      venueName: input.clockResult?.venueName || null,
      distance:
        input.clockResult?.distance !== null && input.clockResult?.distance !== undefined
          ? `${input.clockResult.distance}m`
          : null,
      failReason: input.clockResult?.failReason || null,
      errorMsg: input.errorMsg || null,
      userNote: input.userNote || null,
      imageUrls: input.imageUrls.length > 0 ? input.imageUrls : null,
      reportText,
    });

    await notifyRecipients(
      (r) => r.enabled && r.notifyNewReport,
      `🚨 員工打卡異常 — ${input.employee?.name || "未知"}（${input.clockResult?.venueName || "未知場館"}）`,
      `<h2>員工打卡異常</h2>
        <p><b>姓名：</b>${input.employee?.name || "未知"}</p>
        <p><b>員工編號：</b>${input.employee?.employeeCode || "未知"}</p>
        <p><b>職位：</b>${input.employee?.role || "未知"}</p>
        <p><b>場館：</b>${input.clockResult?.venueName || "未知"}</p>
        <p><b>時間：</b>${input.clockResult?.time ? `${input.clockResult.date || ""} ${input.clockResult.time}` : "未知"}</p>
        <p><b>原因：</b>${input.clockResult?.failReason || input.errorMsg || "未知"}</p>
        ${input.userNote ? `<p><b>員工備註：</b>${input.userNote}</p>` : ""}
        ${input.imageUrls.length > 0 ? `<p><b>附件圖片：</b>${input.imageUrls.length} 張</p>` : ""}`,
    );

    return { record, reportText };
  },

  list: () => anomalyRepository.getAnomalyReports(),
  get: (id: number) => anomalyRepository.getAnomalyReport(id),

  async batchUpdateResolution(ids: number[], resolution: string, resolvedNote?: string) {
    if (!ids || !Array.isArray(ids) || !resolution) {
      throw httpError(400, "缺少 ids 或 resolution");
    }
    const results: any[] = [];
    for (const id of ids) {
      const record = await anomalyRepository.updateAnomalyResolution(Number(id), resolution, resolvedNote);
      if (record) results.push(record);
    }
    if (results.length > 0) {
      const names = results.map((r) => r.employeeName || "未知").join("、");
      await notifyRecipients(
        (r) => r.enabled && r.notifyResolution,
        `批量處理更新 — ${results.length} 筆異常報告`,
        `<h2>批量處理更新</h2>
          <p><b>數量：</b>${results.length} 筆</p>
          <p><b>員工：</b>${names}</p>
          <p><b>狀態：</b>${resolution === "resolved" ? "已處理" : "待解決"}</p>
          <p><b>備註：</b>${resolvedNote || "無"}</p>`,
      );
    }
    return { updated: results.length, results };
  },

  async updateResolution(id: number, resolution: string | undefined, resolvedNote?: string) {
    if (!resolution) {
      throw httpError(400, "缺少 resolution");
    }
    const record = await anomalyRepository.updateAnomalyResolution(id, resolution, resolvedNote);
    if (!record) return null;
    await notifyRecipients(
      (r) => r.enabled && r.notifyResolution,
      `打卡異常處理更新 — ${record.employeeName || "未知"}（${record.venueName || "未知場館"}）`,
      `<h2>打卡異常處理更新</h2>
        <p><b>姓名：</b>${record.employeeName || "未知"}</p>
        <p><b>場館：</b>${record.venueName || "未知"}</p>
        <p><b>狀態：</b>${resolution === "resolved" ? "已處理" : "待解決"}</p>
        <p><b>備註：</b>${resolvedNote || "無"}</p>
        <p><b>原始異常時間：</b>${record.clockTime || "未知"}</p>`,
    );
    return record;
  },

  async batchDelete(ids: number[]) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw httpError(400, "缺少 ids");
    }
    let deleted = 0;
    for (const id of ids) {
      await anomalyRepository.deleteAnomalyReport(Number(id));
      deleted++;
    }
    return { success: true, deleted };
  },

  remove: (id: number) => anomalyRepository.deleteAnomalyReport(id),
  countPendingReports: anomalyRepository.countPendingReports,
};
