import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pushDedup } from "@shared/schema";
import { db } from "../../infra/db";
import { concurrently, resetDatabase, warmPool } from "../../test/itest";
import { pushOnce, prunePushRecords } from "./pushOnce.service";
import { pushDedupRepository } from "./pushDedup.repository";

vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn(async () => undefined) }));

const slot = { scope: "weekly-schedule", period: "2026-07-06", employeeId: 7 };
const rows = () => db.select().from(pushDedup);

beforeEach(async () => {
  await resetDatabase();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe("pushOnce", () => {
  it("reclaims a stale pending slot after finish failed using the same retry key", async () => {
    const send = vi.fn(async (_retryKey?: string) => "accepted" as const);
    const finish = vi.spyOn(pushDedupRepository, "finish").mockRejectedValue(new Error("synthetic finish failure"));
    try {
      expect((await pushOnce(slot, send)).outcome).toBe("unknown");
    } finally {
      finish.mockRestore();
    }
    expect(await rows()).toMatchObject([{ status: "pending", attempts: 1 }]);
    await db.update(pushDedup).set({ updatedAt: sql`(now() at time zone 'UTC') - interval '11 minutes'` });

    expect((await pushOnce(slot, send)).outcome).toBe("sent");
    expect(send).toHaveBeenCalledTimes(2);
    const retryKey = send.mock.calls[0][0];
    expect(retryKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(send.mock.calls[1][0]).toBe(retryKey);
    expect(await rows()).toMatchObject([{ status: "sent", attempts: 1 }]);
  });
  it("pushes a new slot and records it as sent on the first attempt", async () => {
    const send = vi.fn(async () => "accepted" as const);

    const result = await pushOnce(slot, send);

    expect(result).toEqual({ outcome: "sent", attempt: 1, reclaimed: false });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await rows()).toMatchObject([{ ...slot, refId: "", status: "sent", attempts: 1 }]);
  });

  it("does not push a slot that was sent", async () => {
    await pushOnce(slot, async () => "accepted" as const);
    const send = vi.fn(async () => "accepted" as const);

    expect(await pushOnce(slot, send)).toEqual({ outcome: "skipped", attempt: 0, reclaimed: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("lets only one of two simultaneous callers push", async () => {
    await warmPool(4);
    const send = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return "accepted" as const;
    });

    const results = await concurrently(2, () => pushOnce(slot, send));

    expect(send).toHaveBeenCalledTimes(1);
    expect(results.map((r) => (r.status === "fulfilled" ? r.value.outcome : "rejected")).sort()).toEqual(["sent", "skipped"]);
  });

  it("marks a refused push failed, pushes it again once on the next round and counts both attempts", async () => {
    expect(await pushOnce(slot, async () => "rejected" as const)).toEqual({ outcome: "failed", attempt: 1, reclaimed: false });
    expect(await rows()).toMatchObject([{ status: "failed", attempts: 1 }]);

    expect(await pushOnce(slot, async () => "accepted" as const)).toEqual({ outcome: "sent", attempt: 2, reclaimed: true });
    expect(await rows()).toMatchObject([{ status: "sent", attempts: 2 }]);

    const send = vi.fn(async () => "accepted" as const);
    expect(await pushOnce(slot, send)).toEqual({ outcome: "skipped", attempt: 0, reclaimed: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("lets only one of two simultaneous callers retry a failed push", async () => {
    await pushOnce(slot, async () => "rejected" as const);
    await warmPool(4);
    const send = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return "accepted" as const;
    });

    await concurrently(2, () => pushOnce(slot, send));

    expect(send).toHaveBeenCalledTimes(1);
    expect(await rows()).toMatchObject([{ status: "sent", attempts: 2 }]);
  });

  it("leaves an unknown push pending, skips it within ten minutes, then reuses its retry key", async () => {
    const uncertain = vi.fn(async (_key: string): Promise<never> => {
      throw new Error("synthetic connection lost after acceptance");
    });
    const result = await pushOnce(slot, uncertain);
    const send = vi.fn(async (_key: string) => "accepted" as const);

    expect(result).toEqual({ outcome: "unknown", attempt: 1, reclaimed: false });
    expect(await pushOnce(slot, send)).toEqual({ outcome: "skipped", attempt: 0, reclaimed: false });
    expect(send).not.toHaveBeenCalled();
    expect(await rows()).toMatchObject([{ status: "pending", attempts: 1 }]);
    expect(uncertain).toHaveBeenCalledTimes(3);
    expect(new Set(uncertain.mock.calls.map(([key]) => key)).size).toBe(1);
    await db.update(pushDedup).set({ updatedAt: sql`(now() at time zone 'UTC') - interval '11 minutes'` });
    expect(await pushOnce(slot, send)).toEqual({ outcome: "sent", attempt: 1, reclaimed: true });
    expect(send.mock.calls[0]).toEqual(uncertain.mock.calls[0]);
  });

  it("treats a slot another instance claimed and has not finished as possibly sent", async () => {
    await db.insert(pushDedup).values({ ...slot, status: "pending" });
    const send = vi.fn(async () => "accepted" as const);

    expect(await pushOnce(slot, send)).toEqual({ outcome: "skipped", attempt: 0, reclaimed: false });
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["UTC", "Asia/Taipei"])("uses DB UTC for exact lease boundaries and writes with Node TZ=%s", async (zone) => {
    const originalZone = process.env.TZ;
    process.env.TZ = zone;
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`set local time zone 'Asia/Taipei'`);
        const cases = [
          [10 * 60_000 - 1, false], [10 * 60_000, false], [10 * 60_000 + 1, true],
          [20 * 3_600_000 - 1, true], [20 * 3_600_000, false], [20 * 3_600_000 + 1, false],
        ] as const;
        for (const [index, [age, eligible]] of cases.entries()) {
          const key = { ...slot, employeeId: 100 + index, refId: "" };
          await tx.insert(pushDedup).values({ ...key, status: "pending", attempts: 3, updatedAt: sql`(now() at time zone 'UTC') - ${age} * interval '1 millisecond'` });
          expect(await pushDedupRepository.claim(key, tx)).toEqual(eligible ? { attempt: 3, reclaimed: true } : null);
        }
        const fresh = { ...slot, employeeId: 200, refId: "" };
        expect(await pushDedupRepository.claim(fresh, tx)).toEqual({ attempt: 1, reclaimed: false });
        const freshTime = await tx.execute(sql`select updated_at = (now() at time zone 'UTC') as correct from push_dedup where employee_id = 200`);
        expect(freshTime.rows[0].correct).toBe(true);
        await pushDedupRepository.finish(fresh, "failed", tx);
        expect(await pushDedupRepository.claim(fresh, tx)).toEqual({ attempt: 2, reclaimed: true });
        await pushDedupRepository.finish(fresh, "sent", tx);
        const finishTime = await tx.execute(sql`select updated_at = (now() at time zone 'UTC') as correct from push_dedup where employee_id = 200`);
        expect(finishTime.rows[0].correct).toBe(true);
      });
    } finally {
      process.env.TZ = originalZone;
    }
  });

  it("lets only one simultaneous caller take over a stale pending lease", async () => {
    await db.insert(pushDedup).values({ ...slot, status: "pending", attempts: 2, updatedAt: sql`(now() at time zone 'UTC') - interval '11 minutes'` });
    await warmPool(4);
    const send = vi.fn(async (_key: string) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return "accepted" as const;
    });
    const results = await concurrently(2, () => pushOnce(slot, send));
    expect(send).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.status === "fulfilled" ? r.value.outcome : "error").sort()).toEqual(["sent", "skipped"]);
    expect(await rows()).toMatchObject([{ status: "sent", attempts: 2 }]);
  });

  it("keeps uncertain mail pending when its transport cannot deduplicate a reclaimed attempt", async () => {
    const mailSlot = { ...slot, scope: "weekly-attendance-mail" };
    await db.insert(pushDedup).values({ ...mailSlot, status: "pending", attempts: 1, updatedAt: sql`(now() at time zone 'UTC') - interval '11 minutes'` });
    const send = vi.fn(async (_key: string) => "accepted" as const);
    expect((await pushOnce(mailSlot, send, { reclaimPending: false })).outcome).toBe("skipped");
    expect(send).not.toHaveBeenCalled();
    await db.update(pushDedup).set({ status: "failed" });
    expect(await pushOnce(mailSlot, send, { reclaimPending: false })).toEqual({ outcome: "sent", attempt: 2, reclaimed: true });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("records sent after the first finish fails without resending", async () => {
    const realFinish = pushDedupRepository.finish.bind(pushDedupRepository);
    const finish = vi.spyOn(pushDedupRepository, "finish").mockRejectedValueOnce(new Error("synthetic transient DB error")).mockImplementation(realFinish);
    const send = vi.fn(async (_key: string) => "accepted" as const);
    expect((await pushOnce(slot, send)).outcome).toBe("sent");
    expect(finish).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await rows()).toMatchObject([{ status: "sent", attempts: 1 }]);
  });

  it("keeps slots apart by scope, period, employee and ref", async () => {
    const send = vi.fn(async () => "accepted" as const);

    await pushOnce(slot, send);
    await pushOnce({ ...slot, scope: "weekly-late" }, send);
    await pushOnce({ ...slot, period: "2026-07-13" }, send);
    await pushOnce({ ...slot, employeeId: 8 }, send);
    await pushOnce({ ...slot, refId: "shift-1" }, send);

    expect(send).toHaveBeenCalledTimes(5);
  });

  it("prunes slots older than the retention window", async () => {
    await pushOnce(slot, async () => "accepted" as const);
    await pushOnce({ ...slot, employeeId: 8 }, async () => "accepted" as const);
    await db.update(pushDedup).set({ updatedAt: new Date("2026-05-01T00:00:00Z") }).where(eq(pushDedup.employeeId, 8));

    await prunePushRecords(new Date("2026-07-03T00:00:00Z"));

    expect((await rows()).map((r) => r.employeeId)).toEqual([7]);
  });
});
