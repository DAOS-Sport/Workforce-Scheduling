import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pushDedup } from "@shared/schema";
import { db } from "../../infra/db";
import { concurrently, resetDatabase, warmPool } from "../../test/itest";
import { pushOnce, prunePushRecords } from "./pushOnce.service";

const slot = { scope: "weekly-schedule", period: "2026-07-06", employeeId: 7 };
const rows = () => db.select().from(pushDedup);

beforeEach(async () => {
  await resetDatabase();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("pushOnce", () => {
  it("pushes a new slot and records it as sent on the first attempt", async () => {
    const send = vi.fn(async () => true);

    const result = await pushOnce(slot, send);

    expect(result).toEqual({ outcome: "sent", attempt: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await rows()).toMatchObject([{ ...slot, refId: "", status: "sent", attempts: 1 }]);
  });

  it("does not push a slot that was sent", async () => {
    await pushOnce(slot, async () => true);
    const send = vi.fn(async () => true);

    expect(await pushOnce(slot, send)).toEqual({ outcome: "skipped", attempt: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("lets only one of two simultaneous callers push", async () => {
    await warmPool(4);
    const send = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return true;
    });

    const results = await concurrently(2, () => pushOnce(slot, send));

    expect(send).toHaveBeenCalledTimes(1);
    expect(results.map((r) => (r.status === "fulfilled" ? r.value.outcome : "rejected")).sort()).toEqual(["sent", "skipped"]);
  });

  it("marks a refused push failed, pushes it again once on the next round and counts both attempts", async () => {
    expect(await pushOnce(slot, async () => false)).toEqual({ outcome: "failed", attempt: 1 });
    expect(await rows()).toMatchObject([{ status: "failed", attempts: 1 }]);

    expect(await pushOnce(slot, async () => true)).toEqual({ outcome: "sent", attempt: 2 });
    expect(await rows()).toMatchObject([{ status: "sent", attempts: 2 }]);

    const send = vi.fn(async () => true);
    expect(await pushOnce(slot, send)).toEqual({ outcome: "skipped", attempt: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("lets only one of two simultaneous callers retry a failed push", async () => {
    await pushOnce(slot, async () => false);
    await warmPool(4);
    const send = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return true;
    });

    await concurrently(2, () => pushOnce(slot, send));

    expect(send).toHaveBeenCalledTimes(1);
    expect(await rows()).toMatchObject([{ status: "sent", attempts: 2 }]);
  });

  it("leaves the slot pending and never pushes it again when the push threw", async () => {
    const result = await pushOnce(slot, async () => {
      throw new Error("died after LINE accepted it");
    });
    const send = vi.fn(async () => true);

    expect(result).toEqual({ outcome: "unknown", attempt: 1 });
    expect(await pushOnce(slot, send)).toEqual({ outcome: "skipped", attempt: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(await rows()).toMatchObject([{ status: "pending", attempts: 1 }]);
  });

  it("treats a slot another instance claimed and has not finished as possibly sent", async () => {
    await db.insert(pushDedup).values({ ...slot, status: "pending" });
    const send = vi.fn(async () => true);

    expect(await pushOnce(slot, send)).toEqual({ outcome: "skipped", attempt: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps slots apart by scope, period, employee and ref", async () => {
    const send = vi.fn(async () => true);

    await pushOnce(slot, send);
    await pushOnce({ ...slot, scope: "weekly-late" }, send);
    await pushOnce({ ...slot, period: "2026-07-13" }, send);
    await pushOnce({ ...slot, employeeId: 8 }, send);
    await pushOnce({ ...slot, refId: "shift-1" }, send);

    expect(send).toHaveBeenCalledTimes(5);
  });

  it("prunes slots older than the retention window", async () => {
    await pushOnce(slot, async () => true);
    await pushOnce({ ...slot, employeeId: 8 }, async () => true);
    await db.update(pushDedup).set({ updatedAt: new Date("2026-05-01T00:00:00Z") }).where(eq(pushDedup.employeeId, 8));

    await prunePushRecords(new Date("2026-07-03T00:00:00Z"));

    expect((await rows()).map((r) => r.employeeId)).toEqual([7]);
  });
});
