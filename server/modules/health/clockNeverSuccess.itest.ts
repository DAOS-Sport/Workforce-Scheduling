import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clockRecords, type InsertEmployee, type InsertShift } from "@shared/schema";
import { db, pool } from "../../infra/db";
import { taipeiInstant } from "../../core/time/taipei";
import { createEmployee, createRegion, createShift, createVenue, resetDatabase } from "../../test/itest";
import * as service from "./health.service";

const NOW = taipeiInstant("2026-11-11", 12 * 60);
const originalTZ = process.env.TZ;
let regionId: number;
let venueId: number;

async function employee(dates: string[], overrides: Partial<InsertEmployee> = {}, shift: Partial<InsertShift> = {}) {
  const e = await createEmployee({ regionId, lineId: "synthetic-line", ...overrides });
  for (const date of dates) await createShift({ employeeId: e.id, venueId, date, startTime: "09:00", endTime: "18:00", ...shift });
  return e;
}

async function clock(employeeId: number, date: string, minutes: number, status = "success", clockType = "in") {
  await db.insert(clockRecords).values({ employeeId, latitude: 25, longitude: 121, status, clockType, clockTime: taipeiInstant(date, minutes) });
}

afterEach(() => { process.env.TZ = originalTZ; vi.restoreAllMocks(); });

describe.each(["UTC", "Asia/Taipei"])("clock never-success SQL with TZ=%s", (zone) => {
  beforeEach(async () => {
    process.env.TZ = zone;
    await resetDatabase();
    regionId = (await createRegion()).id;
    venueId = (await createVenue({ regionId })).id;
  });

  it("exposes the new readonly reader", () => {
    expect(service).toHaveProperty("readClockNeverSuccessEmployees", expect.any(Function));
  });

  it("compares both snapshots: new third shift is red even with persistent and below-threshold people", async () => {
    const fresh = await employee(["2026-11-09", "2026-11-10", "2026-11-11"]);
    const old = await employee(["2026-11-06", "2026-11-07", "2026-11-08"]);
    const below = await employee(["2026-10-29"]);
    const rows = await service.readClockNeverSuccessEmployees(NOW);
    expect(rows).toEqual([
      { id: fresh.id, name: fresh.name, shiftCount7Days: 3, shiftCount14Days: 3, lastAttemptAt: null },
      { id: old.id, name: old.name, shiftCount7Days: 3, shiftCount14Days: 3, lastAttemptAt: null },
      { id: below.id, name: below.name, shiftCount7Days: 0, shiftCount14Days: 1, lastAttemptAt: null },
    ]);
    const signals = await service.collectSignals(NOW);
    expect(signals.clockNeverSuccess).toEqual({ affectedEmployees: 3, newlyQualifiedEmployees: 1 });
    const report = await service.buildHealthReport(NOW);
    expect(report.pipelines.find(p => p.id === "clock.never-success")?.level).toBe("red");
    for (const e of [fresh, old, below]) expect(JSON.stringify(report)).not.toContain(e.name);
    expect(report.pipelines.find(p => p.id === "clock.never-success")).not.toHaveProperty("employees");
  });

  it("an already-qualified person stays yellow, with no stored watchdog state", async () => {
    await employee(["2026-11-06", "2026-11-07", "2026-11-08"]);
    const before = await pool.query("select count(*)::int as n from system_configs");
    expect((await service.collectSignals(NOW)).clockNeverSuccess).toEqual({ affectedEmployees: 1, newlyQualifiedEmployees: 0 });
    expect((await service.buildHealthReport(NOW)).pipelines.find(p => p.id === "clock.never-success")?.level).toBe("yellow");
    expect((await pool.query("select count(*)::int as n from system_configs")).rows).toEqual(before.rows);
  });

  it("excludes inactive/unbound employees, leave, dispatch, cancelled and unstarted shifts", async () => {
    await employee(["2026-11-11"], { status: "resigned" });
    for (const lineId of [null, "", "  "]) await employee(["2026-11-11"], { lineId });
    for (const role of ["休假", "特休", "病假", "事假", "喪假", "公假", "生理假", "國定假"]) await employee(["2026-11-11"], {}, { role });
    await employee(["2026-11-11"], {}, { isDispatch: true });
    const cancelled = await employee(["2026-11-11"]);
    await pool.query("update shifts set status = 'cancelled' where employee_id = $1", [cancelled.id]);
    await employee(["2026-11-11"], {}, { startTime: "12:01" });
    await employee(["2026-11-12"]);
    await employee(["2026-10-28"]);
    expect(await service.readClockNeverSuccessEmployees(NOW)).toEqual([]);
    expect((await service.buildHealthReport(NOW)).pipelines.find(p => p.id === "clock.never-success")?.level).toBe("green");
  });

  it("uses inclusive Taipei date windows and the actual start instant without a 30 minute delay", async () => {
    const e = await employee(["2026-10-29", "2026-11-04", "2026-11-05"]);
    await createShift({ employeeId: e.id, venueId, date: "2026-11-11", startTime: "12:00", endTime: "18:00", isDispatch: null });
    expect(await service.readClockNeverSuccessEmployees(NOW)).toEqual([
      { id: e.id, name: e.name, shiftCount7Days: 2, shiftCount14Days: 4, lastAttemptAt: null },
    ]);
  });

  it("counts success and warning clock-ins across the Taipei midnight boundary; ignores future records", async () => {
    for (const status of ["success", "warning"]) {
      const e = await employee(["2026-11-11"]);
      await clock(e.id, "2026-10-29", 0, status);
    }
    const oldSuccess = await employee(["2026-11-11"]);
    await clock(oldSuccess.id, "2026-10-28", 1439);
    const future = await employee(["2026-11-11"]);
    await clock(future.id, "2026-11-11", 12 * 60 + 1);
    expect((await service.readClockNeverSuccessEmployees(NOW)).map(e => [e.id, e.lastAttemptAt])).toEqual([
      [oldSuccess.id, "2026-10-28T15:59:00.000Z"], [future.id, null],
    ]);
  });

  it("returns the latest attempt of any status/type as UTC, including attempts before the window", async () => {
    const e = await employee(["2026-11-11"]);
    await clock(e.id, "2026-11-10", 10 * 60, "fail");
    await clock(e.id, "2026-11-11", 8 * 60, "warning", "out");
    const older = await employee(["2026-11-11"]);
    await clock(older.id, "2026-10-01", 10 * 60, "fail");
    expect((await service.readClockNeverSuccessEmployees(NOW)).map(e => e.lastAttemptAt)).toEqual([
      "2026-11-11T00:00:00.000Z", "2026-10-01T02:00:00.000Z",
    ]);
  });

  it("does not invent a new crossing when an old success ages out of the 14-day candidate window", async () => {
    const e = await employee(["2026-11-06", "2026-11-07", "2026-11-08"]);
    await clock(e.id, "2026-10-28", 10 * 60);
    expect((await service.collectSignals(NOW)).clockNeverSuccess).toEqual({ affectedEmployees: 1, newlyQualifiedEmployees: 0 });
  });

  it("a success or warning in days 8–14 excludes even someone with three recent shifts from the signal", async () => {
    for (const status of ["success", "warning"]) {
      const e = await employee(["2026-11-09", "2026-11-10", "2026-11-11"]);
      await clock(e.id, "2026-11-01", 10 * 60, status);
    }
    expect((await service.collectSignals(NOW)).clockNeverSuccess).toEqual({ affectedEmployees: 0, newlyQualifiedEmployees: 0 });
    expect((await service.buildHealthReport(NOW)).pipelines.find(p => p.id === "clock.never-success")?.level).toBe("green");
  });

  it("three shifts within 14 days but only one within 7 days stay yellow", async () => {
    await employee(["2026-10-30", "2026-11-01", "2026-11-11"]);
    expect((await service.collectSignals(NOW)).clockNeverSuccess).toEqual({ affectedEmployees: 1, newlyQualifiedEmployees: 0 });
    expect((await service.buildHealthReport(NOW)).pipelines.find(p => p.id === "clock.never-success")?.level).toBe("yellow");
  });
  it("uses the 24-hour snapshot cutoff and its own 7-day window at the exact boundary", async () => {
    await employee(["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-11"]);
    await employee(["2026-11-08", "2026-11-09", "2026-11-10"], {}, { startTime: "12:00" });
    const fresh = await employee(["2026-11-08", "2026-11-09", "2026-11-10"], {}, { startTime: "12:01" });
    expect((await service.collectSignals(NOW)).clockNeverSuccess).toEqual({ affectedEmployees: 3, newlyQualifiedEmployees: 1 });
    expect((await service.readClockNeverSuccessEmployees(NOW)).find(e => e.id === fresh.id)?.shiftCount7Days).toBe(3);
  });

  it("isolates an unreadable watchdog through attempt/ReadError and does not leak the query error", async () => {
    const execute = db.execute.bind(db);
    vi.spyOn(db, "execute").mockImplementation(((query: any) => {
      const text = query.toQuery({ casing: { getColumnCasing: (c: any) => c.name }, escapeName: (s: string) => s, escapeParam: (n: number) => `$${n + 1}`, escapeString: (s: string) => `'${s}'` }).sql;
      if (text.includes("never_success")) return Promise.reject(new Error("synthetic private detail"));
      return execute(query);
    }) as typeof db.execute);
    const report = await service.buildHealthReport(NOW);
    const p = report.pipelines.find(p => p.id === "clock.never-success");
    expect(p?.level).toBe("red");
    expect(p?.reason).not.toContain("synthetic private detail");
    expect(report.pipelines.find(p => p.id === "clock.coverage")?.level).toBe("green");
  });
});
