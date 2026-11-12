import { createHash } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import type { AppErrorRow } from "@shared/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listErrors, oldestOccurredAt } = vi.hoisted(() => ({ listErrors: vi.fn(), oldestOccurredAt: vi.fn() }));
vi.mock("../errors/errors.repository", () => ({ errorsRepository: { list: listErrors, oldestOccurredAt } }));
vi.mock("./health.service", () => ({ buildHealthReport: vi.fn(), readClockNeverSuccessEmployees: vi.fn() }));
vi.mock("../admin/admin.service", () => ({ adminService: { resolveSession: vi.fn() } }));
vi.mock("../../infra/db", () => ({ db: { execute: vi.fn() } }));

import { gateAdminApi } from "../../shared/middleware/requireAdmin";
import { mountHealthRoutes } from "./health.routes";

const NOW = "2026-11-12T04:00:00.000Z";
const TOKEN = { Authorization: "Bearer unit-health-token" };
const UUID = "b6f0c2d4-8e1b-4c3d-9a22-123456789abc";
const OUTER = ["system", "build", "checkedAt", "since", "retainedSince", "truncated", "errors"].sort();
const INNER = ["system", "env", "ts", "level", "code", "message", "request_id", "route", "fingerprint", "count", "first_seen", "last_seen", "release"].sort();

function row(id: number, overrides: Partial<AppErrorRow> = {}): AppErrorRow {
  return { id, requestId: UUID, method: "PATCH", path: "/api/employees/123", status: 500, message: "TypeError: private detail", stack: null, subject: null, occurredAt: new Date("2026-11-12T03:00:00Z"), ...overrides };
}

function stored(rows: AppErrorRow[]): void {
  listErrors.mockImplementation(async ({ since, limit }: { since: Date; limit: number }) => rows
    .filter((entry) => entry.occurredAt >= since)
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.id - a.id)
    .slice(0, limit));
  oldestOccurredAt.mockResolvedValue(rows.length ? new Date(Math.min(...rows.map((entry) => entry.occurredAt.getTime()))) : null);
}

async function withApp(run: (base: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(gateAdminApi);
  // These are real Express registrations: the exporter must resolve stored raw paths to their templates.
  app.patch("/api/employees/:id", (_req, res) => res.sendStatus(204));
  app.post("/api/line/:lineUserId", (_req, res) => res.sendStatus(204));
  app.get("/api/people/:name", (_req, res) => res.sendStatus(204));
  mountHealthRoutes(app);
  app.use((_req, res) => res.type("html").send("<!doctype html><title>SPA fallback</title>"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try { await run(`http://127.0.0.1:${port}`); }
  finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const sinceQuery = (since: string) => new URLSearchParams({ since }).toString();

describe("GET /api/health/errors errors-v1 over HTTP", () => {
  beforeEach(() => {
    vi.stubEnv("HEALTH_TOKEN", "unit-health-token");
    vi.stubEnv("HEALTH_BUILD_LABEL", "unit-build");
    vi.stubEnv("REPLIT_DEPLOYMENT", "1");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
    stored([]);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it("returns 503 with no configured token and never caches or queries", async () => {
    vi.stubEnv("HEALTH_TOKEN", "   ");
    await withApp(async (base) => {
      const res = await fetch(`${base}/api/health/errors`, { headers: TOKEN });
      expect(res.status).toBe(503);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(listErrors).not.toHaveBeenCalled();
      expect(oldestOccurredAt).not.toHaveBeenCalled();
    });
  });

  it("returns 401 for missing, wrong, or non-Bearer tokens without querying", async () => {
    await withApp(async (base) => {
      const cases: Record<string, string>[] = [{}, { Authorization: "Bearer wrong" }, { Authorization: "unit-health-token" }];
      for (const headers of cases) {
        const res = await fetch(`${base}/api/health/errors`, { headers });
        expect(res.status).toBe(401);
        expect(res.headers.get("cache-control")).toBe("no-store");
      }
      expect(listErrors).not.toHaveBeenCalled();
      expect(oldestOccurredAt).not.toHaveBeenCalled();
    });
  });

  it("passes the real global admin gate using the health token and exports exactly 7 outer / 13 inner fields", async () => {
    stored([row(1)]);
    await withApp(async (base) => {
      const res = await fetch(`${base}/api/health/errors`, { headers: TOKEN });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = await res.json();
      expect(Object.keys(body).sort()).toEqual(OUTER);
      expect(body).toMatchObject({ system: "workforce-scheduling", build: "unit-build", truncated: false });
      expect(body.errors).toHaveLength(1);
      const error = body.errors[0];
      expect(Object.keys(error).sort()).toEqual(INNER);
      expect(error).toMatchObject({ system: "workforce-scheduling", env: "production", level: "error", code: "500", route: "PATCH /api/employees/:id", request_id: UUID, count: 1, release: "unknown" });
      expect(error.fingerprint).toMatch(/^[0-9a-f]{12}$/);
      for (const timestamp of [body.checkedAt, body.since, body.retainedSince, error.ts, error.first_seen, error.last_seen]) {
        expect(timestamp).toMatch(/\+08:00$/);
        expect(Number.isFinite(Date.parse(timestamp))).toBe(true);
      }
      expect(Date.parse(body.checkedAt)).toBe(Date.parse(NOW));
      expect(error.ts).toBe(error.last_seen);
    });
  });

  it("merges only the same route/status/kind, orders newest first and resolves same-time latest ids", async () => {
    stored([
      row(1, { occurredAt: new Date("2026-11-12T01:00:00Z") }),
      row(2, { path: "/api/employees/456?phone=0900000000", occurredAt: new Date("2026-11-12T02:00:00Z"), requestId: "old-tie" }),
      row(3, { occurredAt: new Date("2026-11-12T02:00:00Z"), requestId: UUID }),
      row(4, { status: 503, occurredAt: new Date("2026-11-12T02:30:00Z") }),
      row(5, { message: "RangeError: a different kind", occurredAt: new Date("2026-11-12T03:00:00Z") }),
      row(6, { method: "GET", path: "/api/people/alice", occurredAt: new Date("2026-11-12T03:30:00Z") }),
    ]);
    await withApp(async (base) => {
      const res = await fetch(`${base}/api/health/errors?${sinceQuery("2026-11-12T00:00:00Z")}`, { headers: TOKEN });
      expect(res.status).toBe(200);
      const { errors } = await res.json();
      expect(errors).toHaveLength(4);
      expect(errors.map((error: { last_seen: string }) => Date.parse(error.last_seen))).toEqual([
        Date.parse("2026-11-12T03:30:00Z"), Date.parse("2026-11-12T03:00:00Z"), Date.parse("2026-11-12T02:30:00Z"), Date.parse("2026-11-12T02:00:00Z"),
      ]);
      expect(new Set(errors.map((error: { fingerprint: string }) => error.fingerprint)).size).toBe(4);
      const merged = errors.find((error: { count: number }) => error.count === 3);
      expect(merged).toMatchObject({ count: 3, request_id: UUID, code: "500" });
      expect(Date.parse(merged.first_seen)).toBe(Date.parse("2026-11-12T01:00:00Z"));
      expect(Date.parse(merged.last_seen)).toBe(Date.parse("2026-11-12T02:00:00Z"));
    });
  });

  it("preserves PostgreSQL ordering when distinct microsecond timestamps decode to identical Dates", async () => {
    const newest = "11111111-1111-4111-8111-111111111111";
    const older = "22222222-2222-4222-8222-222222222222";
    // PostgreSQL sorted .000900Z before .000100Z; the pg Date decoder loses that precision.
    const decoded = new Date("2026-11-12T00:00:00.000Z");
    listErrors.mockResolvedValue([
      row(1, { occurredAt: decoded, requestId: newest }),
      row(2, { occurredAt: decoded, requestId: older }),
    ]);
    oldestOccurredAt.mockResolvedValue(decoded);
    await withApp(async (base) => {
      const res = await fetch(`${base}/api/health/errors?${sinceQuery("2026-11-12T00:00:00Z")}`, { headers: TOKEN });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.errors).toHaveLength(1);
      expect(body.errors[0]).toMatchObject({ count: 2, request_id: newest });
    });
  });

  it.each([
    ["2026-11-12T00:00:00.000999Z", "2026-11-12T00:00:00.000999Z", "2026-11-12T08:00:00.000999+08:00"],
    ["2026-11-12T00:00:00.0000001Z", "2026-11-12T00:00:00.000001Z", "2026-11-12T08:00:00.0000001+08:00"],
    ["2026-11-12T00:00:00.9999999Z", "2026-11-12T00:00:01.000000Z", "2026-11-12T08:00:00.9999999+08:00"],
  ])("preserves precise since %s while passing a safe PostgreSQL cutoff", async (since, databaseSince, responseSince) => {
    // Inspect the actual cutoff sent to PostgreSQL, rather than simulating sub-ms comparisons with Date.
    listErrors.mockResolvedValue([]);
    await withApp(async (base) => {
      const res = await fetch(`${base}/api/health/errors?${sinceQuery(since)}`, { headers: TOKEN });
      expect(res.status).toBe(200);
      expect(listErrors).toHaveBeenCalledWith({ since: databaseSince, limit: 1001 });
      const body = await res.json();
      expect(body.since).toBe(responseSince);
      expect(body.retainedSince).toBe(responseSince);
    });
  });

  it("defaults since to exactly 24 hours and queries at the inclusive cutoff with a 1001-row probe", async () => {
    stored([
      row(1, { occurredAt: new Date("2026-11-11T03:59:59.999Z") }),
      row(2, { occurredAt: new Date("2026-11-11T04:00:00Z") }),
      row(3, { occurredAt: new Date("2026-11-12T03:00:00Z") }),
    ]);
    await withApp(async (base) => {
      const res = await fetch(`${base}/api/health/errors`, { headers: TOKEN });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Date.parse(body.since)).toBe(Date.parse("2026-11-11T04:00:00Z"));
      expect(listErrors).toHaveBeenCalledWith({ since: new Date("2026-11-11T04:00:00Z"), limit: 1001 });
      expect(body.errors[0].count).toBe(2);
      expect(Date.parse(body.errors[0].first_seen)).toBe(Date.parse("2026-11-11T04:00:00Z"));
      expect(Date.parse(body.retainedSince)).toBe(Date.parse("2026-11-11T03:59:59.999Z"));
      expect(oldestOccurredAt).toHaveBeenCalledTimes(1);
    });
  });

  it.each(["2026-11-12T08:00:00+08:00", "2026-11-11T19:00:00-05:00", "2026-11-12T00:00:00Z"])("accepts RFC3339 since %s and normalizes output to +08:00", async (since) => {
    stored([row(1, { occurredAt: new Date("2026-11-11T23:59:59Z") }), row(2, { occurredAt: new Date("2026-11-12T00:00:00Z") })]);
    await withApp(async (base) => {
      const res = await fetch(`${base}/api/health/errors?${sinceQuery(since)}`, { headers: TOKEN });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.since).toMatch(/\+08:00$/);
      expect(Date.parse(body.since)).toBe(Date.parse("2026-11-12T00:00:00Z"));
      expect(body.errors).toHaveLength(1);
      expect(body.errors[0].count).toBe(1);
    });
  });

  it("rejects malformed, empty, repeated and impossible since before querying", async () => {
    const queries = ["since=", "since=yesterday", "since=2026-11-12", "since=2026-11-12T00:00:00", "since=2026-02-30T00:00:00Z", "since=2026-02-30T08:00:00%2B08:00", "since=2026-13-01T00:00:00Z", "since=2026-11-12T24:00:00Z", "since=2026-11-12T00:00:00%2B24:00", "since=2026-11-12T00:00:00Z&since=2026-11-12T01:00:00Z"];
    await withApp(async (base) => {
      for (const query of queries) {
        const res = await fetch(`${base}/api/health/errors?${query}`, { headers: TOKEN });
        expect([query, res.status]).toEqual([query, 400]);
        expect(res.headers.get("cache-control")).toBe("no-store");
      }
      expect(listErrors).not.toHaveBeenCalled();
      expect(oldestOccurredAt).not.toHaveBeenCalled();
    });
  });

  it("uses registered templates and removes PII from every exported field, including caller request ids", async () => {
    const email = "fixture.person@example.invalid";
    const phone = "0912345678";
    const lineId = `U${"a".repeat(32)}`;
    const name = "測試姓名甲";
    const externalId = `${email}-${phone}`;
    stored([
      row(1, { path: `/api/employees/123?email=${email}`, requestId: externalId, message: `TypeError: ${email} ${phone} ${lineId} ${name}`, stack: `${name} ${email}`, subject: { name, phone } }),
      row(2, { method: "POST", path: `/api/line/${lineId}`, requestId: "1b4e28ba-2fa1-11d2-883f-0016d3cca427", message: `Error: ${name}` }),
      row(3, { method: "GET", path: `/api/people/${encodeURIComponent(name)}`, requestId: UUID, message: `${name} ${email}` }),
      row(4, { path: `/api/unregistered/${email}/${lineId}/987?name=${name}`, requestId: externalId, message: `Error: ${phone}` }),
    ]);
    await withApp(async (base) => {
      const res = await fetch(`${base}/api/health/errors`, { headers: TOKEN });
      expect(res.status).toBe(200);
      const body = await res.json();
      const serialized = JSON.stringify(body);
      for (const secret of [email, phone, lineId, name, encodeURIComponent(name), externalId, "private detail"]) expect(serialized).not.toContain(secret);
      expect(body.errors.map((error: { route: string }) => error.route)).toEqual(expect.arrayContaining([
        "PATCH /api/employees/:id", "POST /api/line/:lineUserId", "GET /api/people/:name", "PATCH /api/:segment/:segment/:segment/:id",
      ]));
      const employee = body.errors.find((error: { route: string }) => error.route === "PATCH /api/employees/:id");
      expect(employee.request_id).toBe(`ext-${createHash("sha256").update(externalId).digest("hex").slice(0, 12)}`);
      expect(employee.message).toContain("TypeError");
      expect(employee.message).toContain("500");
      const line = body.errors.find((error: { route: string }) => error.route === "POST /api/line/:lineUserId");
      expect(line.request_id).toMatch(/^ext-[0-9a-f]{12}$/);
      expect(body.errors.find((error: { route: string }) => error.route === "GET /api/people/:name").request_id).toBe(UUID);
    });
  });

  it("does not treat an arbitrary Error-shaped PII prefix as a safe error kind", async () => {
    const unsafeKind = "FixtureEmployeeAliceError";
    stored([row(1, { message: `${unsafeKind}: sensitive text` })]);
    await withApp(async (base) => {
      const res = await fetch(`${base}/api/health/errors`, { headers: TOKEN });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(JSON.stringify(body)).not.toContain(unsafeKind);
      expect(body.errors[0].message).toContain("500");
    });
  });

  it("marks a 1001-row result truncated while counting only the 1000 exported source rows", async () => {
    stored(Array.from({ length: 1001 }, (_, i) => row(i + 1, { occurredAt: new Date(Date.parse(NOW) - i * 1000) })));
    await withApp(async (base) => {
      const res = await fetch(`${base}/api/health/errors`, { headers: TOKEN });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.truncated).toBe(true);
      expect(body.errors).toHaveLength(1);
      expect(body.errors[0].count).toBe(1000);
      expect(Date.parse(body.errors[0].first_seen)).toBe(Date.parse(NOW) - 999_000);
    });
  });

  it("does not mark exactly 1000 source rows truncated", async () => {
    stored(Array.from({ length: 1000 }, (_, i) => row(i + 1)));
    await withApp(async (base) => {
      const res = await fetch(`${base}/api/health/errors`, { headers: TOKEN });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.truncated).toBe(false);
      expect(body.errors[0].count).toBe(1000);
    });
  });

  it("returns an empty list with retainedSince equal to since when the table is empty", async () => {
    vi.stubEnv("HEALTH_BUILD_LABEL", "");
    vi.stubEnv("REPLIT_DEPLOYMENT", "0");
    await withApp(async (base) => {
      const res = await fetch(`${base}/api/health/errors?${sinceQuery("2026-11-12T00:00:00Z")}`, { headers: TOKEN });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ build: "unknown", errors: [], truncated: false });
      expect(body.retainedSince).toBe(body.since);
    });
  });

  it("uses development and unknown build in non-production row fields", async () => {
    vi.stubEnv("HEALTH_BUILD_LABEL", "");
    vi.stubEnv("REPLIT_DEPLOYMENT", "0");
    stored([row(1)]);
    await withApp(async (base) => {
      const res = await fetch(`${base}/api/health/errors`, { headers: TOKEN });
      expect(res.status).toBe(200);
      expect((await res.json()).errors[0]).toMatchObject({ env: "development", release: "unknown" });
    });
  });

  it.each(["list", "oldest"])("returns a fixed non-cached 500 when %s lookup fails", async (failure) => {
    const error = new Error("database-fixture-user:fixture-password@private.invalid/name");
    if (failure === "list") listErrors.mockRejectedValue(error);
    else oldestOccurredAt.mockRejectedValue(error);
    await withApp(async (base) => {
      const res = await fetch(`${base}/api/health/errors`, { headers: TOKEN });
      expect(res.status).toBe(500);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ message: "無法讀取錯誤清單" });
    });
  });

  it("leaves an unregistered /api/health/zzz on the SPA fallback without exporting data", async () => {
    await withApp(async (base) => {
      const res = await fetch(`${base}/api/health/zzz`, { headers: TOKEN });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(await res.text()).toContain("SPA fallback");
      expect(listErrors).not.toHaveBeenCalled();
      expect(oldestOccurredAt).not.toHaveBeenCalled();
    });
  });
});
