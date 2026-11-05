import { eq } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { systemConfigs } from "@shared/schema";
import { db } from "../../infra/db";
import { resetDatabase, warmPool } from "../../test/itest";

type HealthModule = typeof import("../../shared/health/healthState");

/** Two server instances are two copies of the module, each with its own memory and its own connection pool. */
const instances: Pool[] = [];
async function startInstance(): Promise<HealthModule> {
  vi.resetModules();
  const health = await import("../../shared/health/healthState");
  instances.push((await import("../../infra/db")).pool);
  return health;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 400));
const stored = async (key: string) => {
  const [row] = await db.select().from(systemConfigs).where(eq(systemConfigs.key, key));
  return row ? JSON.parse(row.value) : undefined;
};

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await Promise.all(instances.map((pool) => pool.end()));
});

describe("integration health record", () => {
  it("counts every failure when two instances report one at the same moment", async () => {
    const a = await startInstance();
    const b = await startInstance();
    await Promise.all(instances.map((pool) => warmPool(2, pool)));

    await Promise.all([a.recordIntegration("line", false, "timeout"), b.recordIntegration("line", false, "timeout")]);
    await settle();

    expect((await stored("health:integration:line")).consecutiveFailures).toBe(2);
  });

  it("resets the count when another instance sees LINE succeed again", async () => {
    const a = await startInstance();
    const b = await startInstance();
    await a.recordIntegration("line", false, "timeout");
    await settle();

    await b.recordIntegration("line", true);
    await settle();

    expect(await stored("health:integration:line")).toMatchObject({ consecutiveFailures: 0 });
  });
});

describe("job health record", () => {
  it("keeps the fields each instance wrote when two instances finish the same job at once", async () => {
    const a = await startInstance();
    const b = await startInstance();
    await Promise.all(instances.map((pool) => warmPool(2, pool)));

    await Promise.all([
      a.trackJob("push.demo", "cron", async () => "a", () => ({ who: "a" })),
      b.trackJob("push.demo", "manual", async () => "b", () => ({ who: "b" })),
    ]);
    await settle();

    const state = await stored("health:job:push.demo");
    expect(state).toMatchObject({ lastStatus: "success" });
    expect(Object.keys(state)).toEqual(expect.arrayContaining(["lastStartedAt", "lastFinishedAt", "lastSuccessAt", "lastTrigger", "lastSummary"]));
  });
});

const pause = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("recovery time", () => {
  it("is stamped on the first success after a failure and stays put through later successes", async () => {
    const health = await startInstance();
    await health.recordIntegration("line", false, "timeout");
    await settle();
    expect((await stored("health:integration:line")).recoveredAt).toBeUndefined();

    await pause();
    await health.recordIntegration("line", true);
    await settle();
    const back = await stored("health:integration:line");
    expect(back.recoveredAt).toBe(back.lastSuccessAt);
    expect(Date.parse(back.recoveredAt)).toBeGreaterThan(Date.parse(back.lastFailureAt));

    // A second instance has its own memory, so its success is not throttled away; it moves lastSuccessAt only.
    const other = await startInstance();
    await pause();
    await other.recordIntegration("line", true);
    await settle();
    const later = await stored("health:integration:line");
    expect(Date.parse(later.lastSuccessAt)).toBeGreaterThan(Date.parse(back.lastSuccessAt));
    expect(later.recoveredAt).toBe(back.recoveredAt);
  });

  it("is not stamped on a success that follows no failure", async () => {
    const health = await startInstance();
    await health.recordIntegration("mail", true);
    await settle();
    expect((await stored("health:integration:mail")).recoveredAt).toBeUndefined();
  });

  it("is stamped again after a second outage", async () => {
    const health = await startInstance();
    await health.recordIntegration("ragic", false, "a");
    await settle();
    await pause();
    await health.recordIntegration("ragic", true);
    await settle();
    const first = (await stored("health:integration:ragic")).recoveredAt;
    await pause();
    await health.recordIntegration("ragic", false, "b");
    await settle();
    await pause();
    await health.recordIntegration("ragic", true);
    await settle();
    const state = await stored("health:integration:ragic");
    expect(Date.parse(state.recoveredAt)).toBeGreaterThan(Date.parse(first));
    expect(state.recoveredAt).toBe(state.lastSuccessAt);
  });

  it("is stamped for a job whose run failed and then succeeded, even though the new run overwrote the status", async () => {
    const health = await startInstance();
    await expect(health.trackJob("push.demo", "cron", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect((await stored("health:job:push.demo")).recoveredAt).toBeUndefined();

    await pause();
    await health.trackJob("push.demo", "cron", async () => "ok");
    const back = await stored("health:job:push.demo");
    expect(back.recoveredAt).toBe(back.lastSuccessAt);

    await pause();
    await health.trackJob("push.demo", "cron", async () => "ok again");
    const later = await stored("health:job:push.demo");
    expect(Date.parse(later.lastSuccessAt)).toBeGreaterThan(Date.parse(back.lastSuccessAt));
    expect(later.recoveredAt).toBe(back.recoveredAt);
  });
});
