import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appErrors } from "@shared/schema";
import { buildApp } from "../../bootstrap/app";
import { db } from "../../infra/db";
import { withFailingWrites } from "../../test/failWrites";
import { resetDatabase } from "../../test/itest";
import { settleErrorWrites } from "../errors/errors.service";
import { buildHealthReport } from "./health.service";

const endpoint = "/api/admin/schedule-save-events";
const savePath = "/api/admin/schedule-assignments";
const adminPassword = "itest-schedule-watchdog";
const now = new Date("2026-11-11T04:00:00Z");
const hour = 3_600_000;
const servers: Server[] = [];

async function boot() {
  const { app } = await buildApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let cookie = "";
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, requestId: res.headers.get("x-request-id"), res };
  };
  const login = async () => {
    const response = await call("POST", "/api/admin/login", { password: adminPassword });
    expect(response.status).toBe(200);
    cookie = (response.res.headers.getSetCookie()[0] ?? "").split(";")[0];
  };
  return { call, login };
}

beforeEach(async () => {
  await resetDatabase();
  process.env.ADMIN_PASSWORD = adminPassword;
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  await settleErrorWrites();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
  delete process.env.ADMIN_PASSWORD;
  vi.restoreAllMocks();
});

describe("schedule save browser events over real HTTP", () => {
  it.each([["save_failed", "red"], ["readback_mismatch", "red"], ["unsaved_exit", "yellow"]])("records %s with only fixed metadata and health reads %s", async (event, level) => {
    const app = await boot();
    await app.login();
    const response = await app.call("POST", endpoint, { event });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    await settleErrorWrites();
    const rows = await db.select().from(appErrors).where(eq(appErrors.requestId, response.requestId!));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ method: "POST", path: endpoint, status: 0, message: `schedule.save: ${event}`, stack: null, subject: { pipeline: "schedule.save", event } });
    expect(Object.keys(rows[0].subject!).sort()).toEqual(["event", "pipeline"]);
    const health = await app.call("GET", "/api/admin/health");
    expect(health.status).toBe(200);
    expect(health.body.pipelines.find((p: { id: string }) => p.id === "schedule.save")).toMatchObject({ name: "排班儲存", level, source: "app_errors" });
  });

  it("requires an administrator and writes no event when unauthorized", async () => {
    const app = await boot();
    expect((await app.call("POST", endpoint, { event: "save_failed" })).status).toBe(401);
    await settleErrorWrites();
    expect(await db.select().from(appErrors)).toEqual([]);
  });

  it("rejects unknown events and any extra field instead of storing user data", async () => {
    const app = await boot();
    await app.login();
    for (const body of [{}, { event: "unknown" }, { event: "save_failed", name: "sentinel-name" }, { event: "unsaved_exit", note: "sentinel-note" }, ["save_failed"]]) {
      expect((await app.call("POST", endpoint, body)).status).toBe(400);
    }
    await settleErrorWrites();
    expect(await db.select().from(appErrors)).toEqual([]);
  });

  it("the existing save POST 500 is recorded by the real global error gate and turns health red", async () => {
    const app = await boot();
    await app.login();
    const response = await withFailingWrites("summer_schedule_assignments", "insert", "true", () =>
      app.call("POST", savePath, { weekNo: 1, rawEntries: [], assignments: [], shifts: [] }));
    expect(response.status).toBe(500);
    await settleErrorWrites();
    const rows = await db.select().from(appErrors).where(eq(appErrors.requestId, response.requestId!));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ method: "POST", path: savePath, status: 500 });
    const health = await app.call("GET", "/api/admin/health");
    expect(health.body.pipelines.find((p: { id: string }) => p.id === "schedule.save").level).toBe("red");
  });

  it("saving and overwriting a draft roundtrips all three arrays through real HTTP", async () => {
    const app = await boot();
    await app.login();
    const content = (n: number) => ({
      weekNo: 1,
      rawEntries: [{ key: `course-${n}`, value: `測試班次${n}`, employees: [{ employeeId: n, employeeName: `測試員工${n}` }] }],
      assignments: [{ key: `course-${n}`, employeeId: n, role: "教練" }],
      shifts: [{ employeeId: n, venueId: n, date: "2026-07-01", startTime: "09:00", endTime: "12:00", role: "教練", notes: `測試${n}` }],
    });
    let expectedUpdatedAt: string | null = null;
    for (const n of [1, 2]) {
      const payload = content(n);
      const saved = await app.call("POST", savePath, { ...payload, expectedUpdatedAt });
      expect(saved.status).toBe(200);
      const read = await app.call("GET", `${savePath}?weekNo=1`);
      expect(read.status).toBe(200);
      expect(read.body).toMatchObject({ ...payload, version: "v40", updatedAt: saved.body.updatedAt });
      expectedUpdatedAt = saved.body.updatedAt;
    }
  });
});

describe("schedule save SQL time window and filters", () => {
  it.each([[hour, "red"], [hour + 1, "yellow"], [24 * hour, "yellow"], [24 * hour + 1, "green"]])("a save 5xx %i ms ago is %s", async (age, level) => {
    await db.insert(appErrors).values({ requestId: "save-api-failure", method: "POST", path: savePath, status: 503, message: "fixed failure", occurredAt: new Date(now.getTime() - Number(age)) });
    const report = await buildHealthReport(now);
    expect(report.pipelines.find((p) => p.id === "schedule.save")?.level).toBe(level);
  });

  it("does not count 4xx, other methods/paths, old events, or future rows", async () => {
    const row = { requestId: "ignored", method: "POST", path: savePath, status: 500, message: "fixed", occurredAt: now };
    await db.insert(appErrors).values([
      { ...row, status: 409 },
      { ...row, method: "GET" },
      { ...row, path: "/api/admin/summer-schedule/publish-shifts" },
      { ...row, occurredAt: new Date(now.getTime() + 1) },
      { ...row, path: endpoint, status: 0, subject: { pipeline: "schedule.save", event: "save_failed" }, occurredAt: new Date(now.getTime() - 24 * hour - 1) },
      { ...row, path: endpoint, status: 0, subject: { pipeline: "schedule.other", event: "save_failed" } },
    ]);
    const report = await buildHealthReport(now);
    expect(report.pipelines.find((p) => p.id === "schedule.save")?.level).toBe("green");
  });
});
