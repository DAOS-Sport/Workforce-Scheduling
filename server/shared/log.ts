/**
 * server/shared/log.ts
 *
 * Structured logger. In production (NODE_ENV=production) emits JSON lines
 * suitable for log aggregation. In development emits human-readable output.
 *
 * Backward-compat: the original `log(message, source)` call signature is
 * preserved as an `info`-level shortcut.
 *
 * Sensitive field redaction: password / token / api_key / cookie /
 * authorization / private_key / session values are replaced with [REDACTED].
 */

const REDACT_KEYS = new Set([
  "password", "passwd", "token", "api_key", "apikey",
  "cookie", "cookies", "authorization", "auth", "private_key",
  "privatekey", "session", "secret", "credential",
]);

export function redact(obj: unknown, depth = 0): unknown {
  if (depth > 6 || obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out[k] = REDACT_KEYS.has(k.toLowerCase().replace(/[-_]/g, "")) ? "[REDACTED]" : redact(v, depth + 1);
  }
  return out;
}

export interface LogEntry {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error" | "audit";
  service: string;
  environment: string;
  module?: string;
  action?: string;
  request_id?: string;
  route?: string;
  method?: string;
  status_code?: number;
  duration_ms?: number;
  error_code?: string;
  error_message?: string;
  external_service?: string;
  safe_context?: Record<string, unknown>;
  message: string;
}

export interface AuditFields {
  actor_user_id?: number | string;
  actor_role?: string;
  action: string;
  target_type?: string;
  target_id?: number | string;
  before_state?: unknown;
  after_state?: unknown;
}

const isDev = process.env.NODE_ENV !== "production";
const SERVICE = "pt-scheduler";
const ENV = process.env.NODE_ENV ?? "development";

function emit(entry: LogEntry) {
  if (isDev) {
    const ts = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
    const src = entry.module ?? entry.service;
    console.log(`${ts} [${entry.level.toUpperCase()}][${src}] ${entry.message}`);
  } else {
    const line = JSON.stringify(entry);
    if (entry.level === "error") {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  if (entry.level === "warn" || entry.level === "error" || entry.level === "audit") {
    persistAsync(entry);
  }
}

let _persistFn: ((entry: LogEntry) => Promise<void>) | null = null;

export function registerPersistFn(fn: (entry: LogEntry) => Promise<void>) {
  _persistFn = fn;
}

function persistAsync(entry: LogEntry) {
  if (!_persistFn) return;
  _persistFn(entry).catch(() => {});
}

function makeEntry(
  level: LogEntry["level"],
  message: string,
  fields?: Partial<Omit<LogEntry, "level" | "message" | "timestamp" | "service" | "environment">>,
): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    level,
    service: SERVICE,
    environment: ENV,
    message,
    ...fields,
    safe_context: fields?.safe_context ? (redact(fields.safe_context) as Record<string, unknown>) : undefined,
  };
}

function debug(message: string, fields?: Partial<LogEntry>) { emit(makeEntry("debug", message, fields)); }
function info(message: string, fields?: Partial<LogEntry>) { emit(makeEntry("info", message, fields)); }
function warn(message: string, fields?: Partial<LogEntry>) { emit(makeEntry("warn", message, fields)); }
function error(message: string, fields?: Partial<LogEntry>) { emit(makeEntry("error", message, fields)); }
function audit(message: string, auditFields: AuditFields, fields?: Partial<LogEntry>) {
  emit(makeEntry("audit", message, {
    ...fields,
    safe_context: { ...(fields?.safe_context ?? {}), audit: auditFields },
  }));
}

export const logger = { debug, info, warn, error, audit };

/** Backward-compatible drop-in for the original `log(message, source)` call. */
export function log(message: string, source = "express") {
  info(message, { module: source });
}
