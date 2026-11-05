import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clockRecords, overtimeRequests } from "@shared/schema";
import { db } from "../../infra/db";
import { taipeiInstant } from "../../core/time/taipei";
import { concurrently, createEmployee, createRegion, createShift, createVenue, resetDatabase, warmPool } from "../../test/itest";
import { overtimeService } from "../overtime/overtime.service";
import { clockService } from "./clock.service";

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** An employee with one shift, and a successful clock-out for it at `outDate outTime` Taipei time. */
async function clockOutAfter(shift: { date: string; startTime: string; endTime: string }, outDate: string, outTime: string) {
  const region = await createRegion();
  const venue = await createVenue({ regionId: region.id });
  const employee = await createEmployee({ regionId: region.id });
  const row = await createShift({ employeeId: employee.id, venueId: venue.id, ...shift });
  const [record] = await db
    .insert(clockRecords)
    .values({
      employeeId: employee.id,
      venueId: venue.id,
      shiftId: row.id,
      clockType: "out",
      latitude: 25,
      longitude: 121.5,
      status: "success",
      clockTime: taipeiInstant(outDate, minutesOf(outTime)),
    })
    .returning();
  return { employee, shift: row, record };
}

const overtimeFor = (clockRecordId: number) => db.select().from(overtimeRequests).where(eq(overtimeRequests.clockRecordId, clockRecordId));

beforeEach(async () => {
  await resetDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("filling 加班 as the late-departure reason (T10)", () => {
  it("creates one pending overtime request from the shift end to the clock-out", async () => {
    const { record, shift } = await clockOutAfter({ date: "2026-07-06", startTime: "09:00", endTime: "18:00" }, "2026-07-06", "19:30");

    const result = await clockService.updateRecordReason(record.id, undefined, "加班");

    const rows = await overtimeFor(record.id);
    expect(rows.map((r) => [r.date, r.startTime, r.endTime, r.status, r.source])).toEqual([["2026-07-06", shift.endTime, "19:30", "pending", "clock_triggered"]]);
    expect(result.overtimeRequest?.id).toBe(rows[0].id);
  });

  it("filled twice at the same moment for one clock-out, makes one overtime request", async () => {
    const { record } = await clockOutAfter({ date: "2026-07-06", startTime: "09:00", endTime: "18:00" }, "2026-07-06", "19:30");
    // Both requests read "no overtime yet" before either writes, on every run.
    const read = overtimeService.getOvertimeRequestsByEmployeeAndDate;
    vi.spyOn(overtimeService, "getOvertimeRequestsByEmployeeAndDate").mockImplementation(async (...args) => {
      const rows = await read(...args);
      await new Promise((resolve) => setTimeout(resolve, 80));
      return rows;
    });
    await warmPool(4);

    const results = await concurrently(2, () => clockService.updateRecordReason(record.id, undefined, "加班"));

    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(await overtimeFor(record.id)).toHaveLength(1);
  });

  it("filled again later for the same clock-out, adds nothing", async () => {
    const { record } = await clockOutAfter({ date: "2026-07-06", startTime: "09:00", endTime: "18:00" }, "2026-07-06", "19:30");

    await clockService.updateRecordReason(record.id, undefined, "加班");
    const again = await clockService.updateRecordReason(record.id, undefined, "加班");

    expect(again.overtimeRequest).toBeNull();
    expect(await overtimeFor(record.id)).toHaveLength(1);
  });

  it("a clock-out after midnight is dated by the shift, not by the clock-out day", async () => {
    const { record } = await clockOutAfter({ date: "2026-07-06", startTime: "16:00", endTime: "23:00" }, "2026-07-07", "00:40");

    await clockService.updateRecordReason(record.id, undefined, "加班");
    await clockService.updateRecordReason(record.id, undefined, "加班");

    const rows = await overtimeFor(record.id);
    expect(rows.map((r) => [r.date, r.startTime, r.endTime])).toEqual([["2026-07-06", "23:00:00", "00:40"]]);
  });

  it("a clock-out before the shift end makes no overtime request", async () => {
    const { record } = await clockOutAfter({ date: "2026-07-06", startTime: "09:00", endTime: "18:00" }, "2026-07-06", "17:50");

    const result = await clockService.updateRecordReason(record.id, undefined, "加班");

    expect(result.overtimeRequest).toBeNull();
    expect(await overtimeFor(record.id)).toHaveLength(0);
    const [row] = await db.select().from(clockRecords).where(eq(clockRecords.id, record.id));
    expect(row.lateDepartureReason).toBe("加班");
  });

  it("an unknown clock record is 404 and writes nothing", async () => {
    const error: any = await clockService.updateRecordReason(999, undefined, "加班").catch((e) => e);
    expect(error.status).toBe(404);
    expect(await db.select().from(overtimeRequests)).toHaveLength(0);
  });
});
