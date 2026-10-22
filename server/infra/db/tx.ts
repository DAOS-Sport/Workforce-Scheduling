import { sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type * as schema from "@shared/schema";
import { db, pool } from "./index";

/** Anything a repository can run a query on: the shared `db` or a transaction from `withTx`. */
export type Executor = PgDatabase<NodePgQueryResultHKT, typeof schema>;

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}

/** First key of every advisory lock, so employee 42 and venue 42 never share a lock. */
export const LOCK_NS = {
  clock: 101,
  leaveBalance: 102,
  shiftLabor: 103,
  shiftRegionMonth: 104,
  venueSlots: 105,
  summerWeek: 106,
  cramImport: 107,
  availability: 108,
  guidelineAck: 109,
  lineBinding: 110,
  ragicSync: 111,
  scheduledJob: 112,
  notificationRecipient: 113,
} as const;

export type LockNs = (typeof LOCK_NS)[keyof typeof LOCK_NS];

export type LockKey = number | string;

const keySql = (key: LockKey) => (typeof key === "string" ? sql`hashtext(${key})` : sql`${key}::int4`);

/** Blocks until this transaction holds (ns, key); released when the transaction commits or rolls back. */
export async function lockXact(tx: Tx, ns: LockNs, key: LockKey): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${ns}::int4, ${keySql(key)})`);
}

export type SessionLockResult<T> = { acquired: true; value: T } | { acquired: false };

/**
 * Runs fn only if (ns, key) is free, holding the lock on a dedicated connection
 * so fn can call external systems and open its own short transactions meanwhile.
 */
export async function withSessionLock<T>(ns: LockNs, key: LockKey, fn: () => Promise<T>): Promise<SessionLockResult<T>> {
  const keyParam = typeof key === "string" ? "hashtext($2)" : "$2::int4";
  const client = await pool.connect();
  let broken = false;
  try {
    const { rows } = await client.query<{ acquired: boolean }>(`select pg_try_advisory_lock($1::int4, ${keyParam}) as acquired`, [ns, key]);
    if (!rows[0].acquired) return { acquired: false };
    try {
      return { acquired: true, value: await fn() };
    } finally {
      try {
        await client.query(`select pg_advisory_unlock($1::int4, ${keyParam})`, [ns, key]);
      } catch (err) {
        broken = true;
        throw err;
      }
    }
  } finally {
    // A connection whose unlock failed may still hold the lock; destroy it rather than return it to the pool.
    client.release(broken);
  }
}
