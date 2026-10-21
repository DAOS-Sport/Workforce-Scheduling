/**
 * Single shared logger. Lives outside bootstrap so any module can import
 * it without pulling in app/session/scheduler wiring.
 */
export function log(message: string, source = "express") {
  console.log(`${new Date().toISOString()} [${source}] ${message}`);
}

/** 日誌裡的 LINE ID 只留頭尾，查錯時對得上、又不會把整個 ID 寫進日誌（GitHub #5）。 */
export function maskId(id: string | null | undefined): string {
  if (!id) return "none";
  return id.length <= 8 ? "***" : `${id.slice(0, 3)}…${id.slice(-4)}`;
}
