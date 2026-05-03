import crypto from "crypto";

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || "";

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
