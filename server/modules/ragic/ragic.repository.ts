import { and, inArray, lt, or, eq, sql } from "drizzle-orm";
import { db } from "../../infra/db";
import type { Executor } from "../../infra/db/tx";
import { ragicEmployeeStatus, ragicSyncEvents } from "@shared/schema";
import type { ImpliedStatus } from "../../core/ragic/employeeSync";

export type SyncEventSource = "webhook" | "cron" | "manual";

export const ragicRepository = {
  /** Record a request for a sync. False means this event id was recorded before. */
  async recordEvent(eventId: string, source: SyncEventSource, tx: Executor = db): Promise<boolean> {
    const rows = await tx.insert(ragicSyncEvents).values({ eventId, source }).onConflictDoNothing().returning({ eventId: ragicSyncEvents.eventId });
    return rows.length > 0;
  },

  async hasPendingEvents(tx: Executor = db): Promise<boolean> {
    const rows = await tx.select({ eventId: ragicSyncEvents.eventId }).from(ragicSyncEvents).where(eq(ragicSyncEvents.status, "pending")).limit(1);
    return rows.length > 0;
  },

  /**
   * Take every request that is not settled for the sync about to run: pending ones, failed ones to retry, and
   * `processing` ones left by a run that died. Call it only while holding the sync lock.
   */
  async claimOpenEvents(tx: Executor = db): Promise<string[]> {
    const rows = await tx
      .update(ragicSyncEvents)
      .set({ status: "processing" })
      .where(or(eq(ragicSyncEvents.status, "pending"), eq(ragicSyncEvents.status, "failed"), eq(ragicSyncEvents.status, "processing")))
      .returning({ eventId: ragicSyncEvents.eventId });
    return rows.map((r) => r.eventId);
  },

  async finishEvents(eventIds: string[], error: string | null, tx: Executor = db): Promise<void> {
    if (eventIds.length === 0) return;
    await tx
      .update(ragicSyncEvents)
      .set({ status: error === null ? "done" : "failed", processedAt: new Date(), error })
      .where(inArray(ragicSyncEvents.eventId, eventIds));
  },

  async purgeEventsDoneBefore(before: Date, tx: Executor = db): Promise<void> {
    await tx.delete(ragicSyncEvents).where(and(eq(ragicSyncEvents.status, "done"), lt(ragicSyncEvents.processedAt, before)));
  },

  async getObservedStatuses(tx: Executor = db): Promise<Map<string, ImpliedStatus>> {
    const rows = await tx.select().from(ragicEmployeeStatus);
    return new Map(rows.map((r) => [r.employeeCode, r.status as ImpliedStatus]));
  },

  async saveObservedStatuses(rows: Array<{ employeeCode: string; status: ImpliedStatus }>, tx: Executor = db): Promise<void> {
    if (rows.length === 0) return;
    await tx
      .insert(ragicEmployeeStatus)
      .values(rows)
      .onConflictDoUpdate({ target: ragicEmployeeStatus.employeeCode, set: { status: sql`excluded.status`, observedAt: sql`now()` } });
  },
};
