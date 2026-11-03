import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clockRecords } from "@shared/schema";
import { db } from "../../infra/db";
import { concurrently, peakConnections, resetDatabase, warmPool } from "../../test/itest";
import { LAT, LNG, employeeOnShiftNow, widenReadToWriteWindow } from "../../test/clock";
import { processClockIn } from "./clockIn.service";
import { invalidateVenueCache } from "./venueCache";

const clockIn = async (employeeId: number) => (await processClockIn({ employeeId }, LAT, LNG, { accuracy: 10 })).result;

const successfulClockIns = (employeeId: number) =>
  db
    .select()
    .from(clockRecords)
    .where(and(eq(clockRecords.employeeId, employeeId), eq(clockRecords.status, "success"), eq(clockRecords.clockType, "in")));

beforeEach(async () => {
  await resetDatabase();
  invalidateVenueCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("processClockIn on a real database", () => {
  it("one in-range clock-in during a shift succeeds and writes one clock-in row", async () => {
    const { employee } = await employeeOnShiftNow();

    const result = await clockIn(employee.id);

    expect([result.status, result.clockType, result.failReason]).toEqual(["success", "in", null]);
    const rows = await successfulClockIns(employee.id);
    expect(result.status === "success" ? [result.recordId] : []).toEqual(rows.map((r) => r.id));
  });

  it("a second clock-in right after the first, one at a time, adds no second clock-in row", async () => {
    const { employee } = await employeeOnShiftNow();

    await clockIn(employee.id);
    // A real double tap is tens of ms apart.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const repeat = await clockIn(employee.id);

    expect(repeat.failReason).toBe("您剛才已完成上班打卡，無需重複");
    expect(await successfulClockIns(employee.id)).toHaveLength(1);
  });
});

const allRows = (employeeId: number) => db.select().from(clockRecords).where(eq(clockRecords.employeeId, employeeId));

describe("10 simultaneous clock-ins by one employee", () => {
  it("record one clock-in and nothing else: no second clock-in, no clock-out, no early-leave row", async () => {
    const { employee } = await employeeOnShiftNow();
    widenReadToWriteWindow();
    await warmPool(10);

    const { result, peak } = await peakConnections(() => concurrently(10, () => clockIn(employee.id)));

    expect(result.filter((r) => r.status === "rejected")).toEqual([]);
    expect(peak).toBeGreaterThanOrEqual(2);
    const rows = await allRows(employee.id);
    expect(rows.map((r) => [r.clockType, r.status, r.failReason])).toEqual([["in", "success", null]]);
  });
});
