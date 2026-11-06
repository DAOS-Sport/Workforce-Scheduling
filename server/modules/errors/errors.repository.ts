import { and, desc, eq, gte, lt } from "drizzle-orm";
import { appErrors, type AppErrorRow, type InsertAppError } from "@shared/schema";
import { db } from "../../infra/db";
import type { Executor } from "../../infra/db/tx";

export interface ErrorFilter {
  requestId?: string;
  since?: Date;
  limit: number;
}

export const errorsRepository = {
  async insert(row: InsertAppError, tx: Executor = db): Promise<void> {
    await tx.insert(appErrors).values(row);
  },

  async list({ requestId, since, limit }: ErrorFilter, tx: Executor = db): Promise<AppErrorRow[]> {
    const conditions = [requestId ? eq(appErrors.requestId, requestId) : undefined, since ? gte(appErrors.occurredAt, since) : undefined];
    return tx
      .select()
      .from(appErrors)
      .where(and(...conditions))
      .orderBy(desc(appErrors.occurredAt), desc(appErrors.id))
      .limit(limit);
  },

  async deleteBefore(before: Date, tx: Executor = db): Promise<number> {
    const result = await tx.delete(appErrors).where(lt(appErrors.occurredAt, before));
    return result.rowCount ?? 0;
  },
};
