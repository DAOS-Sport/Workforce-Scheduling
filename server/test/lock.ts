import { LOCK_NS, lockXact, withTx, type LockKey } from "../infra/db/tx";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Holds (ns, key) in an open transaction, starts `operation`, and reports whether it finished while the
 * lock was still held. An operation that takes that lock must not have; one that does not will have.
 */
export async function runWhileLockHeld(ns: (typeof LOCK_NS)[keyof typeof LOCK_NS], key: LockKey, operation: () => Promise<unknown>, holdMs = 250) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let acquired!: () => void;
  const held = new Promise<void>((resolve) => (acquired = resolve));
  const holder = withTx(async (tx) => {
    await lockXact(tx, ns, key);
    acquired();
    await gate;
  });
  await held;

  let finished = false;
  const running = operation().then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason) => ({ status: "rejected" as const, reason }),
  );
  void running.then(() => (finished = true));
  await sleep(holdMs);
  const finishedWhileHeld = finished;
  release();
  await holder;
  return { finishedWhileHeld, outcome: await running };
}
