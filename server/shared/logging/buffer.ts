export type LogLevel = "info" | "warn" | "error";
export interface LogEntry {
  occurredAt: Date;
  level: LogLevel;
  pipeline: string;
  requestId: string | null;
  message: string;
}

/** Only known formats can be masked reliably. Never pass request bodies here. */
export function redactLogMessage(message: string): string {
  return message
    .replace(/\bU[a-f\d]{32}\b/gi, "[LINE_ID]")
    .replace(/\b[A-Z\d._%+-]+@[A-Z\d.-]+\.[A-Z]{2,}\b/gi, "[EMAIL]")
    .replace(/\bBearer\s+[^\s,;"']+/gi, "Bearer [REDACTED]")
    .replace(/(["']?(?:[\w-]*token|api[_-]?key|authorization|password|secret)["']?\s*[:=]\s*)(["'])(.*?)\2/gis, "$1[REDACTED]")
    .replace(/(["']?(?:[\w-]*token|api[_-]?key|authorization|password|secret)["']?\s*[:=]\s*["']?)[^\s,;"'}]+/gi, "$1[REDACTED]")
    .replace(/(?:\+?886[- .]?)?0?9\d{2}[- .]?\d{3}[- .]?\d{3}\b/g, "[PHONE]")
    .replace(/\b0\d{1,3}[- .]\d{3,4}[- .]?\d{4}\b/g, "[PHONE]")
    .replace(/\b0[2-8]\d{7,8}\b/g, "[PHONE]");
}

export function createLogBuffer(options: {
  write: (batch: LogEntry[]) => Promise<unknown>;
  capacity?: number;
  onWriteFailure?: () => void;
}) {
  const capacity = options.capacity ?? 1000;
  const queue: LogEntry[] = [];
  let inFlight = 0;
  let diagnosing = false;
  return {
    add(entry: Pick<LogEntry, "level" | "pipeline" | "message"> & Partial<Pick<LogEntry, "occurredAt" | "requestId">>): void {
      if (diagnosing || inFlight >= capacity) return;
      while (queue.length + inFlight >= capacity) queue.shift();
      queue.push({
        occurredAt: entry.occurredAt ?? new Date(), level: entry.level,
        pipeline: redactLogMessage(entry.pipeline).slice(0, 120),
        requestId: entry.requestId ? redactLogMessage(entry.requestId).slice(0, 100) : null,
        message: redactLogMessage(entry.message).slice(0, 2000),
      });
    },
    size: () => queue.length + inFlight,
    async flush(): Promise<void> {
      if (inFlight || !queue.length) return;
      const batch = queue.splice(0, Math.min(100, queue.length));
      inFlight = batch.length;
      try {
        await options.write(batch);
      } catch {
        diagnosing = true;
        try { options.onWriteFailure?.(); } catch { /* Diagnostics must not affect requests either. */ }
        finally { diagnosing = false; }
      } finally { inFlight = 0; }
    },
  };
}
