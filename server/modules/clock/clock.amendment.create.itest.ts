import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clockAmendments, clockRecords } from "@shared/schema";
import { db } from "../../infra/db";
import { concurrently, createEmployee, createRegion, resetDatabase, warmPool } from "../../test/itest";
import { clockRepository } from "./clock.repository";
import { clockService } from "./clock.service";

const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}T01:00:00Z`;

const submit = (employeeId: number, requestedTime: string, extra: Record<string, unknown> = {}) =>
  clockService.createAmendment({ employeeId, clockType: "in", requestedTime, reason: "測試補卡", ...extra });

const storedFor = (employeeId: number) => db.select().from(clockAmendments).where(eq(clockAmendments.employeeId, employeeId));
const statuses = (results: PromiseSettledResult<unknown>[]) =>
  results.map((r) => (r.status === "fulfilled" ? "ok" : (r as PromiseRejectedResult).reason.status));

/** Every submission reads the employee's amendments, then pauses, so two that both read before either writes happen on every run. */
function widenReadToWriteWindow(ms = 80) {
  const read = clockRepository.getClockAmendmentsByEmployee;
  vi.spyOn(clockRepository, "getClockAmendmentsByEmployee").mockImplementation(async (...args) => {
    const rows = await read(...args);
    await new Promise((resolve) => setTimeout(resolve, ms));
    return rows;
  });
}

async function employee() {
  const region = await createRegion();
  return createEmployee({ regionId: region.id });
}

beforeEach(async () => {
  await resetDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("submitting a clock amendment", () => {
  it("stores a pending amendment", async () => {
    const e = await employee();

    const created = await submit(e.id, day(1));

    expect([created.status, created.employeeId, created.clockType]).toEqual(["pending", e.id, "in"]);
    expect(await storedFor(e.id)).toHaveLength(1);
  });

  it("refuses a fourth amendment in the month, but not one marked as a system issue", async () => {
    const e = await employee();
    for (const n of [1, 2, 3]) await submit(e.id, day(n));

    await expect(submit(e.id, day(4))).rejects.toMatchObject({ status: 400 });
    await submit(e.id, day(4), { isSystemIssue: true });

    expect(await storedFor(e.id)).toHaveLength(4);
  });

  it("four submissions at once with two already filed: exactly one more is accepted", async () => {
    const e = await employee();
    await submit(e.id, day(1));
    await submit(e.id, day(2));
    widenReadToWriteWindow();
    await warmPool(6);

    const results = await concurrently(4, (i) => submit(e.id, day(10 + i)));

    expect(statuses(results).filter((s) => s === "ok")).toHaveLength(1);
    expect(await storedFor(e.id)).toHaveLength(3);
  });

  it("the same missing punch submitted twice at once is filed once", async () => {
    const e = await employee();
    widenReadToWriteWindow();
    await warmPool(4);

    const results = await concurrently(2, () => submit(e.id, day(5)));

    expect(statuses(results).sort()).toEqual([400, "ok"]);
    expect(await storedFor(e.id)).toHaveLength(1);
  });

  it("the same clock record amended twice at once is filed once", async () => {
    const e = await employee();
    const [record] = await db
      .insert(clockRecords)
      .values({ employeeId: e.id, clockType: "in", latitude: 25, longitude: 121.5, status: "success", clockTime: new Date(day(6)) })
      .returning();
    widenReadToWriteWindow();
    await warmPool(4);

    const results = await concurrently(2, () => submit(e.id, day(6), { originalClockRecordId: record.id }));

    expect(statuses(results).sort()).toEqual([400, "ok"]);
    expect(await storedFor(e.id)).toHaveLength(1);
  });

  it("a rejected amendment does not block filing the same punch again", async () => {
    const e = await employee();
    const first = await submit(e.id, day(7));
    await db.update(clockAmendments).set({ status: "rejected" }).where(eq(clockAmendments.id, first.id));

    await submit(e.id, day(7));

    expect(await storedFor(e.id)).toHaveLength(2);
  });
});
