import express from "express";
import session from "express-session";
import type { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../infra/db";
import { resetDatabase } from "../../test/itest";
import { attachPipelineLogs, parseHealthLogsOptions, queryHealthLogs } from "./healthLogs";
import { gateAdminApi } from "../../shared/middleware/requireAdmin";
import { mountHealthRoutes } from "./health.routes";

beforeEach(resetDatabase);

async function withHealthApp(run: (base: string) => Promise<void>) {
  const app = express();
  app.use(session({ secret: "health-logs-itest-only", resave: false, saveUninitialized: false }));
  // This fixture creates an authenticated cookie; production credential checking is outside this route test.
  app.post("/__test/login", (req, res) => {
    req.session.adminId = 1;
    res.sendStatus(204);
  });
  app.use(gateAdminApi);
  mountHealthRoutes(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function insert(at: string, level: string, pipeline: string, message: string) {
  const result = await pool.query<{ id: number }>(
    "insert into app_logs (occurred_at, level, pipeline, request_id, message) values ($1::timestamp, $2, $3, $4, $5) returning id",
    [at, level, pipeline, "request-itest", message],
  );
  return result.rows[0].id;
}

describe("health log PostgreSQL reads", () => {
  it("keyset pagination has no duplicate or omitted rows at tied and microsecond timestamps, including a newer insertion", async () => {
    const old = await insert("2026-11-11T00:00:00.123454Z", "warn", "future.job", "old");
    const tiedA = await insert("2026-11-11T00:00:00.123455Z", "warn", "future.job", "tie a");
    const tiedB = await insert("2026-11-11T00:00:00.123455Z", "error", "future.job", "tie b");
    const newest = await insert("2026-11-11T00:00:00.123456Z", "warn", "future.job", "newest");
    const filters = { pipeline: "future.job", level: "warn" as const, limit: 2 };
    const first = await queryHealthLogs(filters);
    expect(first.logs.map((log) => log.id)).toEqual([newest, tiedB]);
    expect(first.logs[0]).toMatchObject({ at: "2026-11-11T00:00:00.123456Z", requestId: "request-itest" });
    await insert("2026-11-11T00:00:00.123457Z", "error", "future.job", "arrived during paging");
    const second = await queryHealthLogs(parseHealthLogsOptions({ pipeline: "future.job", level: "warn", limit: "2", cursor: first.nextCursor! }));
    expect(second.logs.map((log) => log.id)).toEqual([tiedA, old]);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.logs, ...second.logs].map((log) => log.id)).size).toBe(4);
  });

  it("filters by future pipeline id, inclusive since and minimum level, using bound query parameters", async () => {
    await insert("2026-11-10T23:59:59.999999Z", "error", "future.job", "before cutoff");
    const warn = await insert("2026-11-11T00:00:00.000000Z", "warn", "future.job", "at cutoff");
    const error = await insert("2026-11-11T01:00:00.000000Z", "error", "future.job", "later error");
    await insert("2026-11-11T02:00:00Z", "info", "future.job", "info");
    await insert("2026-11-11T03:00:00Z", "error", "other.job", "other pipeline");
    expect((await queryHealthLogs({ pipeline: "future.job", since: "2026-11-11T00:00:00Z", level: "warn" })).logs.map((log) => log.id)).toEqual([error, warn]);
    expect((await queryHealthLogs({ pipeline: "future.job", since: "2026-11-11T00:00:00Z", level: "error" })).logs.map((log) => log.id)).toEqual([error]);
    expect((await queryHealthLogs({ pipeline: "' OR 1=1 --" })).logs).toEqual([]);
  });

  it("attaches at most 20 warnings per pipeline in the last 24 hours and includes the cutoff", async () => {
    await insert("2026-11-10T11:59:59.999999Z", "error", "future.job", "too old");
    const boundary = await insert("2026-11-10T12:00:00Z", "warn", "at.boundary", "exactly 24h");
    await insert("2026-11-11T12:00:00.000001Z", "error", "future.job", "future");
    await insert("2026-11-11T11:00:00Z", "info", "future.job", "info excluded");
    const ids: number[] = [];
    for (let i = 0; i < 25; i++) ids.push(await insert("2026-11-11T10:00:00Z", i % 2 ? "warn" : "error", "future.job", `warning ${i}`));
    const report = await attachPipelineLogs({ pipelines: [{ id: "future.job" }, { id: "at.boundary" }, { id: "empty" }] }, new Date("2026-11-11T12:00:00Z"));
    expect(report.pipelines[0].logs.map((log) => log.id)).toEqual(ids.reverse().slice(0, 20));
    expect(report.pipelines[1].logs.map((log) => log.id)).toEqual([boundary]);
    expect(report.pipelines[2].logs).toEqual([]);
    expect(report.pipelines.every((pipeline) => !pipeline.logsError)).toBe(true);
  });
});

describe("health log HTTP routes with PostgreSQL", () => {
  beforeEach(() => { delete process.env.HEALTH_TOKEN; });
  afterEach(() => { delete process.env.HEALTH_TOKEN; });

  it("uses the configured health token or an authenticated admin cookie to read the same database logs", async () => {
    const id = await insert("2026-11-11T00:00:00.123456Z", "error", "future.job", "route database evidence");
    await withHealthApp(async (base) => {
      const headers = { Authorization: "Bearer itest-health-token" };
      expect((await fetch(`${base}/api/health/logs`, { headers })).status).toBe(503);
      process.env.HEALTH_TOKEN = "itest-health-token";
      expect((await fetch(`${base}/api/health/logs`)).status).toBe(401);
      expect((await fetch(`${base}/api/health/logs`, { headers: { Authorization: "Bearer wrong-token" } })).status).toBe(401);
      expect((await fetch(`${base}/api/admin/health/logs`, { headers })).status).toBe(401);

      const response = await fetch(`${base}/api/health/logs`, { headers });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const tokenPage = await response.json();
      expect(tokenPage).toEqual({
        logs: [{ id, at: "2026-11-11T00:00:00.123456Z", level: "error", pipeline: "future.job", requestId: "request-itest", message: "route database evidence" }],
        nextCursor: null,
      });

      const login = await fetch(`${base}/__test/login`, { method: "POST" });
      expect(login.status).toBe(204);
      const cookie = login.headers.get("set-cookie")?.split(";")[0];
      expect(cookie).toBeTruthy();
      delete process.env.HEALTH_TOKEN;
      const admin = await fetch(`${base}/api/admin/health/logs`, { headers: { Cookie: cookie! } });
      expect(admin.status).toBe(200);
      expect(admin.headers.get("cache-control")).toBe("no-store");
      expect(await admin.json()).toEqual(tokenPage);
    });
  });

  it("applies HTTP pipeline/time/severity filters and follows a keyset cursor without duplicates", async () => {
    await insert("2026-11-10T23:59:59.999999Z", "error", "future.job", "outside time range");
    const atCutoff = await insert("2026-11-11T00:00:00Z", "warn", "future.job", "included cutoff");
    const earlierTie = await insert("2026-11-11T01:00:00.123456Z", "error", "future.job", "earlier tie");
    const laterTie = await insert("2026-11-11T01:00:00.123456Z", "warn", "future.job", "later tie");
    await insert("2026-11-11T02:00:00Z", "info", "future.job", "below threshold");
    await insert("2026-11-11T03:00:00Z", "error", "other.job", "different pipeline");
    process.env.HEALTH_TOKEN = "itest-health-token";
    await withHealthApp(async (base) => {
      const headers = { Authorization: "Bearer itest-health-token" };
      const params = new URLSearchParams({ pipeline: "future.job", since: "2026-11-11T00:00:00Z", level: "warn", limit: "2" });
      const firstResponse = await fetch(`${base}/api/health/logs?${params}`, { headers });
      expect(firstResponse.status).toBe(200);
      const first = await firstResponse.json();
      expect(first.logs.map((log: { id: number }) => log.id)).toEqual([laterTie, earlierTie]);
      expect(typeof first.nextCursor).toBe("string");
      await insert("2026-11-11T04:00:00Z", "error", "future.job", "inserted during paging");
      params.set("cursor", first.nextCursor);
      const secondResponse = await fetch(`${base}/api/health/logs?${params}`, { headers });
      expect(secondResponse.status).toBe(200);
      const second = await secondResponse.json();
      expect(second.logs.map((log: { id: number }) => log.id)).toEqual([atCutoff]);
      expect(second.nextCursor).toBeNull();
      expect((await fetch(`${base}/api/health/logs?since=2026-02-30T00:00:00Z`, { headers })).status).toBe(400);
      expect((await fetch(`${base}/api/health/logs?cursor=invalid-cursor`, { headers })).status).toBe(400);
    });
  });
});
