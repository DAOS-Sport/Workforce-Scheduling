/**
 * server/infra/line/lineClient.ts
 *
 * Thin LINE Messaging API client.
 * All LINE push calls (pushToLine) ultimately pass through here so the
 * bearer token and endpoint URL are defined in one place.
 *
 * New code should import pushLine() from this file.
 * The existing pushToLine() in linePush.service.ts continues to work and
 * calls the LINE API directly for backward-compatibility — this file does
 * not replace it, it provides the canonical infra-layer entry point for
 * future callers.
 */

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

function getToken(): string {
  return process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
}

/**
 * Push one or more messages to a single LINE user.
 * Returns true on success, false on any error.
 */
export async function pushLine(
  userId: string,
  messages: object[],
): Promise<boolean> {
  const token = getToken();
  if (!token) {
    console.warn("[lineClient] LINE_CHANNEL_ACCESS_TOKEN not set — push skipped");
    return false;
  }
  try {
    const resp = await fetch(LINE_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ to: userId, messages }),
    });
    if (!resp.ok) {
      console.error("[lineClient] Push failed:", resp.status, await resp.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("[lineClient] Push error:", err);
    return false;
  }
}

/**
 * Convenience: push a single text message.
 */
export async function pushLineText(userId: string, text: string): Promise<boolean> {
  return pushLine(userId, [{ type: "text", text }]);
}
