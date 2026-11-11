import { currentRequestId } from "../http/requestId";
import { currentPipeline } from "./context";
import { createLogBuffer, type LogEntry, type LogLevel } from "./buffer";

let sink: ((batch: LogEntry[]) => Promise<unknown>) | undefined;
const buffer = createLogBuffer({
  write: async (batch) => { if (sink) await sink(batch); },
  onWriteFailure: () => console.error("[app-logs] batch write failed; records dropped"),
});

/** The bootstrap owns the timer/sink; importing a logger never opens a DB connection. */
export function configureLogSink(write: (batch: LogEntry[]) => Promise<unknown>): () => void {
  sink = write;
  const timer = setInterval(() => void buffer.flush(), 1000);
  timer.unref();
  return () => { clearInterval(timer); sink = undefined; };
}

export function recordLog(level: LogLevel, message: string, pipeline = currentPipeline() ?? "server.errors"): void {
  if (!sink || message.startsWith("[app-logs]")) return;
  buffer.add({ level, pipeline, requestId: currentRequestId() ?? null, message });
}

/** Objects are deliberately omitted: a console argument may be a request/body. */
export function collectConsole(level: "warn" | "error", args: unknown[]): void {
  const message = args.map((arg) => arg instanceof Error ? arg.message :
    typeof arg === "string" || typeof arg === "number" || typeof arg === "boolean" ? String(arg) : "[object omitted]").join(" ");
  recordLog(level, message);
}

export const flushLogs = () => buffer.flush();
