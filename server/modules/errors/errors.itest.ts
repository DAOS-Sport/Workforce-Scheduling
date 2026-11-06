import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appErrors } from "@shared/schema";
import { buildApp, createApp } from "../../bootstrap/app";
import { db } from "../../infra/db";
import { withFailingWrites } from "../../test/failWrites";
import { log } from "../../shared/log";
import { createEmployee, createRegion, createShift, createVenue, resetDatabase } from "../../test/itest";
import { LAT, LNG, employeeOnShiftNow, lineUserId } from "../../test/clock";
import { purgeOldErrors, settleErrorWrites } from "./errors.service";

const ADMIN_PASSWORD = "itest-admin-password";
const eight = { startTime: "08:00", endTime: "16:00", role: "救生" };

let servers: Server[] = [];
let logged: string[] = [];

type App = Awaited<ReturnType<typeof boot>>;

async function boot() {
  const { app } = await buildApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let cookie = "";
  const call = async (method: string, path: string, body?: object, headers: Record<string, string> = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, requestId: res.headers.get("x-request-id") ?? "", body: text ? JSON.parse(text) : null, res };
  };
  const login = async () => {
    const res = await call("POST", "/api/admin/login", { password: ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    cookie = (res.res.headers.getSetCookie()[0] ?? "").split(";")[0];
  };
  const stop = async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    servers = servers.filter((s) => s !== server);
  };
  return { call, login, stop };
}

async function world() {
  const region = await createRegion();
  const venue = await createVenue({ regionId: region.id });
  const employee = await createEmployee({ regionId: region.id });
  return { venue, employee };
}

beforeEach(async () => {
  await resetDatabase();
  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
  logged = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => void logged.push(String(line)));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.ADMIN_PASSWORD;
  await Promise.all(
    servers.map(
      (s) =>
        new Promise<void>((resolve) => {
          s.closeAllConnections();
          s.close(() => resolve());
        }),
    ),
  );
  servers = [];
});

/** A real server error: the audit insert of a shift create fails inside the database. */
async function triggerServerError(call: App["call"], extraBody: object = {}, headers: Record<string, string> = {}) {
  const { venue, employee } = await world();
  const res = await withFailingWrites("shift_audit_log", "insert", "true", () =>
    call("POST", "/api/shifts?token=query-secret", { employeeId: employee.id, venueId: venue.id, date: "2026-11-03", ...eight, ...extraBody }, headers),
  );
  await settleErrorWrites();
  return res;
}

describe("a server error leaves a row that its request id finds", () => {
  it("answers 500 with a generic message and the request id, and one row holds what went wrong", async () => {
    const app = await boot();
    await app.login();

    const res = await triggerServerError(app.call);

    expect(res.status).toBe(500);
    expect(res.requestId).toMatch(/^[A-Za-z0-9._-]{8,64}$/);
    expect(res.body.requestId).toBe(res.requestId);
    expect(JSON.stringify(res.body)).not.toContain("forced write failure");

    const rows = await db.select().from(appErrors).where(eq(appErrors.requestId, res.requestId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ method: "POST", path: "/api/shifts", status: 500 });
    expect(rows[0].message).toContain("forced write failure");
    expect(rows[0].occurredAt).toBeInstanceOf(Date);
  });

  it("uses the id the caller sent when it is well formed", async () => {
    const app = await boot();
    await app.login();

    const res = await triggerServerError(app.call, {}, { "X-Request-Id": "trace-from-the-browser-1" });

    expect(res.requestId).toBe("trace-from-the-browser-1");
    expect(await db.select().from(appErrors).where(eq(appErrors.requestId, "trace-from-the-browser-1"))).toHaveLength(1);
  });

  it("is still found by GET /api/admin/errors after the app is built again", async () => {
    const first = await boot();
    await first.login();
    const failed = await triggerServerError(first.call);
    await first.stop();

    const second = await boot();
    await second.login();
    const found = await second.call("GET", `/api/admin/errors?requestId=${encodeURIComponent(failed.requestId)}`);

    expect(found.status).toBe(200);
    expect(found.body.items).toHaveLength(1);
    expect(found.body.items[0]).toMatchObject({ requestId: failed.requestId, method: "POST", path: "/api/shifts", status: 500 });
    expect(Object.keys(found.body.items[0]).sort()).toEqual(["id", "message", "method", "occurredAt", "path", "requestId", "stack", "status", "subject"]);
    expect(new Date(found.body.items[0].occurredAt).getTime()).not.toBeNaN();
  });

  it("filters by time and rejects a time it cannot read", async () => {
    const app = await boot();
    await app.login();
    await triggerServerError(app.call);

    const past = await app.call("GET", "/api/admin/errors?since=2020-01-01T00:00:00%2B08:00");
    const future = await app.call("GET", "/api/admin/errors?since=2999-01-01T00:00:00Z");
    const bad = await app.call("GET", "/api/admin/errors?since=yesterday");

    expect(past.body.items).toHaveLength(1);
    expect(future.body.items).toEqual([]);
    expect(bad.status).toBe(400);
  });

  it("is only for a signed-in administrator", async () => {
    const app = await boot();
    const res = await app.call("GET", "/api/admin/errors");
    expect(res.status).toBe(401);
  });
});

describe("the record names the business record it was about", () => {
  it("a clock-in that fails inside the database records the employee", async () => {
    const app = await boot();
    const { employee } = await employeeOnShiftNow({ lineId: lineUserId(3) });

    const res = await withFailingWrites("clock_records", "insert", "true", () =>
      app.call("POST", "/api/liff/clock-in", { lineUserId: lineUserId(3), latitude: LAT, longitude: LNG, accuracy: 5, requestId: "clock-try-1" }),
    );
    await settleErrorWrites();

    expect(res.status).toBe(500);
    const rows = await db.select().from(appErrors).where(eq(appErrors.requestId, res.requestId));
    expect(rows).toHaveLength(1);
    expect(rows[0].subject).toEqual({ employeeId: employee.id });
  });

  it("a route whose error reaches the error handler records the ids in its path", async () => {
    const app = await boot();
    await app.login();
    const { venue, employee } = await world();
    const shift = await createShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-03", ...eight });

    const res = await withFailingWrites("shift_audit_log", "insert", "true", () => app.call("PATCH", `/api/shifts/${shift.id}`, { notes: "改備註" }));
    await settleErrorWrites();

    expect(res.status).toBe(500);
    const rows = await db.select().from(appErrors).where(eq(appErrors.requestId, res.requestId));
    expect(rows[0].subject).toEqual({ id: String(shift.id) });
  });

  it("a route that names no record leaves the subject empty", async () => {
    const app = await boot();
    await app.login();

    const res = await triggerServerError(app.call);

    const rows = await db.select().from(appErrors).where(eq(appErrors.requestId, res.requestId));
    expect(rows[0].subject).toBeNull();
  });
});

describe("old records are deleted after the retention period", () => {
  it("deletes records older than 90 days and keeps the rest", async () => {
    const now = new Date("2026-11-06T04:00:00Z");
    const day = 86_400_000;
    const row = (requestId: string, ageDays: number) => ({
      requestId,
      method: "GET",
      path: "/api/x",
      status: 500,
      message: "boom",
      occurredAt: new Date(now.getTime() - ageDays * day),
    });
    await db.insert(appErrors).values([row("too-old", 91), row("just-kept", 89), row("today", 0)]);

    expect(await purgeOldErrors(now)).toEqual({ deleted: 1 });
    expect((await db.select().from(appErrors)).map((r) => r.requestId).sort()).toEqual(["just-kept", "today"]);
    expect(await purgeOldErrors(now)).toEqual({ deleted: 0 });
  });
});

describe("what is not recorded", () => {
  it("a 4xx answer leaves no row but still carries the request id", async () => {
    const app = await boot();
    await app.login();

    const res = await app.call("POST", "/api/shifts", { employeeId: 1 });
    await settleErrorWrites();

    expect(res.status).toBe(400);
    expect(res.requestId).toMatch(/^[A-Za-z0-9._-]{8,64}$/);
    expect(res.body.requestId).toBeUndefined();
    expect(await db.select().from(appErrors)).toHaveLength(0);
  });

  it("no part of the request body or query string reaches the table", async () => {
    const app = await boot();
    await app.login();

    await triggerServerError(app.call, { password: "sentinel-password-4711", note: "sentinel-note-4711" });

    const rows = await db.select().from(appErrors);
    expect(rows).toHaveLength(1);
    const everything = JSON.stringify(rows);
    expect(everything).not.toContain("sentinel-password-4711");
    expect(everything).not.toContain("sentinel-note-4711");
    expect(everything).not.toContain("query-secret");
    expect(everything).not.toContain(ADMIN_PASSWORD);
  });
});

describe("the log follows one request", () => {
  it("the access line and the error line both carry the request id, with a date and a zone offset", async () => {
    const app = await boot();
    await app.login();

    const res = await triggerServerError(app.call);

    const mine = logged.filter((line) => line.includes(`[${res.requestId}]`));
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(mine.some((line) => /POST \/api\/shifts 500 in \d+ms/.test(line))).toBe(true);
    expect(mine.some((line) => line.includes("forced write failure"))).toBe(true);
    for (const line of mine) expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2} /);
  });

  it("a line logged inside a handler, after the body parser and a session read from the store, carries the request id", async () => {
    const app = await createApp();
    app.post("/api/probe-session", (req, res) => {
      req.session.adminId = 1;
      req.session.save(() => res.json({ ok: true }));
    });
    app.post("/api/probe", (_req, res) => {
      log("inside the handler", "probe");
      res.json({ ok: true });
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    servers.push(server);

    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const opened = await fetch(base + "/api/probe-session", { method: "POST" });
    const cookie = (opened.headers.getSetCookie()[0] ?? "").split(";")[0];
    expect(cookie).toContain("=");

    const res = await fetch(base + "/api/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ hello: "world" }),
    });

    const id = res.headers.get("x-request-id");
    expect(id).toBeTruthy();
    expect(logged.some((line) => line.endsWith(`[probe] [${id}] inside the handler`))).toBe(true);
  });
});
