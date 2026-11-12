import { createHash } from "node:crypto";
import type { Express } from "express";
import type { AppErrorRow } from "@shared/schema";
import { SYSTEM_ID } from "../../core/health/report";
import { getHealthBuild } from "../../core/health/build";
import { pipelineForPath } from "../../core/health/flowRules";

const ROW_LIMIT = 1000;
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "CONNECT", "TRACE"]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_KIND = /^(TypeError|RangeError|ReferenceError|SyntaxError|URIError|EvalError|AggregateError|Error)(?=:|$)/;

export class InvalidHealthErrorsQuery extends Error {}

function taipeiTime(date: Date): string {
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().replace("Z", "+08:00");
}

/** Validate calendar fields before Date can normalize an impossible date. */
function parseSince(value: unknown, now: Date): { filter: Date | string; display: string } {
  if (value === undefined) {
    const date = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return { filter: date, display: taipeiTime(date) };
  }
  const match = typeof value === "string" && /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([Zz]|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new InvalidHealthErrorsQuery();
  const [, year, month, day, hour, minute, second, fraction, zone] = match;
  const local = `${year}-${month}-${day}T${hour}:${minute}:${second}.${(fraction ?? "").padEnd(3, "0").slice(0, 3)}`;
  const calendar = new Date(`${local}Z`);
  const offset = zone.toUpperCase();
  const date = new Date(`${local}${offset}`);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(calendar.getTime()) || calendar.toISOString() !== `${local}Z` ||
      (offset !== "Z" && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4)) > 59))) {
    throw new InvalidHealthErrorsQuery();
  }
  if (!fraction || fraction.length <= 3) return { filter: date, display: taipeiTime(date) };
  const display = taipeiTime(date).replace(/\.\d{3}(?=\+08:00$)/, `.${fraction}`);
  // PostgreSQL stores microseconds. Round a finer cutoff up, never down into older rows.
  const micros = Number(fraction.slice(0, 6).padEnd(6, "0")) + (/[^0]/.test(fraction.slice(6)) ? 1 : 0);
  const secondStart = date.getTime() - Number((fraction + "000").slice(0, 3));
  const nextSecond = micros === 1_000_000;
  const filter = new Date(secondStart + (nextSecond ? 1000 : 0)).toISOString()
    .replace(/\.\d{3}Z$/, `.${nextSecond ? "000000" : String(micros).padStart(6, "0")}Z`);
  return { filter, display };
}

type RouteLayer = { route?: { path: string | string[]; methods: Record<string, boolean> } };

/** Use server-owned route literals, never request-owned path segments. */
export function routeTemplate(app: Express | undefined, row: Pick<AppErrorRow, "method" | "path">): string {
  const method = METHODS.has(row.method.toUpperCase()) ? row.method.toUpperCase() : "HTTP";
  const path = row.path.split(/[?#]/, 1)[0];
  const parts = path.split("/").filter(Boolean).map((part) => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
  const layers = (app?.router as { stack?: RouteLayer[] } | undefined)?.stack ?? [];
  for (const { route } of layers) {
    if (!route || !(route.methods[method.toLowerCase()] || route.methods._all || (method === "HEAD" && route.methods.get))) continue;
    for (const template of Array.isArray(route.path) ? route.path : [route.path]) {
      if (typeof template !== "string") continue;
      const expected = template.split("/").filter(Boolean);
      if (expected.length !== parts.length || !expected.every((part, i) => part.startsWith(":") || part.toLowerCase() === parts[i].toLowerCase())) continue;
      return `${method} /${expected.map((part) => /^\d+$/.test(part) ? ":id" : part).join("/")}`;
    }
  }
  return `${method} /${parts.map((part, i) => i === 0 && part.toLowerCase() === "api" ? "api" : /^\d+$/.test(part) ? ":id" : ":segment").join("/")}`;
}

interface HealthError {
  system: string;
  env: "production" | "development";
  ts: string;
  level: "error" | "warn";
  code: string;
  message: string;
  request_id: string;
  route: string;
  fingerprint: string;
  count: number;
  first_seen: string;
  last_seen: string;
  release: string;
  pipeline: string | null;
}

/** Counts cover the requested window and, when truncated, the newest 1,000 rows. */
export async function queryHealthErrors(app: Express, query: Record<string, unknown>, now = new Date()) {
  const { filter: since, display } = parseSince(query.since, now);
  const { listErrors, oldestErrorOccurrence } = await import("../errors/errors.service");
  const [rows, oldest] = await Promise.all([
    listErrors({ since, limit: ROW_LIMIT + 1 }),
    oldestErrorOccurrence(),
  ]);
  const build = getHealthBuild();
  const groups = new Map<string, HealthError>();
  // Keep PostgreSQL's full-precision ordering; Date has already lost sub-millisecond ties.
  const ordered = rows.slice(0, ROW_LIMIT);
  for (const row of ordered) {
    const route = routeTemplate(app, row);
    const code = String(row.status);
    const kind = ERROR_KIND.exec(row.message)?.[1] ?? ERROR_KIND.exec(row.stack ?? "")?.[1] ?? "Error";
    const fingerprint = createHash("sha1").update(`${route}|${code}|${kind}`).digest("hex").slice(0, 12);
    const ts = taipeiTime(row.occurredAt);
    const group = groups.get(fingerprint);
    if (group) {
      group.count++;
      group.first_seen = ts;
    } else {
      groups.set(fingerprint, {
        system: SYSTEM_ID,
        env: process.env.REPLIT_DEPLOYMENT === "1" ? "production" : "development",
        ts,
        level: row.status >= 500 ? "error" : "warn",
        code,
        message: `${kind}: HTTP ${code}`,
        request_id: UUID_V4.test(row.requestId) ? row.requestId : `ext-${createHash("sha256").update(row.requestId).digest("hex").slice(0, 12)}`,
        route,
        fingerprint,
        count: 1,
        first_seen: ts,
        last_seen: ts,
        release: build,
        pipeline: pipelineForPath(row.path) ?? null,
      });
    }
  }
  return {
    system: SYSTEM_ID,
    build,
    checkedAt: taipeiTime(now),
    since: display,
    retainedSince: oldest ? taipeiTime(oldest) : display,
    truncated: rows.length > ROW_LIMIT,
    errors: [...groups.values()],
  };
}
