import { beforeEach, describe, expect, it } from "vitest";
import { concurrently, resetDatabase, warmPool } from "../../test/itest";
import { readJobState } from "./healthState";
import { runJob } from "./runJob";

const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
};

beforeEach(async () => {
  await resetDatabase();
  await warmPool(4);
});

describe("runJob", () => {
  it("turns away a second run of the same job while the first is running, and leaves the first run's record alone", async () => {
    const release = gate();
    const entered = gate();
    const first = runJob("push.demo", "cron", async () => {
      entered.open();
      await release.opened;
      return "first";
    });
    await entered.opened;

    const second = await runJob("push.demo", "manual", async () => "second");
    release.open();

    expect(second).toEqual({ busy: true });
    expect(await first).toEqual({ busy: false, value: "first" });
    expect(await readJobState("push.demo")).toMatchObject({ lastTrigger: "cron", lastStatus: "success" });
  });

  it("runs the job again once the earlier run has finished", async () => {
    await runJob("push.demo", "cron", async () => "a");

    expect(await runJob("push.demo", "cron", async () => "b")).toEqual({ busy: false, value: "b" });
  });

  it("lets different jobs run at the same time", async () => {
    const release = gate();
    const entered = gate();
    const first = runJob("push.demo-a", "cron", async () => {
      entered.open();
      await release.opened;
    });
    await entered.opened;

    const other = await runJob("push.demo-b", "cron", async () => "b");
    release.open();
    await first;

    expect(other).toEqual({ busy: false, value: "b" });
  });

  it("starts exactly one of two simultaneous runs", async () => {
    let started = 0;
    const results = await concurrently(2, () =>
      runJob("push.demo", "cron", async () => {
        started += 1;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }),
    );

    expect(started).toBe(1);
    expect(results.map((r) => (r.status === "fulfilled" ? r.value.busy : "rejected")).sort()).toEqual([false, true]);
  });

  it("frees the lock and rethrows when the job fails, recording the failure", async () => {
    await expect(runJob("push.demo", "cron", async () => { throw new Error("boom"); })).rejects.toThrow("boom");

    expect(await runJob("push.demo", "cron", async () => "again")).toEqual({ busy: false, value: "again" });
    expect(await readJobState("push.demo")).toMatchObject({ lastStatus: "success", lastError: "boom" });
  });
});
