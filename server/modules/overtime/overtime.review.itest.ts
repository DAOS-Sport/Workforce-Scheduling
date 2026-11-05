import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { overtimeRequests } from "@shared/schema";
import { db } from "../../infra/db";
import { concurrently, createEmployee, createRegion, resetDatabase, warmPool } from "../../test/itest";
import { overtimeRepository } from "./overtime.repository";
import { overtimeService } from "./overtime.service";

const pendingRequest = async () => {
  const region = await createRegion();
  const employee = await createEmployee({ regionId: region.id });
  const [row] = await db
    .insert(overtimeRequests)
    .values({ employeeId: employee.id, date: "2026-10-01", startTime: "18:00", endTime: "20:00", reason: "測試加班", status: "pending" })
    .returning();
  return row;
};

const rowOf = async (id: number) => (await db.select().from(overtimeRequests).where(eq(overtimeRequests.id, id)))[0];

const review = (id: number, status: string, adminId = 1) => overtimeService.review(id, status, undefined, adminId, `管理員${adminId}`);

/** Every review reads the row, then pauses, so two reviews that both read before either writes happen on every run. */
function widenReadToWriteWindow(ms = 80) {
  const read = overtimeRepository.getOvertimeRequest;
  vi.spyOn(overtimeRepository, "getOvertimeRequest").mockImplementation(async (...args) => {
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

describe("overtime review", () => {
  it("two approvals at once: one wins, the other gets 409, and the row keeps the winner's review", async () => {
    const request = await pendingRequest();
    widenReadToWriteWindow();
    await warmPool(4);

    const results = await concurrently(2, (i) => review(request.id, "approved", i + 1));

    const failed = results.filter((r) => r.status === "rejected");
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(failed.map((r) => (r as PromiseRejectedResult).reason.status)).toEqual([409]);
    const row = await rowOf(request.id);
    const winner = results.findIndex((r) => r.status === "fulfilled") + 1;
    expect([row.status, row.reviewedBy]).toEqual(["approved", winner]);
  });

  it("an approval and a rejection at once: one wins, the other gets 409, and the stored status is the winner's", async () => {
    const request = await pendingRequest();
    widenReadToWriteWindow();
    await warmPool(4);

    const statuses = ["approved", "rejected"];
    const results = await concurrently(2, (i) => review(request.id, statuses[i], i + 1));

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason.status)).toEqual([409]);
    const winnerIndex = results.findIndex((r) => r.status === "fulfilled");
    const row = await rowOf(request.id);
    expect([row.status, row.reviewedBy]).toEqual([statuses[winnerIndex], winnerIndex + 1]);
  });

  it("a second review of an already reviewed request is 409 and changes nothing", async () => {
    const request = await pendingRequest();
    await review(request.id, "approved", 1);
    const before = await rowOf(request.id);

    await expect(review(request.id, "rejected", 2)).rejects.toMatchObject({ status: 409 });

    expect(await rowOf(request.id)).toEqual(before);
  });

  it("an unknown request is still 404", async () => {
    await expect(review(999999, "approved")).rejects.toMatchObject({ status: 404 });
  });
});
