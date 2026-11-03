import { and, eq } from "drizzle-orm";
import { idempotencyKeys } from "@shared/schema";
import type { Executor } from "./tx";

/**
 * Request keys (idempotency_keys): a resent write request finds the answer it got the first time
 * instead of writing again. Always call these inside the transaction that does the business write,
 * so a write that fails releases its key together with everything else.
 */

const MAX_KEY_LENGTH = 128;

/** A sender's request id, or undefined when it did not send a usable one (older pages send none). */
export function requestKeyOf(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_KEY_LENGTH ? value : undefined;
}

/**
 * Reserve (scope, key). False means it was reserved before. A second request with the same key
 * waits here until the first one's transaction ends, then gets false if it committed.
 */
export async function claimRequestKey(tx: Executor, scope: string, key: string): Promise<boolean> {
  const claimed = await tx.insert(idempotencyKeys).values({ scope, key }).onConflictDoNothing().returning({ key: idempotencyKeys.key });
  return claimed.length > 0;
}

/** The stored answer for (scope, key); with `lock`, the row stays locked until the transaction ends. */
export async function storedRequestResult(tx: Executor, scope: string, key: string, opts: { lock?: boolean } = {}): Promise<unknown> {
  const query = tx
    .select({ result: idempotencyKeys.result })
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
  const [row] = opts.lock ? await query.for("update") : await query;
  return row?.result ?? undefined;
}

export async function storeRequestResult(tx: Executor, scope: string, key: string, result: unknown): Promise<void> {
  await tx.update(idempotencyKeys).set({ result }).where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
}

/**
 * Run `write` once per (scope, key). A repeat returns the first answer as stored, which went through
 * JSON: dates in it come back as ISO strings. Without a key, `write` simply runs.
 */
export async function oncePerRequestKey<T>(
  tx: Executor,
  scope: string,
  key: string | undefined,
  write: () => Promise<T>,
): Promise<{ value: T; replayed: boolean }> {
  if (!key) return { value: await write(), replayed: false };
  if (!(await claimRequestKey(tx, scope, key))) {
    return { value: (await storedRequestResult(tx, scope, key)) as T, replayed: true };
  }
  const value = await write();
  await storeRequestResult(tx, scope, key, value);
  return { value, replayed: false };
}
