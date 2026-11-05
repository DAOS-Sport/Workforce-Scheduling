import express from "express";
import { createServer } from "node:http";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchShifts, shiftAuditLog, shifts } from "@shared/schema";
import { db } from "../../infra/db";
import { LOCK_NS } from "../../infra/db/tx";
import { concurrently, createEmployee, createRegion, createShift as seedShift, createVenue, resetDatabase, warmPool } from "../../test/itest";
import { withFailingWrites } from "../../test/failWrites";
import { runWhileLockHeld } from "../../test/lock";
import { globalErrorHandler } from "../../shared/http/errorHandler";
import { shiftRepository } from "./shift.repository";
import { mountShiftRoutes } from "./shift.routes";
import {
  batchDeleteShiftIds,
  batchDeleteShifts,
  batchUpdateShifts,
  batchUpsertShifts,
  cancelShift,
  copyShiftsFromPreviousMonth,
  createShift,
  importShifts,
  restoreShift,
  shiftService,
  updateShift,
} from "./shift.service";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function world() {
  const region = await createRegion();
  const venue = await createVenue({ regionId: region.id });
  const employee = await createEmployee({ regionId: region.id });
  return { region, venue, employee };
}

const shiftsOf = (employeeId: number) => db.select().from(shifts).where(eq(shifts.employeeId, employeeId)).orderBy(shifts.id);
const shiftRow = async (id: number) => (await db.select().from(shifts).where(eq(shifts.id, id)))[0];
const auditActions = async (action: string) => (await db.select().from(shiftAuditLog).where(eq(shiftAuditLog.action, action))).length;
const dispatchCount = async () => (await db.select().from(dispatchShifts)).length;
const statuses = (results: PromiseSettledResult<unknown>[]) =>
  results.map((r) => (r.status === "fulfilled" ? "ok" : (r.reason as { status?: number }).status ?? "error"));

/** Every labor-rule read pauses after reading, so two requests that both read before either writes overlap on every run. */
function widen(method: "getShiftsByEmployee" | "getShiftsByEmployeeAndDateRange" | "getShiftsByEmployeesAndDateRange" | "getShiftsByRegionAndDateRange" | "getShift", ms = 100) {
  const read = shiftRepository[method] as (...args: unknown[]) => Promise<unknown>;
  vi.spyOn(shiftRepository, method).mockImplementation((async (...args: unknown[]) => {
    const rows = await read(...args);
    await sleep(ms);
    return rows;
  }) as never);
}

const eight = { startTime: "08:00", endTime: "16:00", role: "救生" };

beforeEach(async () => {
  await resetDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a shift and its audit row are written together", () => {
  it("create: when the audit insert fails the shift is not created either", async () => {
    const { venue, employee } = await world();

    await withFailingWrites("shift_audit_log", "insert", "true", async () => {
      await expect(createShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-03", ...eight }, "admin")).rejects.toThrow();
    });

    expect(await shiftsOf(employee.id)).toHaveLength(0);
  });

  it("update: when the audit insert fails the shift keeps its old time", async () => {
    const { venue, employee } = await world();
    const shift = await seedShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-03", startTime: "08:00", endTime: "12:00" });

    await withFailingWrites("shift_audit_log", "insert", "true", async () => {
      await expect(updateShift(shift.id, { endTime: "15:00" }, "admin")).rejects.toThrow();
    });

    expect((await shiftRow(shift.id)).endTime).toBe("12:00:00");
  });

  it("cancel: when the audit insert fails the shift stays active", async () => {
    const { venue, employee } = await world();
    const shift = await seedShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-03", startTime: "08:00", endTime: "12:00" });

    await withFailingWrites("shift_audit_log", "insert", "true", async () => {
      await expect(cancelShift(shift.id, "admin", "test")).rejects.toThrow();
    });

    expect((await shiftRow(shift.id)).status).toBe("active");
  });

  it("restore: when the audit insert fails the shift stays cancelled", async () => {
    const { venue, employee } = await world();
    const shift = await seedShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-03", startTime: "08:00", endTime: "12:00", status: "cancelled" } as never);

    await withFailingWrites("shift_audit_log", "insert", "true", async () => {
      await expect(restoreShift(shift.id, "admin")).rejects.toThrow();
    });

    expect((await shiftRow(shift.id)).status).toBe("cancelled");
  });
});

describe("callers without a transaction of their own still get the shift and audit row together", () => {
  it("an employee's certificate upload (updateShiftRecord): when the audit insert fails the shift is not changed", async () => {
    const { venue, employee } = await world();
    const shift = await seedShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-03", startTime: "08:00", endTime: "12:00" });

    await withFailingWrites("shift_audit_log", "insert", "true", async () => {
      await expect(shiftService.updateShiftRecord(shift.id, { certificateImageUrl: "https://example.invalid/a.png" }, "employee:1", true)).rejects.toThrow();
    });

    expect((await shiftRow(shift.id)).certificateImageUrl).toBeNull();
  });

  it("creating a shift record directly leaves no shift when the audit insert fails", async () => {
    const { venue, employee } = await world();

    await withFailingWrites("shift_audit_log", "insert", "true", async () => {
      await expect(shiftService.createShiftRecord({ employeeId: employee.id, venueId: venue.id, date: "2026-11-03", ...eight }, "system")).rejects.toThrow();
    });

    expect(await shiftsOf(employee.id)).toHaveLength(0);
  });

  it("cancelling a shift directly keeps it active when the audit insert fails", async () => {
    const { venue, employee } = await world();
    const shift = await seedShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-03", ...eight });

    await withFailingWrites("shift_audit_log", "insert", "true", async () => {
      await expect(shiftService.deleteShift(shift.id, "system", "test", true)).rejects.toThrow();
    });

    expect((await shiftRow(shift.id)).status).toBe("active");
  });
});

describe("labor-law checks run under the employee's lock", () => {
  it("two admins add 8 hours to the same employee on the same day: one is blocked by the 12-hour rule", async () => {
    const { venue, employee } = await world();
    widen("getShiftsByEmployee");
    await warmPool(4);

    const results = await concurrently(2, (i) =>
      createShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-03", startTime: i === 0 ? "08:00" : "09:00", endTime: i === 0 ? "16:00" : "17:00", role: "救生" }, `admin${i}`),
    );

    expect(statuses(results).sort()).toEqual([400, "ok"]);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.message).toContain("12小時");
    expect(await shiftsOf(employee.id)).toHaveLength(1);
  });

  it("two admins move two different shifts onto the same day for 8 hours each: one is blocked", async () => {
    const { venue, employee } = await world();
    const x = await seedShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-03", startTime: "08:00", endTime: "09:00" });
    const y = await seedShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-04", startTime: "08:00", endTime: "09:00" });
    widen("getShiftsByEmployee");
    await warmPool(4);

    const results = await concurrently(2, (i) =>
      updateShift(i === 0 ? x.id : y.id, { date: "2026-11-10", startTime: i === 0 ? "08:00" : "09:00", endTime: i === 0 ? "16:00" : "17:00" }, `admin${i}`),
    );

    expect(statuses(results).sort()).toEqual([400, "ok"]);
    expect((await shiftsOf(employee.id)).filter((s) => s.date === "2026-11-10")).toHaveLength(1);
  });

  it("two bulk schedules of the same employee over the same dates leave one shift per date", async () => {
    const { venue, employee } = await world();
    widen("getShiftsByEmployeeAndDateRange");
    await warmPool(4);

    await concurrently(2, (i) =>
      batchUpsertShifts(
        { employeeId: employee.id, venueId: venue.id, startTime: i === 0 ? "08:00" : "09:00", endTime: i === 0 ? "16:00" : "17:00", role: "救生", targetDates: ["2026-11-03", "2026-11-04"], force: true },
        `admin${i}`,
      ),
    );

    expect((await shiftsOf(employee.id)).map((s) => s.date)).toEqual(["2026-11-03", "2026-11-04"]);
  });

  it("two imports of the same employee-day leave one shift", async () => {
    const { venue, employee } = await world();
    widen("getShiftsByEmployeesAndDateRange");
    await warmPool(4);

    await concurrently(2, (i) =>
      importShifts({ shifts: [{ employeeId: employee.id, venueId: venue.id, date: "2026-11-03", startTime: i === 0 ? "08:00" : "09:00", endTime: i === 0 ? "12:00" : "13:00", role: "救生" }] }, `admin${i}`),
    );

    expect(await shiftsOf(employee.id)).toHaveLength(1);
  });

  const waitsForLock = async (employeeId: number, operation: () => Promise<unknown>) => {
    const { finishedWhileHeld, outcome } = await runWhileLockHeld(LOCK_NS.shiftLabor, employeeId, operation);
    expect(finishedWhileHeld).toBe(false);
    expect(outcome.status).toBe("fulfilled");
  };

  it("create, update, restore, bulk schedule, bulk update and import wait while the employee's lock is held", async () => {
    const { venue, employee } = await world();
    const existing = await seedShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-03", startTime: "08:00", endTime: "10:00" });
    const cancelled = await seedShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-05", startTime: "08:00", endTime: "10:00", status: "cancelled" } as never);

    await waitsForLock(employee.id, () => createShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-04", startTime: "08:00", endTime: "10:00", role: "救生" }, "admin"));
    await waitsForLock(employee.id, () => updateShift(existing.id, { endTime: "11:00" }, "admin"));
    await waitsForLock(employee.id, async () => {
      const restored = await restoreShift(cancelled.id, "admin");
      if (!restored) throw new Error("restore returned nothing");
    });
    await waitsForLock(employee.id, () =>
      batchUpsertShifts({ employeeId: employee.id, venueId: venue.id, startTime: "08:00", endTime: "10:00", role: "救生", targetDates: ["2026-11-06"] }, "admin"),
    );
    await waitsForLock(employee.id, () =>
      batchUpdateShifts({ currentShiftId: existing.id, employeeId: employee.id, targetDates: ["2026-11-07"], venueId: venue.id, startTime: "08:00", endTime: "10:00", role: "救生", force: true }, "admin"),
    );
    await waitsForLock(employee.id, () =>
      importShifts({ shifts: [{ employeeId: employee.id, venueId: venue.id, date: "2026-11-08", startTime: "08:00", endTime: "10:00", role: "救生" }] }, "admin"),
    );
    await waitsForLock(employee.id, () => batchDeleteShifts({ employeeId: employee.id, targetDates: ["2026-11-06"] }, "admin"));
    await waitsForLock(employee.id, () => batchDeleteShiftIds({ shiftIds: [existing.id] }, "admin"));
  });
});

describe("restore", () => {
  it("restoring a shift that would break the 12-hour rule is refused and the shift stays cancelled", async () => {
    const { venue, employee } = await world();
    await seedShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-03", ...eight });
    const cancelled = await seedShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-03", startTime: "09:00", endTime: "17:00", status: "cancelled" } as never);

    await expect(restoreShift(cancelled.id, "admin")).rejects.toMatchObject({ status: 400 });

    expect((await shiftRow(cancelled.id)).status).toBe("cancelled");
    expect(await auditActions("restore")).toBe(0);
  });

  it("a leave entry restores without the labor-law check", async () => {
    const { venue, employee } = await world();
    await seedShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-03", ...eight });
    const cancelled = await seedShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-03", startTime: "00:00", endTime: "00:00", role: "特休", status: "cancelled" } as never);

    const restored = await restoreShift(cancelled.id, "admin");

    expect(restored?.status).toBe("active");
  });

  it("two restores at once: one restores, the other finds nothing to restore, and only one audit row is written", async () => {
    const { venue, employee } = await world();
    const cancelled = await seedShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-03", ...eight, status: "cancelled" } as never);
    widen("getShift");
    await warmPool(4);

    const results = await concurrently(2, () => restoreShift(cancelled.id, "admin"));

    expect(results.map((r) => (r.status === "fulfilled" ? Boolean(r.value) : "error")).sort()).toEqual([false, true]);
    expect(await auditActions("restore")).toBe(1);
  });

  it("an active shift is not restored and gets no audit row", async () => {
    const { venue, employee } = await world();
    const active = await seedShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-03", ...eight });

    expect(await restoreShift(active.id, "admin")).toBeUndefined();
    expect(await auditActions("restore")).toBe(0);
  });
});

describe("batch operations are all or nothing", () => {
  it("cancel by conditions: a failure on the third shift leaves all three active", async () => {
    const { venue, employee } = await world();
    const rows: Awaited<ReturnType<typeof seedShift>>[] = [];
    for (const date of ["2026-11-03", "2026-11-04", "2026-11-05"]) rows.push(await seedShift({ employeeId: employee.id, venueId: venue.id, date, ...eight }));

    await withFailingWrites("shift_audit_log", "insert", `NEW.action = 'cancel' and NEW.shift_id = ${rows[2].id}`, async () => {
      await expect(batchDeleteShifts({ employeeId: employee.id, targetDates: ["2026-11-03", "2026-11-04", "2026-11-05"] }, "admin")).rejects.toThrow();
    });

    expect((await shiftsOf(employee.id)).map((s) => s.status)).toEqual(["active", "active", "active"]);
  });

  it("cancel by ids: a failure on the third shift leaves all three active", async () => {
    const { venue, employee } = await world();
    const rows: Awaited<ReturnType<typeof seedShift>>[] = [];
    for (const date of ["2026-11-03", "2026-11-04", "2026-11-05"]) rows.push(await seedShift({ employeeId: employee.id, venueId: venue.id, date, ...eight }));

    await withFailingWrites("shift_audit_log", "insert", `NEW.action = 'cancel' and NEW.shift_id = ${rows[2].id}`, async () => {
      await expect(batchDeleteShiftIds({ shiftIds: rows.map((r) => r.id) }, "admin")).rejects.toThrow();
    });

    expect((await shiftsOf(employee.id)).map((s) => s.status)).toEqual(["active", "active", "active"]);
  });

  it("bulk schedule: a failure on the third day leaves no day written", async () => {
    const { venue, employee } = await world();

    await withFailingWrites("shift_audit_log", "insert", `NEW.action = 'create' and NEW.payload #>> '{after,date}' = '2026-11-05'`, async () => {
      await expect(
        batchUpsertShifts({ employeeId: employee.id, venueId: venue.id, ...eight, targetDates: ["2026-11-03", "2026-11-04", "2026-11-05"] }, "admin"),
      ).rejects.toThrow();
    });

    expect(await shiftsOf(employee.id)).toHaveLength(0);
  });

  it("apply to several days: a failure on the third day leaves the current shift and the other days untouched", async () => {
    const { venue, employee } = await world();
    const current = await seedShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-02", startTime: "08:00", endTime: "10:00" });

    await withFailingWrites("shift_audit_log", "insert", `NEW.action = 'create' and NEW.payload #>> '{after,date}' = '2026-11-05'`, async () => {
      await expect(
        batchUpdateShifts(
          { currentShiftId: current.id, employeeId: employee.id, targetDates: ["2026-11-03", "2026-11-04", "2026-11-05"], venueId: venue.id, ...eight, force: true },
          "admin",
        ),
      ).rejects.toThrow();
    });

    expect((await shiftsOf(employee.id)).map((s) => [s.date, s.endTime])).toEqual([["2026-11-02", "10:00:00"]]);
  });

  it("apply to several days: the current shift is held to the same 12-hour rule as the other days", async () => {
    const { venue, employee } = await world();
    await seedShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-02", startTime: "06:00", endTime: "14:00" });
    const current = await seedShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-02", startTime: "15:00", endTime: "17:00" });

    const result: any = await batchUpdateShifts(
      { currentShiftId: current.id, employeeId: employee.id, targetDates: ["2026-11-03"], venueId: venue.id, startTime: "09:00", endTime: "17:00", role: "救生", force: true },
      "admin",
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("2026-11-02");
    expect((await shiftRow(current.id)).startTime).toBe("15:00:00");
    expect(result.updated).toBe(1);
  });

  it("bulk schedule sorts a day with two shifts the same way every time (overwrites the lowest id)", async () => {
    const { venue, employee } = await world();
    const first = await seedShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-03", startTime: "06:00", endTime: "08:00" });
    await seedShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-03", startTime: "10:00", endTime: "12:00" });

    await batchUpsertShifts({ employeeId: employee.id, venueId: venue.id, startTime: "13:00", endTime: "15:00", role: "救生", targetDates: ["2026-11-03"], force: true }, "admin");

    expect((await shiftRow(first.id)).startTime).toBe("13:00:00");
  });
});

describe("copy the previous month", () => {
  async function previousMonth() {
    const w = await world();
    const second = await createEmployee({ regionId: w.region.id });
    await seedShift({ employeeId: w.employee.id, venueId: w.venue.id, date: "2026-10-05", ...eight });
    await seedShift({ employeeId: w.employee.id, venueId: w.venue.id, date: "2026-10-06", ...eight });
    await seedShift({ employeeId: second.id, venueId: w.venue.id, date: "2026-10-07", ...eight });
    return { ...w, second };
  }
  const novemberCount = async (employeeIds: number[]) =>
    (await db.select().from(shifts)).filter((s) => employeeIds.includes(s.employeeId) && s.date.startsWith("2026-11")).length;

  it("pressing copy twice at once copies the month once", async () => {
    const { region, employee, second } = await previousMonth();
    widen("getShiftsByRegionAndDateRange");
    await warmPool(4);

    const results = await concurrently(2, () => copyShiftsFromPreviousMonth({ regionCode: region.code, targetYear: 2026, targetMonth: 11 }, "admin"));

    expect(statuses(results).sort()).toEqual([400, "ok"]);
    expect(await novemberCount([employee.id, second.id])).toBe(3);
  });

  it("a failure partway through copies nothing, and the copy can be run again afterwards", async () => {
    const { region, employee, second } = await previousMonth();

    await withFailingWrites("shift_audit_log", "insert", `NEW.action = 'create' and NEW.payload #>> '{after,date}' = '2026-11-07'`, async () => {
      await expect(copyShiftsFromPreviousMonth({ regionCode: region.code, targetYear: 2026, targetMonth: 11 }, "admin")).rejects.toThrow();
    });
    expect(await novemberCount([employee.id, second.id])).toBe(0);

    const retry: any = await copyShiftsFromPreviousMonth({ regionCode: region.code, targetYear: 2026, targetMonth: 11 }, "admin");
    expect(retry.created).toBe(3);
  });
});

describe("import shifts", () => {
  const longDay = (venueId: number, employeeId: number, date = "2026-11-03") => ({ employeeId, venueId, date, startTime: "07:00", endTime: "20:00", role: "救生" });

  it("importing the same month again does not add dispatch shifts", async () => {
    const { venue, employee } = await world();

    const first: any = await importShifts({ shifts: [longDay(venue.id, employee.id)] }, "admin");
    const second: any = await importShifts({ shifts: [longDay(venue.id, employee.id)] }, "admin");

    expect([first.dispatched.length, second.dispatched.length]).toEqual([1, 1]);
    expect(await dispatchCount()).toBe(1);
    expect(await shiftsOf(employee.id)).toHaveLength(0);
  });

  it("importing the shift an employee already has for that day replaces it instead of turning into a dispatch shift", async () => {
    const { venue, employee } = await world();
    const existing = await seedShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-03", ...eight });

    const result: any = await importShifts({ shifts: [{ employeeId: employee.id, venueId: venue.id, date: "2026-11-03", ...eight }] }, "admin");

    expect([result.created, result.dispatched.length, result.errors.length]).toEqual([1, 0, 0]);
    expect(await dispatchCount()).toBe(0);
    expect((await shiftsOf(employee.id)).map((s) => s.id)).toEqual([existing.id]);
  });

  it("with skipExisting an already scheduled day is skipped, not converted", async () => {
    const { venue, employee } = await world();
    await seedShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-03", ...eight });

    const result: any = await importShifts({ shifts: [{ employeeId: employee.id, venueId: venue.id, date: "2026-11-03", ...eight }], skipExisting: true }, "admin");

    expect([result.created, result.skipped, result.dispatched.length]).toEqual([0, 1, 0]);
    expect(await dispatchCount()).toBe(0);
  });

  it("a failure on the last row writes no shift and no dispatch shift", async () => {
    const { venue, employee } = await world();

    await withFailingWrites("shift_audit_log", "insert", `NEW.action = 'create' and NEW.payload #>> '{after,date}' = '2026-11-05'`, async () => {
      await expect(
        importShifts(
          {
            shifts: [
              longDay(venue.id, employee.id, "2026-11-03"),
              { employeeId: employee.id, venueId: venue.id, date: "2026-11-04", ...eight },
              { employeeId: employee.id, venueId: venue.id, date: "2026-11-05", ...eight },
            ],
          },
          "admin",
        ),
      ).rejects.toThrow();
    });

    expect(await shiftsOf(employee.id)).toHaveLength(0);
    expect(await dispatchCount()).toBe(0);
  });
});

describe("dispatch shifts keep their identity", () => {
  it("a created dispatch conversion is not linked by name here (that is reconcile's job)", async () => {
    const { venue, employee } = await world();
    await importShifts({ shifts: [{ employeeId: employee.id, venueId: venue.id, date: "2026-11-03", startTime: "07:00", endTime: "20:00", role: "救生" }] }, "admin");

    const rows = await db.select().from(dispatchShifts).where(and(eq(dispatchShifts.dispatchName, employee.name)));
    expect(rows).toHaveLength(1);
    expect(rows[0].linkedEmployeeId).toBeNull();
  });
});

describe("the routes report what the service decided", () => {
  async function send(method: string, path: string, body?: object) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).session = { adminId: 1, adminName: "tester" };
      next();
    });
    mountShiftRoutes(app);
    app.use(globalErrorHandler);
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const res = await fetch("http://127.0.0.1:" + (server.address() as { port: number }).port + path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, body: await res.json() };
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it("a PATCH with nothing to change answers 400 and leaves the shift and its audit trail alone", async () => {
    const { venue, employee } = await world();
    const shift = await seedShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-03", ...eight });
    const auditBefore = await db.select().from(shiftAuditLog).where(eq(shiftAuditLog.shiftId, shift.id));

    const res = await send("PATCH", "/api/shifts/" + shift.id, {});

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("沒有要更新的欄位");
    expect(await db.select().from(shiftAuditLog).where(eq(shiftAuditLog.shiftId, shift.id))).toHaveLength(auditBefore.length);
  });

  it("restoring a shift that would break the 12-hour rule answers 400 with the rule's message", async () => {
    const { venue, employee } = await world();
    await seedShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-03", ...eight });
    const cancelled = await seedShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-03", startTime: "09:00", endTime: "17:00", status: "cancelled" } as never);

    const res = await send("POST", "/api/shifts/" + cancelled.id + "/restore");

    expect(res.status).toBe(400);
    expect(res.body.message).toContain("12小時");
  });

  it("creating a shift whose audit row cannot be written answers 500 and does not hand the database message to the client", async () => {
    const { venue, employee } = await world();

    const res = await withFailingWrites("shift_audit_log", "insert", "true", () =>
      send("POST", "/api/shifts", { employeeId: employee.id, venueId: venue.id, date: "2026-11-03", ...eight }),
    );

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("forced write failure");
    expect(await shiftsOf(employee.id)).toHaveLength(0);
  });

  it("updating a shift whose audit row cannot be written answers 500 and does not hand the database message to the client", async () => {
    const { venue, employee } = await world();
    const shift = await seedShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-03", startTime: "08:00", endTime: "12:00" });

    const res = await withFailingWrites("shift_audit_log", "insert", "true", () => send("PATCH", "/api/shifts/" + shift.id, { endTime: "15:00" }));

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("forced write failure");
    expect((await shiftRow(shift.id)).endTime).toBe("12:00:00");
  });

  it("a batch whose audit row cannot be written answers 500 and does not hand the database message to the client", async () => {
    const { venue, employee } = await world();

    const res = await withFailingWrites("shift_audit_log", "insert", "true", () =>
      send("POST", "/api/shifts/batch", { employeeId: employee.id, venueId: venue.id, ...eight, targetDates: ["2026-11-03"] }),
    );

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("forced write failure");
    expect(await shiftsOf(employee.id)).toHaveLength(0);
  });

  it("a batch over an existing shift without force is still refused with 400 and the protection message", async () => {
    const { venue, employee } = await world();
    await seedShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-03", startTime: "08:00", endTime: "12:00" });

    const res = await send("POST", "/api/shifts/batch", { employeeId: employee.id, venueId: venue.id, ...eight, targetDates: ["2026-11-03"] });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain("force=true");
  });

  it("cancelling a shift whose audit row cannot be written answers 500 and the shift stays active", async () => {
    const { venue, employee } = await world();
    const shift = await seedShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-03", ...eight });

    const res = await withFailingWrites("shift_audit_log", "insert", "true", () => send("DELETE", "/api/shifts/" + shift.id));

    expect(res.status).toBe(500);
    expect((await shiftRow(shift.id)).status).toBe("active");
  });
});
