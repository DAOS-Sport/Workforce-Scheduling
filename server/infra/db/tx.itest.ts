import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { regions } from "@shared/schema";
import { db } from "./index";
import { LOCK_NS, lockXact, withSessionLock, withTx, type LockKey } from "./tx";
import { concurrently, resetDatabase, warmPool } from "../../test/itest";

const advisoryLocksHeld = async () => {
  const { rows } = await db.execute<{ n: number }>(sql`select count(*)::int as n from pg_locks where locktype = 'advisory'`);
  return rows[0].n;
};

/** Two transactions take a lock each and hold it for 200 ms; report how many held one at the same moment. */
async function holdersAtOnce(keys: [LockKey, LockKey]) {
  await warmPool(2);
  let inside = 0;
  let peak = 0;
  const backends = new Set<number>();
  const results = await concurrently(2, (i) =>
    withTx(async (tx) => {
      const { rows } = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      backends.add(rows[0].pid);
      await lockXact(tx, LOCK_NS.clock, keys[i]);
      inside += 1;
      peak = Math.max(peak, inside);
      await tx.execute(sql`select pg_sleep(0.2)`);
      inside -= 1;
    }),
  );
  expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
  return { peak, backends: backends.size };
}

beforeEach(async () => {
  await resetDatabase();
});

describe("withTx", () => {
  it("commits every write when fn resolves", async () => {
    const value = await withTx(async (tx) => {
      await tx.insert(regions).values({ name: "甲區", code: "TX1" });
      await tx.insert(regions).values({ name: "乙區", code: "TX2" });
      return "done";
    });

    expect(value).toBe("done");
    expect((await db.select().from(regions)).map((r) => r.code).sort()).toEqual(["TX1", "TX2"]);
  });

  it("rolls back every earlier write when fn throws", async () => {
    const boom = new Error("second write failed");

    await expect(
      withTx(async (tx) => {
        await tx.insert(regions).values({ name: "甲區", code: "TX1" });
        throw boom;
      }),
    ).rejects.toBe(boom);

    expect(await db.select().from(regions)).toEqual([]);
  });
});

describe("withTx and a swallowed failure", () => {
  it("rejects, and keeps nothing, when a statement failed inside fn and fn caught the error", async () => {
    await expect(
      withTx(async (tx) => {
        await tx.insert(regions).values({ name: "甲區", code: "TX1" });
        await tx.execute(sql`select 1 / 0`).catch(() => undefined);
        return "looked fine";
      }),
    ).rejects.toThrow();

    expect(await db.select().from(regions)).toEqual([]);
  });

  it("still commits when the failing statement was isolated in a savepoint", async () => {
    const value = await withTx(async (tx) => {
      await tx.insert(regions).values({ name: "甲區", code: "TX1" });
      await tx.transaction((inner) => inner.execute(sql`select 1 / 0`)).catch(() => undefined);
      return "isolated";
    });

    expect(value).toBe("isolated");
    expect((await db.select().from(regions)).map((r) => r.code)).toEqual(["TX1"]);
  });
});

describe("lockXact", () => {
  it("lets two transactions on different backends hold different keys at the same time", async () => {
    expect(await holdersAtOnce([42, 43])).toEqual({ peak: 2, backends: 2 });
  });

  it("makes a second transaction on another backend wait for the same numeric key", async () => {
    expect(await holdersAtOnce([42, 42])).toEqual({ peak: 1, backends: 2 });
  });

  it("makes a second transaction wait for the same string key", async () => {
    expect(await holdersAtOnce(["venue:12:2026-07-01", "venue:12:2026-07-01"])).toEqual({ peak: 1, backends: 2 });
  });

  it("releases the lock when the transaction ends", async () => {
    await withTx((tx) => lockXact(tx, LOCK_NS.clock, 42));
    await expect(withTx((tx) => lockXact(tx, LOCK_NS.clock, 42).then(() => Promise.reject(new Error("rolled back"))))).rejects.toThrow("rolled back");

    expect(await advisoryLocksHeld()).toBe(0);
  });
});

describe("withSessionLock", () => {
  it("refuses a second holder while the first runs, then frees the key", async () => {
    let entered!: () => void;
    const inside = new Promise<void>((resolve) => (entered = resolve));
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => (finish = resolve));
    const first = withSessionLock(LOCK_NS.ragicSync, 0, async () => {
      entered();
      await gate;
      return "first";
    });
    await inside;

    const second = await withSessionLock(LOCK_NS.ragicSync, 0, async () => "second");
    finish();

    expect([second, await first]).toEqual([{ acquired: false }, { acquired: true, value: "first" }]);
    expect(await withSessionLock(LOCK_NS.ragicSync, 0, async () => "third")).toEqual({ acquired: true, value: "third" });
    expect(await advisoryLocksHeld()).toBe(0);
  });

  it("does not block a different key", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => (finish = resolve));
    let entered!: () => void;
    const inside = new Promise<void>((resolve) => (entered = resolve));
    const first = withSessionLock(LOCK_NS.scheduledJob, "job:a", async () => {
      entered();
      await gate;
    });
    await inside;

    const other = await withSessionLock(LOCK_NS.scheduledJob, "job:b", async () => "b");
    finish();
    await first;

    expect(other).toEqual({ acquired: true, value: "b" });
  });

  it("unlocks and rethrows when fn throws", async () => {
    await expect(
      withSessionLock(LOCK_NS.ragicSync, 0, async () => {
        throw new Error("sync failed");
      }),
    ).rejects.toThrow("sync failed");

    expect(await advisoryLocksHeld()).toBe(0);
  });
});
