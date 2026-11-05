import { replyMessages } from "../../adapters/line";
import { pushToLine, pushPendingGuidelinesIfAny } from "./linePush.service";
import { processClockIn } from "../clock/clockIn.service";
import { formatClockInMessage } from "../clock/clockInMessage";
import { maskId } from "../../shared/log";
import { employeeService } from "../employee/employee.service";
import { lineWebhookEventRepository } from "./lineWebhookEvent.repository";

/** 先用 reply token 回覆；LINE 拒絕或連線失敗時，有 fallbackUserId 就改用推播。 */
async function replyToLine(replyToken: string, text: string, fallbackUserId?: string, extraMessages?: object[]): Promise<void> {
  const messages: object[] = [{ type: "text", text }];
  if (extraMessages) messages.push(...extraMessages);
  const outcome = await replyMessages(replyToken, messages);
  if (outcome === "ok" || !fallbackUserId) return;
  if (outcome === "rejected") console.log("[LINE] Reply token expired, using push message instead");
  await pushToLine(fallbackUserId, text, extraMessages);
}

async function handleFollowEvent(event: any): Promise<void> {
  const lineUserId = event.source?.userId;
  const replyToken = event.replyToken;
  if (!lineUserId) return;

  const existingEmp = await employeeService.getEmployeeByLineId(lineUserId);
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

  const replyAlreadyBound = (bound: { name: string; employeeCode: string }) =>
    replyToLine(replyToken,
      `ℹ️ 您的帳號已綁定為：${bound.name}（${bound.employeeCode}）\n\n` +
      `如需打卡，請傳送「位置訊息」。`,
      lineUserId
    );

  const looksLikeCode = /^\d{4,10}$/.test(text);
  // An account whose records are all inactive may bind a new code; bindLineAccount decides that under its lock.
  const alreadyBound = await employeeService.getEmployeeByLineId(lineUserId);
  if (alreadyBound && (alreadyBound.status === "active" || !looksLikeCode)) {
    await replyAlreadyBound(alreadyBound);
    return;
  }

  if (!looksLikeCode) {
    await replyToLine(replyToken,
      `📌 請輸入您的「員工編號」（純數字）來完成帳號綁定。\n` +
      `例如：1305374\n\n` +
      `如不確定員工編號，請洽詢您的主管或 HR。`,
      lineUserId
    );
    return;
  }

  // The checks and the write happen together under the binding lock; the replies below come after it commits.
  const outcome = await employeeService.bindLineAccount(lineUserId, text);

  if (outcome.kind === "already_bound") {
    await replyAlreadyBound(outcome.employee);
    return;
  }

  if (outcome.kind === "not_found") {
    await replyToLine(replyToken,
      `❌ 查無員工編號「${text}」，請確認後重新輸入。\n\n如有疑問請洽詢主管或 HR。`,
      lineUserId
    );
    return;
  }

  if (outcome.kind === "taken") {
    await replyToLine(replyToken,
      `⚠️ 員工編號「${text}」（${outcome.employee.name}）已綁定其他 LINE 帳號。\n\n如需更換綁定，請聯繫 HR 處理。`,
      lineUserId
    );
    return;
  }

  if (outcome.kind === "inactive") {
    await replyToLine(replyToken,
      `⚠️ 員工編號「${text}」目前為非在職狀態，無法綁定。\n\n如有疑問請洽詢 HR。`,
      lineUserId
    );
    return;
  }

  const { employee } = outcome;
  console.log(`[LINE Bind] 員工 ID=${employee.id} 綁定 LINE ID: ${maskId(lineUserId)}`);

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

/** Reply to and act on one event. Replies and pushes happen here, after any database work has committed. */
async function handleEvent(event: any): Promise<void> {
  if (event.type === "follow") {
    await handleFollowEvent(event);
    return;
  }

  if (event.type === "message" && event.message.type === "text") {
    await handleTextMessage(event);
    return;
  }

  if (event.type === "message" && event.message.type === "location") {
    const replyToken = event.replyToken;
    const lineUserId = event.source?.userId;
    const userLat = event.message.latitude;
    const userLng = event.message.longitude;

    if (!lineUserId) {
      await replyToLine(replyToken, "❌ 無法識別您的 LINE 帳號，請聯繫管理員。");
      return;
    }

    const emp = await employeeService.getEmployeeByLineId(lineUserId);
    if (!emp) {
      await replyToLine(replyToken,
        `❌ 您的 LINE 帳號尚未綁定員工資料。\n\n` +
        `📌 請先回覆您的「員工編號」完成綁定，再傳送位置打卡。\n` +
        `（例如：1305374）`,
        lineUserId
      );
      return;
    }

    const at = Number.isFinite(event.timestamp) ? new Date(event.timestamp) : undefined;
    const { result, employeeId } = await processClockIn({ lineUserId }, userLat, userLng, { at });
    const message = formatClockInMessage(result);
    await replyToLine(replyToken, message, lineUserId);
    if ((result.status === "success" || result.status === "warning") && result.clockType === "in" && employeeId !== null) {
      pushPendingGuidelinesIfAny(employeeId, lineUserId).catch(() => {});
    }
  }
}

export async function handleLineWebhook(body: any): Promise<void> {
  const events = body.events || [];

  for (const event of events) {
    const eventId: string | undefined = event.webhookEventId;
    try {
      // LINE redelivers an event it thinks was lost, possibly minutes later. Handle each event id once.
      if (eventId) {
        if (!(await lineWebhookEventRepository.claim(eventId))) {
          console.log(`[LINE Webhook] 事件 ${eventId} 已處理過，略過重送`);
          continue;
        }
      } else {
        console.log("[LINE Webhook] 事件沒有 webhookEventId，無法去重");
      }
      await handleEvent(event);
      if (eventId) await lineWebhookEventRepository.finish(eventId, {});
    } catch (err) {
      console.error("[LINE Webhook] Error processing event:", err);
      if (eventId) await lineWebhookEventRepository.finish(eventId, { error: String(err) }).catch(() => {});
      const lineUserId = event.source?.userId;
      if (lineUserId) {
        await pushToLine(lineUserId, "❌ 系統處理時發生錯誤，請稍後再試或聯繫管理員。");
      }
    }
  }
}
