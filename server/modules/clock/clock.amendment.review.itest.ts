import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clockAmendments, clockRecords } from "@shared/schema";
import { db } from "../../infra/db";
import { concurrently, createEmployee, createRegion, createShift, createVenue, resetDatabase, warmPool } from "../../test/itest";
import { clockRepository } from "./clock.repository";
import { clockService } from "./clock.service";
import { LOCK_NS } from "../../infra/db/tx";
import { runWhileLockHeld } from "../../test/lock";

const SHIFT_DATE = "2026-10-01";
// 09:20 Taipei, twenty minutes after the shift starts.
const REQUESTED_AT = new Date("2026-10-01T01:20:00Z");

async function setup() {
  const region = await createRegion();
  const venue = await createVenue({ regionId: region.id });
  const employee = await createEmployee({ regionId: region.id });
  const shift = await createShift({ employeeId: employee.id, venueId: venue.id, date: SHIFT_DATE, startTime: "09:00", endTime: "18:00" });
  return { venue, employee, shift };
}

/** A clock-in that happened at 09:40 and is to be moved to 09:20 (an amendment with an original record). */
async function amendmentOfRecord() {
  const { venue, employee, shift } = await setup();
  const [original] = await db
    .insert(clockRecords)
    .values({
      employeeId: employee.id, venueId: venue.id, shiftId: shift.id, clockType: "in", latitude: 25, longitude: 121.5,
      status: "success", failReason: "遲到 40 分鐘", clockTime: new Date("2026-10-01T01:40:00Z"),
    })
    .returning();
  const [amendment] = await db
    .insert(clockAmendments)
    .values({
      employeeId: employee.id, venueId: venue.id, shiftId: shift.id, clockType: "in", requestedTime: REQUESTED_AT,
      reason: "測試補卡", status: "pending", originalClockRecordId: original.id,
    })
    .returning();
  return { employee, original, amendment };
}

/** A missing punch: nothing to amend, so approval must add a clock row. */
async function amendmentOfMissingPunch() {
  const { venue, employee, shift } = await setup();
  const [amendment] = await db
    .insert(clockAmendments)
    .values({ employeeId: employee.id, venueId: venue.id, shiftId: shift.id, clockType: "in", requestedTime: REQUESTED_AT, reason: "測試缺卡", status: "pending" })
    .returning();
  return { employee, amendment };
}

const amendmentRow = async (id: number) => (await db.select().from(clockAmendments).where(eq(clockAmendments.id, id)))[0];
const recordRows = () => db.select().from(clockRecords).orderBy(clockRecords.id);
const review = (id: number, status: string, adminId = 1) => clockService.approveAmendment(id, status, undefined, adminId, `管理員${adminId}`);
const errorStatuses = (results: PromiseSettledResult<unknown>[]) =>
  results.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason.status);

/** Every review reads the amendment, then pauses, so two reviews that both read before either writes happen on every run. */
function widenReadToWriteWindow(ms = 80) {
  const read = clockRepository.getClockAmendment;
  vi.spyOn(clockRepository, "getClockAmendment").mockImplementation(async (...args) => {
    const row = await read(...args);
    await new Promise((resolve) => setTimeout(resolve, ms));
    return row;
  });
}

beforeEach(async () => {
  await resetDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("approving a clock amendment", () => {
  it("moves the original clock record's time and rewrites its fail reason from the shift", async () => {
    const { original, amendment } = await amendmentOfRecord();

    const reviewed = await review(amendment.id, "approved");

    expect([reviewed.status, reviewed.reviewedBy]).toEqual(["approved", 1]);
    const [record] = await recordRows();
    expect([record.id, record.amendedTime, record.amendmentId, record.failReason]).toEqual([original.id, REQUESTED_AT, amendment.id, "遲到 20 分鐘（補正）"]);
  });

  it("adds one clock record for a missing punch, tagged with the amendment", async () => {
    const { employee, amendment } = await amendmentOfMissingPunch();

    await review(amendment.id, "approved");

    const records = await recordRows();
    expect(records.map((r) => [r.employeeId, r.clockType, r.status, r.failReason, r.clockTime, r.amendmentId])).toEqual([
      [employee.id, "in", "success", "補打卡", REQUESTED_AT, amendment.id],
    ]);
  });

  it("a rejection touches only the amendment", async () => {
    const { original, amendment } = await amendmentOfRecord();
    const before = await recordRows();

    await review(amendment.id, "rejected");

    expect((await amendmentRow(amendment.id)).status).toBe("rejected");
    expect(await recordRows()).toEqual(before);
    expect(before[0].id).toBe(original.id);
  });

  it("two approvals of a missing punch at once: one wins, the other gets 409, and only one clock record is added", async () => {
    const { amendment } = await amendmentOfMissingPunch();
    widenReadToWriteWindow();
    await warmPool(4);

    const results = await concurrently(2, (i) => review(amendment.id, "approved", i + 1));

    expect(errorStatuses(results)).toEqual([409]);
    expect(await recordRows()).toHaveLength(1);
  });

  it("two approvals of a record's amendment at once: one wins and the other gets 409", async () => {
    const { amendment } = await amendmentOfRecord();
    widenReadToWriteWindow();
    await warmPool(4);

    const results = await concurrently(2, (i) => review(amendment.id, "approved", i + 1));

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(errorStatuses(results)).toEqual([409]);
    const winner = results.findIndex((r) => r.status === "fulfilled") + 1;
    expect((await amendmentRow(amendment.id)).reviewedBy).toBe(winner);
  });

  it("an approval and a rejection at once: the amendment is approved exactly when the clock record was changed", async () => {
    const { amendment } = await amendmentOfRecord();
    widenReadToWriteWindow();
    await warmPool(4);

    const statuses = ["approved", "rejected"];
    const results = await concurrently(2, (i) => review(amendment.id, statuses[i], i + 1));

    expect(errorStatuses(results)).toEqual([409]);
    const winnerIndex = results.findIndex((r) => r.status === "fulfilled");
    const [record] = await recordRows();
    expect([(await amendmentRow(amendment.id)).status, record.amendedTime !== null]).toEqual([statuses[winnerIndex], winnerIndex === 0]);
  });

  it("an already reviewed amendment gets 409 on a second review and nothing changes", async () => {
    const { amendment } = await amendmentOfMissingPunch();
    await review(amendment.id, "approved", 1);
    const [amendmentBefore, recordsBefore] = [await amendmentRow(amendment.id), await recordRows()];

    await expect(review(amendment.id, "rejected", 2)).rejects.toMatchObject({ status: 409 });
    await expect(review(amendment.id, "approved", 2)).rejects.toMatchObject({ status: 409 });

    expect([await amendmentRow(amendment.id), await recordRows()]).toEqual([amendmentBefore, recordsBefore]);
  });

  it("an unknown amendment is 404 and a status other than approved or rejected is 400", async () => {
    const { amendment } = await amendmentOfMissingPunch();

    await expect(review(999999, "approved")).rejects.toMatchObject({ status: 404 });
    await expect(review(amendment.id, "pending")).rejects.toMatchObject({ status: 400 });
  });

  it("when adding the clock record fails the amendment stays exactly as submitted: still pending, no review fields, no compensation", async () => {
    const { amendment } = await amendmentOfMissingPunch();
    const before = await amendmentRow(amendment.id);
    vi.spyOn(clockRepository, "createClockRecord").mockRejectedValue(new Error("disk full"));

    await expect(review(amendment.id, "approved")).rejects.toThrow("disk full");

    expect(await amendmentRow(amendment.id)).toEqual(before);
    expect(await recordRows()).toEqual([]);
  });

  it("when moving the original record's time fails the amendment stays exactly as submitted and the record is untouched", async () => {
    const { amendment } = await amendmentOfRecord();
    const [amendmentBefore, recordsBefore] = [await amendmentRow(amendment.id), await recordRows()];
    vi.spyOn(clockRepository, "applyClockRecordAmendment").mockRejectedValue(new Error("disk full"));

    await expect(review(amendment.id, "approved")).rejects.toThrow("disk full");

    expect([await amendmentRow(amendment.id), await recordRows()]).toEqual([amendmentBefore, recordsBefore]);
  });

  it("when the original record is gone the approval fails and the amendment stays pending", async () => {
    const { original, amendment } = await amendmentOfRecord();
    await db.delete(clockRecords).where(eq(clockRecords.id, original.id));
    const before = await amendmentRow(amendment.id);

    await expect(review(amendment.id, "approved")).rejects.toMatchObject({ status: 500 });

    expect(await amendmentRow(amendment.id)).toEqual(before);
  });

  it("it can be reviewed again after a failed approval", async () => {
    const { amendment } = await amendmentOfMissingPunch();
    const create = vi.spyOn(clockRepository, "createClockRecord").mockRejectedValueOnce(new Error("disk full"));

    await expect(review(amendment.id, "approved")).rejects.toThrow("disk full");
    create.mockRestore();
    await review(amendment.id, "approved");

    expect([(await amendmentRow(amendment.id)).status, (await recordRows()).length]).toEqual(["approved", 1]);
  });

  it("approving waits for the employee's clock lock and then goes through, while a rejection does not wait", async () => {
    const { employee, amendment } = await amendmentOfMissingPunch();
    const other = await amendmentOfMissingPunch();

    const approval = await runWhileLockHeld(LOCK_NS.clock, employee.id, () => review(amendment.id, "approved"));
    const rejection = await runWhileLockHeld(LOCK_NS.clock, other.employee.id, () => review(other.amendment.id, "rejected"));

    expect([approval.finishedWhileHeld, approval.outcome.status, (await amendmentRow(amendment.id)).status]).toEqual([false, "fulfilled", "approved"]);
    expect([rejection.finishedWhileHeld, rejection.outcome.status]).toEqual([true, "fulfilled"]);
  });

  it("filing waits for the employee's clock lock", async () => {
    const { employee } = await amendmentOfMissingPunch();

    const filing = await runWhileLockHeld(LOCK_NS.clock, employee.id, () =>
      clockService.createAmendment({ employeeId: employee.id, clockType: "out", requestedTime: "2026-10-02T10:00:00Z", reason: "測試補卡" }),
    );

    expect([filing.finishedWhileHeld, filing.outcome.status]).toEqual([false, "fulfilled"]);
  });

});
