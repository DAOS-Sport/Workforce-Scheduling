/**
 * LINE 的唯一對外出口：Messaging API（推播、回覆）與 LINE Login（換 token、取個人資料）。
 *
 * 行為刻意維持搬家前的樣子：沒有 channel token 時照樣送出請求、由 LINE 回錯；
 * log 文字也沿用原本的寫法。要加逾時、重試或呼叫紀錄，改這一個檔就好。
 */

const API_BASE = "https://api.line.me";

function botHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN || ""}`,
  };
}

/** 推播給一位使用者。成功回 true；HTTP 失敗或連線錯誤回 false。 */
export async function pushMessages(to: string, messages: object[]): Promise<boolean> {
  try {
    const resp = await fetch(`${API_BASE}/v2/bot/message/push`, {
      method: "POST",
      headers: botHeaders(),
      body: JSON.stringify({ to, messages }),
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

/** ok＝LINE 接受；rejected＝LINE 回非 2xx（通常是 reply token 過期）；error＝連線錯誤。 */
export type ReplyOutcome = "ok" | "rejected" | "error";

export async function replyMessages(replyToken: string, messages: object[]): Promise<ReplyOutcome> {
  try {
    const resp = await fetch(`${API_BASE}/v2/bot/message/reply`, {
      method: "POST",
      headers: botHeaders(),
      body: JSON.stringify({ replyToken, messages }),
    });
    return resp.ok ? "ok" : "rejected";
  } catch (err) {
    console.error("[LINE] Reply failed, trying push:", err);
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
