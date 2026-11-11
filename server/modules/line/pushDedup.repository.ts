import { and, eq, gt, lt, or, sql } from "drizzle-orm";
import { db } from "../../infra/db";
import type { Executor } from "../../infra/db/tx";
import { pushDedup } from "@shared/schema";

export interface PushKey {
  scope: string;
  period: string;
  employeeId: number;
  refId: string;
}

/** timestamp without time zone is stored as UTC, independent of Node and DB session time zones. */
const utcNow = sql`(now() at time zone 'UTC')`;

export interface PushClaim {
  attempt: number;
  /** An existing failed or stale pending slot was taken over, rather than first created. */
  reclaimed: boolean;
}

export const pushDedupRepository = {
  /**
   * One statement claims a new/failed slot or a pending lease older than 10 minutes but newer than 20 hours.
   * Only a failed slot advances the attempt (and retry key). A pending takeover renews the same attempt.
   */
  async claim(key: PushKey, tx: Executor = db, reclaimPending = true): Promise<PushClaim | null> {
    const [row] = await tx
      .insert(pushDedup)
      .values({ ...key, status: "pending", attempts: 1, updatedAt: utcNow })
      .onConflictDoUpdate({
        target: [pushDedup.scope, pushDedup.period, pushDedup.employeeId, pushDedup.refId],
        set: {
          status: "pending",
          attempts: sql`case when ${pushDedup.status} = 'failed' then ${pushDedup.attempts} + 1 else ${pushDedup.attempts} end`,
          updatedAt: utcNow,
        },
        setWhere: or(
          eq(pushDedup.status, "failed"),
          and(
            sql`${reclaimPending}`,
            eq(pushDedup.status, "pending"),
            lt(pushDedup.updatedAt, sql`${utcNow} - interval '10 minutes'`),
            gt(pushDedup.updatedAt, sql`${utcNow} - interval '20 hours'`),
          ),
        ),
      })
      .returning({ attempt: pushDedup.attempts, reclaimed: sql<boolean>`(xmax <> 0)` });
    return row ?? null;
  },

  async finish(key: PushKey, status: "sent" | "failed", tx: Executor = db): Promise<void> {
    await tx
      .update(pushDedup)
      .set({ status, updatedAt: utcNow })
      .where(
        and(
          eq(pushDedup.scope, key.scope),
          eq(pushDedup.period, key.period),
          eq(pushDedup.employeeId, key.employeeId),
          eq(pushDedup.refId, key.refId),
          eq(pushDedup.status, "pending"),
        ),
      );
  },

  async deleteOlderThan(cutoff: Date, tx: Executor = db): Promise<void> {
    await tx.delete(pushDedup).where(lt(pushDedup.updatedAt, cutoff));
  },
};
