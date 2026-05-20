/**
 * system.observability.routes.ts
 *
 * IT observability endpoints: health, status, metrics, logs, audit, user-errors.
 *
 * Auth rules:
 *   GET /api/health   — admin session OR INTERNAL_API_TOKEN (so external consumers can poll)
 *   All other /api/system/* — admin session only (behind gateAdminApi already)
 */
import type { Express, Request, Response } from "express";
import { db } from "../../infra/db";
import { pool } from "../../infra/db";
import { appLogs, auditLogs, userErrorEvents } from "@shared/schema";
import { desc, and, gte, eq, or, ilike } from "drizzle-orm";
import { metricsStore } from "../../observability/metrics-store";
import { extractToken } from "../internal/internal.auth";

// ── helpers ──────────────────────────────────────────────────────────────

function requireAdminOrInternalToken(req: Request, res: Response, next: () => void) {
  if ((req.session as any)?.adminId) return next();
  const token = extractToken(req);
  const expected = process.env.INTERNAL_API_TOKEN;
  if (expected && token === expected) return next();
  return res.status(401).json({ code: "UNAUTHORIZED", message: "Admin session or INTERNAL_API_TOKEN required" });
}

async function probeDb(): Promise<{ status: "ok" | "down"; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (e: any) {
    return { status: "down", latencyMs: Date.now() - start, error: e?.message ?? "unknown" };
  }
}

async function probeLine(): Promise<{ status: "ok" | "degraded" | "down"; latencyMs: number; error?: string }> {
  const start = Date.now();
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return { status: "degraded", latencyMs: 0, error: "LINE_CHANNEL_ACCESS_TOKEN not configured" };
  try {
    const res = await fetch("https://api.line.me/v2/bot/info", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    const latencyMs = Date.now() - start;
    return { status: res.ok ? "ok" : "degraded", latencyMs };
  } catch (e: any) {
    return { status: "down", latencyMs: Date.now() - start, error: e?.message ?? "unknown" };
  }
}

async function probeRagic(): Promise<{ status: "ok" | "degraded" | "down"; latencyMs: number; error?: string }> {
  const start = Date.now();
  const ragicKey = process.env.RAGIC_API_KEY;
  const ragicUrl = process.env.RAGIC_BASE_URL;
  if (!ragicKey || !ragicUrl) return { status: "degraded", latencyMs: 0, error: "Ragic env vars not configured" };
  try {
    const res = await fetch(ragicUrl, {
      headers: { Authorization: `Basic ${ragicKey}` },
      signal: AbortSignal.timeout(5000),
    });
    const latencyMs = Date.now() - start;
    return { status: res.ok ? "ok" : "degraded", latencyMs };
  } catch (e: any) {
    return { status: "down", latencyMs: Date.now() - start, error: e?.message ?? "unknown" };
  }
}

const PROBE_TTL = 30_000;
let lastProbeAt = 0;

async function getOrRefreshProbes() {
  const now = Date.now();
  if (now - lastProbeAt < PROBE_TTL) return metricsStore.allProbes();
  lastProbeAt = now;
  const [dbResult, lineResult, ragicResult] = await Promise.allSettled([probeDb(), probeLine(), probeRagic()]);

  const toDB = (name: string, r: PromiseSettledResult<{ status: string; latencyMs: number; error?: string }>) => ({
    name,
    status: r.status === "fulfilled" ? r.value.status as "ok" | "degraded" | "down" : "down" as const,
    latencyMs: r.status === "fulfilled" ? r.value.latencyMs : null,
    checkedAt: now,
    error: r.status === "fulfilled" ? r.value.error : (r as PromiseRejectedResult).reason?.message,
  });

  const probes = [toDB("db", dbResult), toDB("line", lineResult), toDB("ragic", ragicResult)];
  probes.forEach((p) => metricsStore.setProbe(p));
  return probes;
}

// ── routes ────────────────────────────────────────────────────────────────

export function mountSystemObservabilityRoutes(app: Express): void {

  // GET /api/health — open to admin OR INTERNAL_API_TOKEN
  app.get("/api/health", requireAdminOrInternalToken, async (_req, res) => {
    try {
      const client = await pool.connect();
      await client.query("SELECT 1");
      client.release();
      res.json({
        ok: true,
        status: "healthy",
        service: "pt-scheduler",
        environment: process.env.NODE_ENV ?? "development",
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        db: "connected",
      });
    } catch {
      res.status(503).json({ ok: false, status: "degraded", db: "unreachable", timestamp: new Date().toISOString() });
    }
  });

  // GET /api/system/status — admin only (behind gateAdminApi)
  app.get("/api/system/status", async (_req, res) => {
    try {
      const probes = await getOrRefreshProbes();
      const overall = probes.every((p) => p.status === "ok") ? "ok"
        : probes.some((p) => p.status === "down") ? "degraded" : "degraded";
      res.json({
        overall,
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        services: probes,
      });
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "probe failed" });
    }
  });

  // GET /api/system/metrics
  app.get("/api/system/metrics", (_req, res) => {
    res.json(metricsStore.computeMetrics());
  });

  // GET /api/system/metrics/internal-api
  app.get("/api/system/metrics/internal-api", (_req, res) => {
    res.json({ endpoints: metricsStore.internalApiStats() });
  });

  // GET /api/system/errors
  app.get("/api/system/errors", async (req, res) => {
    try {
      const { module: mod, request_id, error_code, since, limit } = req.query as Record<string, string>;
      const lim = Math.min(parseInt(limit ?? "100", 10) || 100, 500);
      const conditions = [or(eq(appLogs.level, "error"), eq(appLogs.level, "warn"))!];
      if (mod) conditions.push(ilike(appLogs.module, `%${mod}%`));
      if (request_id) conditions.push(eq(appLogs.requestId, request_id));
      if (error_code) conditions.push(eq(appLogs.errorCode, error_code));
      if (since) conditions.push(gte(appLogs.timestamp, new Date(since)));
      const rows = await db.select().from(appLogs)
        .where(and(...conditions))
        .orderBy(desc(appLogs.timestamp))
        .limit(lim);
      res.json({ logs: rows });
    } catch (e: any) {
      res.status(500).json({ message: e?.message });
    }
  });

  // GET /api/system/logs
  app.get("/api/system/logs", async (req, res) => {
    try {
      const { module: mod, request_id, level, since, limit } = req.query as Record<string, string>;
      const lim = Math.min(parseInt(limit ?? "100", 10) || 100, 500);
      const conditions: ReturnType<typeof eq>[] = [];
      if (mod) conditions.push(ilike(appLogs.module, `%${mod}%`) as any);
      if (request_id) conditions.push(eq(appLogs.requestId, request_id));
      if (level) conditions.push(eq(appLogs.level, level));
      if (since) conditions.push(gte(appLogs.timestamp, new Date(since)) as any);
      const rows = await db.select().from(appLogs)
        .where(conditions.length ? and(...(conditions as any)) : undefined)
        .orderBy(desc(appLogs.timestamp))
        .limit(lim);
      res.json({ logs: rows });
    } catch (e: any) {
      res.status(500).json({ message: e?.message });
    }
  });

  // GET /api/system/audit-logs
  app.get("/api/system/audit-logs", async (req, res) => {
    try {
      const { actor, action, target_type, since, limit } = req.query as Record<string, string>;
      const lim = Math.min(parseInt(limit ?? "100", 10) || 100, 500);
      const conditions: any[] = [];
      if (actor) conditions.push(ilike(auditLogs.actorUserId, `%${actor}%`));
      if (action) conditions.push(ilike(auditLogs.action, `%${action}%`));
      if (target_type) conditions.push(eq(auditLogs.targetType, target_type));
      if (since) conditions.push(gte(auditLogs.timestamp, new Date(since)));
      const rows = await db.select().from(auditLogs)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(auditLogs.timestamp))
        .limit(lim);
      res.json({ logs: rows });
    } catch (e: any) {
      res.status(500).json({ message: e?.message });
    }
  });

  // POST /api/system/user-errors
  const userErrorThrottle = new Map<string, number>();
  app.post("/api/system/user-errors", async (req, res) => {
    try {
      const session = req.session as any;
      const userId = session?.adminId ? String(session.adminId) : null;
      const userRole = session?.adminRole ?? null;

      const { request_id, action, error_code, message_shown, route, form_state_snapshot } = req.body ?? {};
      if (!request_id || typeof request_id !== "string") {
        return res.status(400).json({ code: "MISSING_REQUEST_ID" });
      }
      if (!/^req_/.test(request_id) && request_id.length > 64) {
        return res.status(400).json({ code: "INVALID_REQUEST_ID" });
      }

      const throttleKey = `${userId}:${action}:${error_code}`;
      const lastSeen = userErrorThrottle.get(throttleKey) ?? 0;
      if (Date.now() - lastSeen < 5_000) {
        return res.status(429).json({ code: "THROTTLED" });
      }
      userErrorThrottle.set(throttleKey, Date.now());

      const MAX_SNAPSHOT = 8 * 1024;
      let snapshot: unknown = null;
      if (form_state_snapshot && typeof form_state_snapshot === "object") {
        const str = JSON.stringify(form_state_snapshot);
        snapshot = str.length <= MAX_SNAPSHOT ? form_state_snapshot : null;
      }

      await db.insert(userErrorEvents).values({
        requestId: request_id,
        userId,
        userRole,
        action: action ?? null,
        errorCode: error_code ?? null,
        messageShown: message_shown ?? null,
        route: route ?? null,
        formStateSnapshot: snapshot,
      });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e?.message });
    }
  });

  // GET /api/system/user-errors
  app.get("/api/system/user-errors", async (req, res) => {
    try {
      const { user_id, error_code, since, limit } = req.query as Record<string, string>;
      const lim = Math.min(parseInt(limit ?? "100", 10) || 100, 500);
      const conditions: any[] = [];
      if (user_id) conditions.push(eq(userErrorEvents.userId, user_id));
      if (error_code) conditions.push(eq(userErrorEvents.errorCode, error_code));
      if (since) conditions.push(gte(userErrorEvents.timestamp, new Date(since)));
      const rows = await db.select().from(userErrorEvents)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(userErrorEvents.timestamp))
        .limit(lim);
      res.json({ events: rows });
    } catch (e: any) {
      res.status(500).json({ message: e?.message });
    }
  });
}
