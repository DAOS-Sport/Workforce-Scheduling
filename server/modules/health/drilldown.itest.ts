import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "../../infra/db";
import { resetDatabase } from "../../test/itest";
import { requestContext, globalErrorHandler } from "../../shared/http/errorHandler";
import { gateAdminApi } from "../../shared/middleware/requireAdmin";
import { settleErrorWrites } from "../errors/errors.service";
import { mountHealthRoutes } from "./health.routes";

const HEADERS = { Authorization: "Bearer drilldown-itest-token" };
const REQUEST = "b6f0c2d4-8e1b-4c3d-9a22-123456789abc";
const PRIVATE = ["虛構姓名丙", "0912345678", "fixture.person@example.invalid", `U${"d".repeat(32)}`];

async function withApp(run: (base: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use(requestContext);
  // Synthetic producer, before the real admin gate; no production route is changed.
  app.patch("/api/employees/:id", (_req, res) => res.status(500).json({ message: `TypeError: ${PRIVATE.join(" ")}` }));
  app.use((req, _res, next) => { req.session = {} as any; next(); });
  app.use(gateAdminApi);
  mountHealthRoutes(app);
  app.use(globalErrorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try { await run(`http://127.0.0.1:${port}`); }
  finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

beforeEach(async () => {
  await resetDatabase();
  vi.stubEnv("HEALTH_TOKEN", "drilldown-itest-token");
  vi.stubEnv("HEALTH_BUILD_LABEL", "drilldown-itest-build");
  vi.stubEnv("HEALTH_PUBLIC_URL", "https://workforce.example.invalid/some/path?discard=fixture#old");
});
afterEach(() => vi.unstubAllEnvs());

describe("drilldown-v1 through health routes and disposable PostgreSQL", () => {
  it("correlates a real 5xx request with its app_errors row and route pipeline evidence", async () => {
    await withApp(async base => {
      const failed = await fetch(`${base}/api/employees/123?phone=${PRIVATE[1]}`, { method: "PATCH", headers: { "X-Request-Id": REQUEST } });
      expect(failed.status).toBe(500);
      expect(failed.headers.get("x-request-id")).toBe(REQUEST);
      await failed.text();
      await settleErrorWrites();
      const raw = await pool.query("select request_id, status, message from app_errors where request_id = $1", [REQUEST]);
      expect(raw.rows).toHaveLength(1);
      expect(raw.rows[0].message).toContain(PRIVATE[0]);
      const response = await fetch(`${base}/api/health/pipelines`, { headers: HEADERS });
      expect(response.status).toBe(200);
      const report = await response.json();
      const pipe = report.pipelines.find((p: any) => p.id === "employee.manage");
      expect(pipe.level).toBe("red");
      expect(pipe.evidence).toEqual([expect.objectContaining({ requestId: raw.rows[0].request_id, code: "500", route: "PATCH /api/employees/:id", summary: "伺服器錯誤 500" })]);
      expect(pipe.evidence[0].at).toMatch(/(?:Z|[+-]\d{2}:\d{2})$/);
      expect(report.pipelines.find((p: any) => p.id === "server.errors").evidence[0].requestId).toBe(REQUEST);
    });
  });

  it("uses only the configured HTTPS origin and protects the monitor APIs without a session", async () => {
    await withApp(async base => {
      const report = await (await fetch(`${base}/api/health/pipelines`, { headers: HEADERS })).json();
      for (const p of report.pipelines) {
        expect(p.links).toHaveLength(1);
        expect(p.links[0].url).toBe(`https://workforce.example.invalid/it-monitor#${p.id}`);
        for (const link of p.links) {
          const url = new URL(link.url);
          expect(url.protocol).toBe("https:");
          expect(url.host).toBe("workforce.example.invalid");
          expect([url.search, url.username, url.password]).toEqual(["", "", ""]);
        }
      }
      expect((await fetch(`${base}/api/admin/health`)).status).toBe(401);
      expect((await fetch(`${base}/api/admin/health/logs`)).status).toBe(401);
    });
  });

  it("keeps synthetic PII in neither summary nor route while retaining existing logs", async () => {
    const at = new Date().toISOString();
    await pool.query("insert into app_errors (request_id, method, path, status, message, stack, occurred_at) values ($1,'PATCH',$2,500,$3,$3,$4)",
      [REQUEST, `/api/employees/${encodeURIComponent(PRIVATE[0])}?email=${PRIVATE[2]}`, PRIVATE.join(" "), at]);
    await pool.query("insert into pipeline_logs (occurred_at, level, pipeline, request_id, message) values ($1::timestamp,'error','employee.manage',$2,$3)",
      [at, REQUEST, PRIVATE.join(" ")]);
    await withApp(async base => {
      const report = await (await fetch(`${base}/api/health/pipelines`, { headers: HEADERS })).json();
      const pipe = report.pipelines.find((p: any) => p.id === "employee.manage");
      expect(pipe.evidence.length).toBeGreaterThan(0);
      expect(pipe.evidence.every((e: any) => e.code === "500" && e.route === "PATCH /api/employees/:id")).toBe(true);
      expect(pipe.logs).toHaveLength(1);
      for (const p of report.pipelines) for (const evidence of p.evidence ?? []) {
        const fields = JSON.stringify([evidence.summary, evidence.route]);
        for (const value of PRIVATE) {
          expect(fields).not.toContain(value);
          expect(fields).not.toContain(encodeURIComponent(value));
        }
      }
    });
  });

  it("returns only existing pipeline IDs on errors, and null for an unattributed route", async () => {
    await pool.query("insert into app_errors (request_id,method,path,status,message) values ($1,'PATCH','/api/employees/123',500,'fixture'), ($1,'GET','/unattributed/123',500,'fixture')", [REQUEST]);
    await withApp(async base => {
      const report = await (await fetch(`${base}/api/health/pipelines`, { headers: HEADERS })).json();
      const errors = await (await fetch(`${base}/api/health/errors`, { headers: HEADERS })).json();
      const ids = new Set(report.pipelines.map((p: any) => p.id));
      expect(errors.errors.find((e: any) => e.route === "PATCH /api/employees/:id").pipeline).toBe("employee.manage");
      expect(errors.errors.find((e: any) => e.route.startsWith("GET ")).pipeline).toBeNull();
      for (const e of errors.errors) if (e.pipeline !== null) expect(ids.has(e.pipeline)).toBe(true);
      expect(errors.build).toBe(report.build);
      expect(errors.errors.every((e: any) => e.release === "unknown")).toBe(true);
    });
  });

  it("omits all drilldown fields when configuration and failure events are absent", async () => {
    vi.stubEnv("HEALTH_PUBLIC_URL", "");
    await withApp(async base => {
      const report = await (await fetch(`${base}/api/health/pipelines`, { headers: HEADERS })).json();
      expect(report.pipelines.length).toBeGreaterThan(0);
      expect(report.pipelines.every((p: any) => !("links" in p) && !("evidence" in p))).toBe(true);
      expect(Object.keys(report).sort()).toEqual(["build", "checkedAt", "overall", "pipelines", "system"]);
    });
  });

  it("takes the newest five warnings, validates request IDs, and reads existing failed job state", async () => {
    const now = Date.now();
    for (let i = 0; i < 7; i++) await pool.query("insert into pipeline_logs (occurred_at,level,pipeline,request_id,message) values ($1::timestamp,'warn','portal.login',$2,$3)",
      [new Date(now - i * 1000).toISOString(), i === 0 ? "a".repeat(64) : i === 1 ? "a".repeat(65) : i === 2 ? "bad_id" : `request-${i}`, PRIVATE.join(" ")]);
    await pool.query("insert into system_configs (key,value) values ('health:job:ragic.sync',$1)",
      [JSON.stringify({ lastStatus: "failed", lastStartedAt: new Date(now - 2000).toISOString(), lastFailureAt: new Date(now - 1000).toISOString(), lastError: PRIVATE.join(" ") })]);
    await withApp(async base => {
      const report = await (await fetch(`${base}/api/health/pipelines`, { headers: HEADERS })).json();
      const login = report.pipelines.find((p: any) => p.id === "portal.login");
      expect(login.level).toBe("yellow");
      expect(login.evidence).toHaveLength(5);
      expect(login.evidence.map((e: any) => e.requestId)).toEqual(["a".repeat(64), null, null, "request-3", "request-4"]);
      expect(login.evidence.map((e: any) => Date.parse(e.at))).toEqual(Array.from({ length: 5 }, (_, i) => now - i * 1000));
      const sync = report.pipelines.find((p: any) => p.id === "ragic.employee-sync");
      expect(sync.evidence).toEqual([expect.objectContaining({ requestId: null, code: null, route: null, summary: "排程執行失敗" })]);
    });
  });
});
