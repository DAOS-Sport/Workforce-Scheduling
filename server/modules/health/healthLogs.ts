import type { HealthLogEntry } from "../../core/health/types";
import { readHealthLogRows, readRecentPipelineLogs } from "./healthLogs.repository";

export interface HealthLogOptions {
  pipeline?: string;
  since?: string;
  /** Minimum severity: warn includes error. */
  level?: "info" | "warn" | "error";
  limit?: number;
  cursor?: string;
}

export interface HealthLogPage {
  logs: HealthLogEntry[];
  nextCursor: string | null;
}

export class InvalidHealthLogQuery extends Error {}

/** UTC only; retain up to PostgreSQL's six fractional digits for keyset pagination. */
function validTimestamp(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/.exec(value);
  if (!match || match[1].startsWith("0000-")) return false;
  const milliseconds = `${match[1]}.${(match[2] ?? "").padEnd(3, "0").slice(0, 3)}Z`;
  const parsed = new Date(milliseconds);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === milliseconds;
}

function decodeCursor(value: string): { at: string; id: number } {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 256) throw new Error();
    const encoded = Buffer.from(value, "base64url");
    if (encoded.toString("base64url") !== value) throw new Error();
    const cursor = JSON.parse(encoded.toString("utf8"));
    if (!cursor || Object.keys(cursor).sort().join(",") !== "at,id" || typeof cursor.at !== "string" || !validTimestamp(cursor.at) || !Number.isInteger(cursor.id) || cursor.id <= 0 || cursor.id > 2_147_483_647) throw new Error();
    return cursor;
  } catch {
    throw new InvalidHealthLogQuery("cursor 格式不正確");
  }
}

export function parseHealthLogsOptions(query: Record<string, unknown>): HealthLogOptions & { level: NonNullable<HealthLogOptions["level"]>; limit: number } {
  const options: ReturnType<typeof parseHealthLogsOptions> = { level: "info", limit: 50 };
  for (const key of ["pipeline", "since", "level", "limit", "cursor"] as const) {
    const value = query[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || !value) throw new InvalidHealthLogQuery(`${key} 格式不正確`);
    if (key === "limit") {
      if (!/^[1-9]\d*$/.test(value) || Number(value) > 100) throw new InvalidHealthLogQuery("limit 必須為 1 到 100 的整數");
      options.limit = Number(value);
    } else if (key === "level") {
      if (value !== "info" && value !== "warn" && value !== "error") throw new InvalidHealthLogQuery("level 必須為 info、warn 或 error");
      options.level = value;
    } else if (key === "since") {
      if (!validTimestamp(value)) throw new InvalidHealthLogQuery("since 必須為有效的 UTC ISO 時間");
      options.since = value;
    } else if (key === "cursor") {
      decodeCursor(value);
      options.cursor = value;
    } else {
      if (!value.trim() || value.length > 200) throw new InvalidHealthLogQuery("pipeline 格式不正確");
      options.pipeline = value;
    }
  }
  return options;
}

export async function queryHealthLogs(options: HealthLogOptions = {}): Promise<HealthLogPage> {
  const limit = options.limit ?? 50;
  const rows = await readHealthLogRows({ ...options, limit: limit + 1, before: options.cursor ? decodeCursor(options.cursor) : undefined });
  const logs = rows.slice(0, limit);
  const last = logs.at(-1);
  return {
    logs,
    nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ at: last.at, id: last.id })).toString("base64url") : null,
  };
}

export async function attachPipelineLogs<T extends { pipelines: Array<{ id: string }> }>(report: T, now: Date): Promise<
  Omit<T, "pipelines"> & { pipelines: Array<T["pipelines"][number] & { logs: HealthLogEntry[]; logsError?: string }> }
> {
  let rows: HealthLogEntry[] = [];
  let logsError: string | undefined;
  if (report.pipelines.length) {
    try {
      const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      rows = await readRecentPipelineLogs(report.pipelines.map((pipeline) => pipeline.id), since, now.toISOString());
    } catch {
      logsError = "無法讀取日誌";
    }
  }
  return {
    ...report,
    pipelines: report.pipelines.map((pipeline: T["pipelines"][number]) => ({
      ...pipeline,
      logs: rows.filter((entry) => entry.pipeline === pipeline.id),
      ...(logsError ? { logsError } : {}),
    })),
  };
}
