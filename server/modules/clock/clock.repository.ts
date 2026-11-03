import { db } from "../../infra/db";
import type { Executor } from "../../infra/db/tx";
import { eq, and, gte, lte, desc, count } from "drizzle-orm";
import {
  clockRecords,
  clockAmendments,
  idempotencyKeys,
  type ClockRecord,
  type InsertClockRecord,
  type ClockAmendment,
  type InsertClockAmendment,
} from "@shared/schema";

export const clockRepository = {
  /** Reserve (scope, key). False means it was reserved before, and its stored answer should be returned instead of acting again. */
  async claimIdempotencyKey(scope: string, key: string, tx: Executor = db): Promise<boolean> {
    const claimed = await tx.insert(idempotencyKeys).values({ scope, key }).onConflictDoNothing().returning({ key: idempotencyKeys.key });
    return claimed.length > 0;
  },

  async getIdempotencyResult(scope: string, key: string, tx: Executor = db): Promise<unknown> {
    const [row] = await tx
      .select({ result: idempotencyKeys.result })
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
    return row?.result ?? undefined;
  },

  async storeIdempotencyResult(scope: string, key: string, result: unknown, tx: Executor = db): Promise<void> {
    await tx.update(idempotencyKeys).set({ result }).where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
  },

  async createClockRecord(data: InsertClockRecord, tx: Executor = db): Promise<ClockRecord> {
    const [record] = await tx.insert(clockRecords).values(data).returning();
    return record;
  },

  async getClockRecord(id: number, tx: Executor = db): Promise<ClockRecord | undefined> {
    const [record] = await tx.select().from(clockRecords).where(eq(clockRecords.id, id));
    return record;
  },

  async getClockRecordsByDateRange(startDate: string, endDate: string, tx: Executor = db): Promise<ClockRecord[]> {
    return tx.select().from(clockRecords).where(
      and(
        gte(clockRecords.clockTime, new Date(startDate + "T00:00:00+08:00")),
        lte(clockRecords.clockTime, new Date(endDate + "T23:59:59+08:00"))
      )
    ).orderBy(desc(clockRecords.clockTime));
  },

  async getClockRecordsByEmployee(employeeId: number, startDate: string, endDate: string, tx: Executor = db): Promise<ClockRecord[]> {
    return tx.select().from(clockRecords).where(
      and(
        eq(clockRecords.employeeId, employeeId),
        gte(clockRecords.clockTime, new Date(startDate + "T00:00:00+08:00")),
        lte(clockRecords.clockTime, new Date(endDate + "T23:59:59+08:00"))
      )
    ).orderBy(desc(clockRecords.clockTime));
  },

  async createClockAmendment(data: InsertClockAmendment, tx: Executor = db): Promise<ClockAmendment> {
    const [record] = await tx.insert(clockAmendments).values(data).returning();
    return record;
  },

  async getClockAmendments(status?: string, tx: Executor = db): Promise<ClockAmendment[]> {
    if (status) {
      return tx.select().from(clockAmendments)
        .where(eq(clockAmendments.status, status))
        .orderBy(desc(clockAmendments.createdAt));
    }
    return tx.select().from(clockAmendments).orderBy(desc(clockAmendments.createdAt));
  },

  async getClockAmendmentsByEmployee(employeeId: number, tx: Executor = db): Promise<ClockAmendment[]> {
    return tx.select().from(clockAmendments)
      .where(eq(clockAmendments.employeeId, employeeId))
      .orderBy(desc(clockAmendments.createdAt));
  },

  async getClockAmendment(id: number, tx: Executor = db): Promise<ClockAmendment | undefined> {
    const [record] = await tx.select().from(clockAmendments).where(eq(clockAmendments.id, id));
    return record;
  },

  async updateClockAmendmentStatus(id: number, status: string, reviewedBy: number, reviewedByName: string, reviewNote?: string, tx: Executor = db): Promise<ClockAmendment | undefined> {
    const [record] = await tx.update(clockAmendments).set({
      status,
      reviewedBy,
      reviewedByName,
      reviewedAt: new Date(),
      reviewNote: reviewNote || null,
    }).where(eq(clockAmendments.id, id)).returning();
    return record;
  },

  async updateClockRecordReason(id: number, earlyArrivalReason?: string, lateDepartureReason?: string, tx: Executor = db): Promise<ClockRecord | undefined> {
    const updates: Record<string, any> = {};
    if (earlyArrivalReason !== undefined) updates.earlyArrivalReason = earlyArrivalReason;
    if (lateDepartureReason !== undefined) updates.lateDepartureReason = lateDepartureReason;
    if (Object.keys(updates).length === 0) return undefined;
    const [record] = await tx.update(clockRecords).set(updates).where(eq(clockRecords.id, id)).returning();
    return record;
  },

  async applyClockRecordAmendment(clockRecordId: number, amendedTime: Date, amendmentId: number, newFailReason: string | null, tx: Executor = db): Promise<ClockRecord | undefined> {
    const [record] = await tx.update(clockRecords).set({
      amendedTime,
      amendmentId,
      failReason: newFailReason,
    }).where(eq(clockRecords.id, clockRecordId)).returning();
    return record;
  },

  async countPendingAmendments(tx: Executor = db): Promise<number> {
    const [row] = await tx.select({ cnt: count() }).from(clockAmendments).where(eq(clockAmendments.status, "pending"));
    return Number(row?.cnt ?? 0);
  },
};
