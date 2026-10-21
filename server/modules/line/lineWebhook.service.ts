import { storage } from "../../storage";
import { replyMessages } from "../../adapters/line";
import { isValidLineUserId } from "./lineSignature";
import { pushToLine, pushPendingGuidelinesIfAny } from "./linePush.service";
import { processClockIn, formatClockInMessage } from "./lineClock.service";

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
