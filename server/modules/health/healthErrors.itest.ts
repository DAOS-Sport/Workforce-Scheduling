import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { appErrors, type InsertAppError } from "@shared/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../bootstrap/app";
import { db, pool } from "../../infra/db";
import { resetDatabase } from "../../test/itest";
import { settleErrorWrites } from "../errors/errors.service";

const HEADERS = { Authorization: "Bearer itest-health-errors-token" };
const UUID = "b6f0c2d4-8e1b-4c3d-9a22-123456789abc";

function event(at: string, overrides: Partial<InsertAppError> = {}): InsertAppError {
  return { requestId: UUID, method: "PATCH", path: "/api/employees/123", status: 500, message: "TypeError: synthetic private detail", occurredAt: new Date(at), ...overrides };
}

async function withRealApp(run: (base: string) => Promise<void>): Promise<void> {
  const { app, httpServer: server } = await buildApp();
  // buildApp mounts real middleware/routes; bootstrap adds client assets after those routes.
  app.use((_req, res) => res.type("html").send("<!doctype html><title>SPA fallback</title>"));
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try { await run(`http://127.0.0.1:${port}`); }
  finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await settleErrorWrites();
  }
}

beforeEach(async () => {
  await resetDatabase();
  vi.stubEnv("HEALTH_TOKEN", "itest-health-errors-token");
  vi.stubEnv("HEALTH_BUILD_LABEL", "itest-build");
  vi.stubEnv("REPLIT_DEPLOYMENT", "0");
});

afterEach(async () => {
  await settleErrorWrites();
  vi.unstubAllEnvs();
});

describe("errors-v1 real application HTTP with PostgreSQL", () => {
  it("uses the health token through the real admin gate, before the SPA fallback", async () => {
    await withRealApp(async (base) => {
      vi.stubEnv("HEALTH_TOKEN", "");
      const unavailable = await fetch(`${base}/api/health/errors`, { headers: HEADERS });
      expect(unavailable.status).toBe(503);
      expect(unavailable.headers.get("cache-control")).toBe("no-store");
      await unavailable.text();
      // The existing global error response layer records 5xx answers asynchronously.
      await settleErrorWrites();

      vi.stubEnv("HEALTH_TOKEN", "itest-health-errors-token");
      const cases: Record<string, string>[] = [{}, { Authorization: "Bearer wrong-itest-token" }];
      for (const headers of cases) {
        const denied = await fetch(`${base}/api/health/errors`, { headers });
        expect(denied.status).toBe(401);
        expect(denied.headers.get("cache-control")).toBe("no-store");
        await denied.text();
      }
      const allowed = await fetch(`${base}/api/health/errors`, { headers: HEADERS });
      expect(allowed.status).toBe(200);
      expect(allowed.headers.get("cache-control")).toBe("no-store");
      expect(allowed.headers.get("content-type")).toContain("application/json");
      expect((await allowed.json()).system).toBe("workforce-scheduling");
      const unknown = await fetch(`${base}/api/health/zzz`, { headers: HEADERS });
      expect(unknown.headers.get("content-type")).toContain("text/html");
      expect(await unknown.text()).toContain("SPA fallback");
    });
  });

  it("filters and groups stored events using actual registered templates, exports no PII, and retains the global minimum", async () => {
    const email = "fixture.person@example.invalid";
    const phone = "0912345678";
    const lineId = `U${"b".repeat(32)}`;
    const name = "測試姓名乙";
    const externalId = `${email}-${phone}`;
    await db.insert(appErrors).values([
      event("2026-11-09T00:00:00Z"),
      event("2026-11-10T23:59:59.999Z"),
      event("2026-11-11T00:00:00Z"),
      event("2026-11-12T01:00:00Z", { path: "/api/employees/456", requestId: "earlier-tie" }),
      event("2026-11-12T01:00:00Z", { path: `/api/employees/789?email=${email}`, requestId: externalId, message: `TypeError: ${name} ${email} ${phone} ${lineId}`, stack: `${name} ${email}`, subject: { name, phone } }),
      event("2026-11-12T02:00:00Z", { status: 503 }),
      event("2026-11-12T03:00:00Z", { path: `/api/unregistered/${email}/${lineId}/987`, message: `Error: ${name}` }),
      event("2026-11-12T04:00:00Z", { method: "GET", path: `/api/employees/${encodeURIComponent(name)}`, message: `Error: ${name}` }),
    ]);
    const before = await db.select().from(appErrors).orderBy(appErrors.id);
    await withRealApp(async (base) => {
      const query = new URLSearchParams({ since: "2026-11-11T08:00:00+08:00" });
      const res = await fetch(`${base}/api/health/errors?${query}`, { headers: HEADERS });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Object.keys(body).sort()).toEqual(["build", "checkedAt", "errors", "retainedSince", "since", "system", "truncated"]);
      expect(body).toMatchObject({ system: "workforce-scheduling", build: "itest-build", truncated: false });
      expect(Date.parse(body.since)).toBe(Date.parse("2026-11-11T00:00:00Z"));
      expect(Date.parse(body.retainedSince)).toBe(Date.parse("2026-11-09T00:00:00Z"));
      expect(body.errors).toHaveLength(4);
      const merged = body.errors.find((entry: { count: number }) => entry.count === 3);
      expect(merged).toMatchObject({ route: "PATCH /api/employees/:id", code: "500", env: "development", release: "unknown", pipeline: "employee.manage", request_id: `ext-${createHash("sha256").update(externalId).digest("hex").slice(0, 12)}` });
      expect(Date.parse(merged.first_seen)).toBe(Date.parse("2026-11-11T00:00:00Z"));
      expect(Date.parse(merged.last_seen)).toBe(Date.parse("2026-11-12T01:00:00Z"));
      expect(body.errors[0]).toMatchObject({ route: "GET /api/employees/:regionCode", request_id: UUID });
      expect(body.errors.map((entry: { route: string }) => entry.route)).toContain("PATCH /api/:segment/:segment/:segment/:id");
      expect(body.errors.find((entry: { route: string }) => entry.route === "PATCH /api/:segment/:segment/:segment/:id").pipeline).toBeNull();
      expect(body.errors.map((entry: { last_seen: string }) => Date.parse(entry.last_seen))).toEqual([
        Date.parse("2026-11-12T04:00:00Z"), Date.parse("2026-11-12T03:00:00Z"), Date.parse("2026-11-12T02:00:00Z"), Date.parse("2026-11-12T01:00:00Z"),
      ]);
      for (const error of body.errors) {
        expect(Object.keys(error).sort()).toEqual(["code", "count", "env", "fingerprint", "first_seen", "last_seen", "level", "message", "pipeline", "release", "request_id", "route", "system", "ts"]);
        expect(error.release).toBe("unknown");
        expect(error.fingerprint).toMatch(/^[0-9a-f]{12}$/);
        for (const at of [error.ts, error.first_seen, error.last_seen]) expect(at).toMatch(/\+08:00$/);
      }
      const serialized = JSON.stringify(body);
      for (const secret of [email, phone, lineId, name, encodeURIComponent(name), externalId, "synthetic private detail"]) expect(serialized).not.toContain(secret);
    });
    // Independently read raw rows to prove a successful export changed no source events.
    expect(await db.select().from(appErrors).orderBy(appErrors.id)).toEqual(before);
  });

  it("keeps a historical event release unknown when the running build changes", async () => {
    const at = new Date(Date.now() - 3_600_000);
    await db.insert(appErrors).values(event(at.toISOString()));
    const before = await db.select().from(appErrors);
    await withRealApp(async (base) => {
      const snapshots = [];
      for (const build of ["itest-build-A", "itest-build-B"]) {
        vi.stubEnv("HEALTH_BUILD_LABEL", build);
        const response = await fetch(`${base}/api/health/errors`, { headers: HEADERS });
        expect(response.status).toBe(200);
        const report = await response.json();
        expect(report.build).toBe(build);
        expect(report.errors).toHaveLength(1);
        snapshots.push(report.errors[0]);
      }
      expect(snapshots[0].ts).toBe(snapshots[1].ts);
      expect(snapshots[0].fingerprint).toBe(snapshots[1].fingerprint);
      expect(snapshots.map((entry) => entry.release)).toEqual(["unknown", "unknown"]);
    });
    expect(await db.select().from(appErrors)).toEqual(before);
  });

  it("uses the last 24 hours by default while retainedSince still reports older stored rows", async () => {
    const now = Date.now();
    const old = new Date(now - 25 * 3_600_000);
    const recent = new Date(now - 3_600_000);
    await db.insert(appErrors).values([event(old.toISOString()), event(recent.toISOString())]);
    await withRealApp(async (base) => {
      const res = await fetch(`${base}/api/health/errors`, { headers: HEADERS });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Date.parse(body.checkedAt) - Date.parse(body.since)).toBe(24 * 3_600_000);
      expect(Date.parse(body.retainedSince)).toBe(old.getTime());
      expect(body.errors).toHaveLength(1);
      expect(body.errors[0].count).toBe(1);
      expect(Date.parse(body.errors[0].first_seen)).toBe(recent.getTime());
    });
  });

  it("applies precise since cutoffs and preserves PostgreSQL microsecond order after pg Date decoding", async () => {
    const newer = "11111111-1111-4111-8111-111111111111";
    const older = "22222222-2222-4222-8222-222222222222";
    // Insert strings directly: constructing Date fixtures would erase the precision under test.
    const events = [
      [newer, "2026-11-12T00:00:00.000900Z"],
      [older, "2026-11-12T00:00:00.000100Z"],
      [UUID, "2026-11-12T00:00:00.000000Z"],
    ];
    for (const [requestId, at] of events) {
      await pool.query(
        "insert into app_errors (request_id, method, path, status, message, occurred_at) values ($1, 'PATCH', '/api/employees/123', 500, 'TypeError: synthetic', $2::timestamptz)",
        [requestId, at],
      );
    }
    const raw = await pool.query<{ id: number; at: string; request_id: string }>(
      "select id, to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') as at, request_id from app_errors order by occurred_at desc, id desc",
    );
    expect(raw.rows.map(entry => entry.at)).toEqual([
      "2026-11-12T00:00:00.000900Z", "2026-11-12T00:00:00.000100Z", "2026-11-12T00:00:00.000000Z",
    ]);
    expect(raw.rows[0].id).toBeLessThan(raw.rows[1].id);
    await withRealApp(async (base) => {
      const read = async (since: string) => {
        const query = new URLSearchParams({ since });
        const res = await fetch(`${base}/api/health/errors?${query}`, { headers: HEADERS });
        expect(res.status).toBe(200);
        return res.json();
      };
      const all = await read("2026-11-12T00:00:00Z");
      expect(all.errors).toHaveLength(1);
      expect(all.errors[0]).toMatchObject({ count: 3, request_id: newer });
      const afterOld = await read("2026-11-12T00:00:00.000500Z");
      expect(afterOld.errors).toHaveLength(1);
      expect(afterOld.errors[0]).toMatchObject({ count: 1, request_id: newer });
      expect(afterOld.since).toBe("2026-11-12T08:00:00.000500+08:00");
      const afterAll = await read("2026-11-12T00:00:00.000999Z");
      expect(afterAll.errors).toEqual([]);
      // PostgreSQL timestamps have six fraction digits; do not let its rounding include .000000Z.
      const belowMicro = await read("2026-11-12T00:00:00.0000001Z");
      expect(belowMicro.errors[0]).toMatchObject({ count: 2, request_id: newer });
      expect(belowMicro.since).toBe("2026-11-12T08:00:00.0000001+08:00");
    });
  });

  it("returns the requested since as retainedSince for an empty table and rejects malformed HTTP filters", async () => {
    await withRealApp(async (base) => {
      const query = new URLSearchParams({ since: "2026-11-11T00:00:00Z" });
      const res = await fetch(`${base}/api/health/errors?${query}`, { headers: HEADERS });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.errors).toEqual([]);
      expect(body.truncated).toBe(false);
      expect(body.retainedSince).toBe(body.since);
      for (const invalid of ["since=", "since=2026-02-30T00:00:00Z", "since=2026-11-11T00:00:00Z&since=2026-11-12T00:00:00Z"]) {
        const bad = await fetch(`${base}/api/health/errors?${invalid}`, { headers: HEADERS });
        expect(bad.status).toBe(400);
        expect(bad.headers.get("cache-control")).toBe("no-store");
        await bad.text();
      }
    });
    expect(await db.select().from(appErrors)).toEqual([]);
  });

  it("uses a 1001-row probe but aggregates at most 1000 source events, including the tied-id boundary", async () => {
    await db.insert(appErrors).values(Array.from({ length: 1001 }, (_, index) => event("2026-11-12T01:00:00Z", { requestId: index === 1000 ? UUID : `synthetic-${index}` })));
    await withRealApp(async (base) => {
      const query = new URLSearchParams({ since: "2026-11-12T00:00:00Z" });
      const truncated = await fetch(`${base}/api/health/errors?${query}`, { headers: HEADERS });
      expect(truncated.status).toBe(200);
      const first = await truncated.json();
      expect(first.truncated).toBe(true);
      expect(first.errors).toHaveLength(1);
      expect(first.errors[0]).toMatchObject({ count: 1000, request_id: UUID });
      await db.delete(appErrors).where(eq(appErrors.id, 1));
      const exact = await fetch(`${base}/api/health/errors?${query}`, { headers: HEADERS });
      expect(exact.status).toBe(200);
      const second = await exact.json();
      expect(second.truncated).toBe(false);
      expect(second.errors[0]).toMatchObject({ count: 1000, request_id: UUID });
    });
  });
});
