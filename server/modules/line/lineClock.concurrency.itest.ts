import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { clockRecords } from "@shared/schema";
import { db } from "../../infra/db";
import { taipeiClock } from "../../core/time/taipei";
import { concurrently, createEmployee, createRegion, createShift, createVenue, peakConnections, resetDatabase, warmPool } from "../../test/itest";
import { invalidateVenueCache, processClockIn } from "./lineClock.service";

const LAT = 25.0;
const LNG = 121.5;
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/**
 * No fake clock here. clock_records.clock_time comes from PostgreSQL's now(),
 * and the service compares it with its own Date: against a fixed day the date
 * range reads miss the rows just written, and against a clock frozen at the real
 * instant the database runs ahead and the repeat guard sees negative minutes.
 * The shift is built around the real Taipei time instead.
 */
async function employeeOnShiftNow() {
  const { date, minutes } = taipeiClock(new Date());
  const region = await createRegion();
  const venue = await createVenue({ regionId: region.id, latitude: LAT, longitude: LNG, radius: 200 });
  const employee = await createEmployee({ regionId: region.id });
  await createShift({ employeeId: employee.id, venueId: venue.id, date, startTime: hhmm(minutes), endTime: hhmm(Math.min(minutes + 120, 23 * 60 + 59)) });
  return employee;
}

const clockIn = (employeeId: number) => processClockIn({ employeeId }, LAT, LNG, undefined, 10);

const successfulClockIns = (employeeId: number) =>
  db
    .select()
    .from(clockRecords)
    .where(and(eq(clockRecords.employeeId, employeeId), eq(clockRecords.status, "success"), eq(clockRecords.clockType, "in")));

beforeEach(async () => {
  await resetDatabase();
  invalidateVenueCache();
});

describe("processClockIn on a real database", () => {
  it("one in-range clock-in during a shift succeeds and writes one clock-in row", async () => {
    const employee = await employeeOnShiftNow();

    const result = await clockIn(employee.id);

    expect([result.status, result.clockType, result.failReason]).toEqual(["success", "in", null]);
    const rows = await successfulClockIns(employee.id);
    expect(rows.map((r) => r.id)).toEqual([result.recordId]);
  });

  it("a second clock-in right after the first, one at a time, adds no second clock-in row", async () => {
    const employee = await employeeOnShiftNow();

    await clockIn(employee.id);
    // A real double tap is tens of ms apart. Back to back, the row's database-side clock_time
    // can read a few ms after the next call's Date, and the repeat guard ignores "future" rows.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const repeat = await clockIn(employee.id);

    expect(repeat.failReason).toBe("您剛才已完成上班打卡，無需重複");
    expect(await successfulClockIns(employee.id)).toHaveLength(1);
  });
});

describe("10 simultaneous clock-ins by one employee", () => {
  let successfulRows: number | undefined;

  it("all finish without errors while overlapping on separate connections", async () => {
    const employee = await employeeOnShiftNow();
    await warmPool(10);

    const { result, peak } = await peakConnections(() => concurrently(10, () => clockIn(employee.id)));

    expect(result.filter((r) => r.status === "rejected")).toEqual([]);
    expect(result.map((r) => (r.status === "fulfilled" ? r.value.status : r.status))).toEqual(Array(10).fill("success"));
    expect(peak).toBeGreaterThanOrEqual(2);
    successfulRows = (await successfulClockIns(employee.id)).length;
    // Zero rows would also fail the next test's toBe(1); only a real double clock-in may.
    expect(successfulRows).toBeGreaterThanOrEqual(1);
    console.log(`[itest] peak connections ${peak}, successful clock-in rows ${successfulRows}`);
  });

  // Fails today: every request reads "no clock-in yet" before any of them writes.
  it.fails("B1 修好前預期失敗: only one of them records a successful clock-in", () => {
    expect(successfulRows, "successful clock-in rows").toBe(1);
  });
});
