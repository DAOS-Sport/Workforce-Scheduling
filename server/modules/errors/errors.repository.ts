import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { appErrors, type AppErrorRow, type InsertAppError } from "@shared/schema";
import { db } from "../../infra/db";
import type { Executor } from "../../infra/db/tx";

export interface ErrorFilter {
  requestId?: string;
  since?: Date | string;
  limit: number;
}

export const errorsRepository = {
  async insert(row: InsertAppError, tx: Executor = db): Promise<void> {
    await tx.insert(appErrors).values(row);
  },

  async list({ requestId, since, limit }: ErrorFilter, tx: Executor = db): Promise<AppErrorRow[]> {
    const conditions = [
      requestId ? eq(appErrors.requestId, requestId) : undefined,
      since ? gte(appErrors.occurredAt, typeof since === "string" ? sql`${since}::timestamptz` : since) : undefined,
    ];
    return tx
      .select()
      .from(appErrors)
      .where(and(...conditions))
      .orderBy(desc(appErrors.occurredAt), desc(appErrors.id))
      .limit(limit);
  },

  async oldestOccurredAt(tx: Executor = db): Promise<Date | null> {
    const [row] = await tx.select({ occurredAt: appErrors.occurredAt }).from(appErrors).orderBy(asc(appErrors.occurredAt)).limit(1);
    return row?.occurredAt ?? null;
  },

  async deleteBefore(before: Date, tx: Executor = db): Promise<number> {
    const result = await tx.delete(appErrors).where(lt(appErrors.occurredAt, before));
    return result.rowCount ?? 0;
  },
};
