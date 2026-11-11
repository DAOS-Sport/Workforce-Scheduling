import { currentRequestId } from "./http/requestId";
import { collectConsole, recordLog } from "./logging/collector";

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** ISO 8601 with the Taipei offset (+08:00), so a line reads the same whatever zone the server runs in. */
export function formatTimestamp(date: Date): string {
  return new Date(date.getTime() + TAIPEI_OFFSET_MS).toISOString().replace("Z", "+08:00");
}

/**
 * Single shared logger. Lives outside bootstrap so any module can import
 * it without pulling in app/session/scheduler wiring.
 * Every line is `<time with offset> [source] [request id or -] message`.
 */
export function log(message: string, source = "express") {
  if (source === "error") recordLog("error", message);
  else if (source !== "catch-up" && /失敗|^(?:同步)?錯誤[:：]/.test(message)) recordLog("error", message);
  else if (source === "warn") recordLog("warn", message);
  console.log(`${formatTimestamp(new Date())} [${source}] [${currentRequestId() ?? "-"}] ${message}`);
}

const STAMPED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2} /;
const PATCHED = ["log", "info", "warn", "error"] as const;

/**
 * Most of the code base writes with console.* directly. Called once at process start, this puts the same
 * `<time> [console] [request id or -]` prefix in front of those lines, so a request can be followed
 * through all of them. Lines that already start with a timestamp (log()) pass through unchanged.
 * Returns a function that restores the original console.
 */
export function installLogStamp(): () => void {
  const originals = PATCHED.map((level) => console[level]);
  PATCHED.forEach((level, i) => {
    const original = originals[i];
    console[level] = (...args: unknown[]) => {
      if (level === "warn" || level === "error") collectConsole(level, args);
      if (typeof args[0] === "string" && STAMPED.test(args[0])) return original.apply(console, args);
      return original.call(console, `${formatTimestamp(new Date())} [console] [${currentRequestId() ?? "-"}]`, ...args);
    };
  });
  return () => PATCHED.forEach((level, i) => void (console[level] = originals[i]));
}

/** 日誌裡的 LINE ID 只留頭尾，查錯時對得上、又不會把整個 ID 寫進日誌（GitHub #5）。 */
export function maskId(id: string | null | undefined): string {
  if (!id) return "none";
  return id.length <= 8 ? "***" : `${id.slice(0, 3)}…${id.slice(-4)}`;
}
