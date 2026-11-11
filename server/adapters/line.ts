/**
 * LINE 的唯一對外出口：Messaging API（推播、回覆）與 LINE Login（換 token、取個人資料）。
 *
 * 行為刻意維持搬家前的樣子：沒有 channel token 時照樣送出請求、由 LINE 回錯；
 * log 文字也沿用原本的寫法。要加逾時、重試或呼叫紀錄，改這一個檔就好。
 */

import { recordIntegration } from "../shared/health/healthState";

const API_BASE = "https://api.line.me";

function botHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN || ""}`,
  };
}

export type PushDeliveryOutcome = "accepted" | "rejected" | "unknown";

/** accepted 表示 LINE 接受請求，包含以相同 retry key 查到先前已接受的請求。 */
export async function pushMessagesResult(to: string, messages: object[], retryKey?: string): Promise<PushDeliveryOutcome> {
  try {
    const resp = await fetch(`${API_BASE}/v2/bot/message/push`, {
      method: "POST",
      headers: { ...botHeaders(), ...(retryKey ? { "X-Line-Retry-Key": retryKey } : {}) },
      body: JSON.stringify({ to, messages }),
      signal: AbortSignal.timeout(10_000),
    });
    if (resp.ok || (retryKey && resp.status === 409)) {
      recordIntegration("line", true);
      return "accepted";
    }
    console.error("[LINE] Push failed:", resp.status);
    recordIntegration("line", false, `推播 HTTP ${resp.status}`);
    return resp.status >= 400 && resp.status < 500 ? "rejected" : "unknown";
  } catch (err) {
    console.error("[LINE] Push failed:", err);
    recordIntegration("line", false, err);
    return "unknown";
  }
}

/** 既有呼叫端保留 boolean 契約。 */
export async function pushMessages(to: string, messages: object[]): Promise<boolean> {
  return (await pushMessagesResult(to, messages)) === "accepted";
}

/** ok＝LINE 接受；rejected＝LINE 回非 2xx（通常是 reply token 過期）；error＝連線錯誤。 */
export type ReplyOutcome = "ok" | "rejected" | "error";

export async function replyMessages(replyToken: string, messages: object[]): Promise<ReplyOutcome> {
  try {
    const resp = await fetch(`${API_BASE}/v2/bot/message/reply`, {
      method: "POST",
      headers: botHeaders(),
      body: JSON.stringify({ replyToken, messages }),
    });
    // 回覆被拒通常只是 reply token 過期（之後會改用推播），不算外部系統故障。
    if (resp.ok) recordIntegration("line", true);
    return resp.ok ? "ok" : "rejected";
  } catch (err) {
    console.error("[LINE] Reply failed, trying push:", err);
    recordIntegration("line", false, err);
    return "error";
  }
}

/** LINE Login：用授權碼換 access token。回傳原始回應，由呼叫端判斷成功與否。 */
export function exchangeLoginCode(params: {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}): Promise<Response> {
  return fetch(`${API_BASE}/oauth2/v2.1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: params.clientId,
      client_secret: params.clientSecret,
    }),
  });
}

/** LINE Login：用 access token 取使用者個人資料。回傳原始回應。 */
export function fetchLoginProfile(accessToken: string): Promise<Response> {
  return fetch(`${API_BASE}/v2/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}
