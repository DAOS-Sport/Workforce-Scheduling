export type Platform = "ios" | "android" | "other";

export function detectPlatform(ua: string): Platform {
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

export function isInLine(ua: string): boolean {
  return /Line\//i.test(ua);
}

export function portalUrl(origin: string): string {
  return `${origin}/portal`;
}

/** LINE 內建瀏覽器遇到 openExternalBrowser=1 會改用手機預設瀏覽器開啟。 */
export function externalPortalUrl(origin: string): string {
  return `${origin}/portal?openExternalBrowser=1`;
}
