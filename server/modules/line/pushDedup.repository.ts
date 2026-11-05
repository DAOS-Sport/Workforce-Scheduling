import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../../infra/db";
import type { Executor } from "../../infra/db/tx";
import { pushDedup } from "@shared/schema";

export interface PushKey {
  scope: string;
  period: string;
  employeeId: number;
  refId: string;
}

export const pushDedupRepository = {
  /**
   * Take the right to push. Returns the attempt number when this caller now holds it: the row is new, or a
   * `failed` one was moved back to `pending`. Null when the push was sent already, or is `pending` and may have gone out.
   * One statement, so two instances cannot both take the same failed row.
   */
  async claim(key: PushKey, tx: Executor = db): Promise<number | null> {
    const [row] = await tx
      .insert(pushDedup)
      .values({ ...key, status: "pending", attempts: 1 })
      .onConflictDoUpdate({
        target: [pushDedup.scope, pushDedup.period, pushDedup.employeeId, pushDedup.refId],
        set: { status: "pending", attempts: sql`${pushDedup.attempts} + 1`, updatedAt: new Date() },
        setWhere: eq(pushDedup.status, "failed"),
      })
      .returning({ attempts: pushDedup.attempts });
    return row?.attempts ?? null;
  },

  async finish(key: PushKey, status: "sent" | "failed", tx: Executor = db): Promise<void> {
    await tx
      .update(pushDedup)
      .set({ status, updatedAt: new Date() })
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
