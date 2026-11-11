import { db } from "../../infra/db";
import type { Executor } from "../../infra/db/tx";
import { auditedAtomic, prepareAudit, recordOperation } from "../../shared/audit/recorder";
import { eq, and, gte, lte, desc, count, sql } from "drizzle-orm";
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
    return tx.transaction(async (t) => {
      await t.execute(sql`select set_config('app.audit_clock_insert', 'ordinary', true)`);
      const [record] = await t.insert(clockRecords).values(data).returning();
      return record;
    });
  },

  async createManualClockRecord(data: InsertClockRecord, tx: Executor = db): Promise<ClockRecord> {
    return auditedAtomic(tx, async (t) => {
      await prepareAudit(t, true);
      const [record] = await t.insert(clockRecords).values(data).returning();
      await recordOperation(t, { entity: "clock_records", recordId: record.id, employeeId: record.employeeId, action: "create", after: record });
      return record;
    });
  },

  async updateAdminClockRecord(id: number, data: Partial<InsertClockRecord>, tx: Executor = db): Promise<ClockRecord | undefined> {
    return auditedAtomic(tx, async (t) => {
      await prepareAudit(t, true);
      const [before] = await t.select().from(clockRecords).where(eq(clockRecords.id, id)).for("update");
      if (!before) return undefined;
      const [record] = await t.update(clockRecords).set(data).where(eq(clockRecords.id, id)).returning();
      await recordOperation(t, { entity: "clock_records", recordId: id, employeeId: record.employeeId, action: "update", before, after: record });
      return record;
    });
  },

  async deleteAdminClockRecord(id: number, tx: Executor = db): Promise<boolean> {
    return auditedAtomic(tx, async (t) => {
      await prepareAudit(t);
      const [before] = await t.select().from(clockRecords).where(eq(clockRecords.id, id)).for("update");
      if (!before) return false;
      await t.delete(clockRecords).where(eq(clockRecords.id, id));
      await recordOperation(t, { entity: "clock_records", recordId: id, employeeId: before.employeeId, action: "delete", before });
      return true;
    });
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

  /** Moves a pending amendment to its reviewed status. Undefined means it was not pending, so someone else already reviewed it (or it does not exist). */
  async reviewPendingAmendment(id: number, status: string, reviewedBy: number, reviewedByName: string, reviewNote?: string, tx: Executor = db): Promise<ClockAmendment | undefined> {
    return auditedAtomic(tx, async (t) => {
    await prepareAudit(t);
    const [before] = await t.select().from(clockAmendments).where(eq(clockAmendments.id, id)).for("update");
    const [record] = await t.update(clockAmendments).set({
      status,
      reviewedBy,
      reviewedByName,
      reviewedAt: new Date(),
      reviewNote: reviewNote || null,
    }).where(and(eq(clockAmendments.id, id), eq(clockAmendments.status, "pending"))).returning();
    if (record) await recordOperation(t, { entity: "clock_amendments", recordId: id, employeeId: record.employeeId, action: status === "approved" ? "approve" : "reject", before, after: record });
    return record;
    });
  },

  async updateClockRecordReason(id: number, earlyArrivalReason?: string, lateDepartureReason?: string, tx: Executor = db): Promise<ClockRecord | undefined> {
    const updates: Record<string, any> = {};
    if (earlyArrivalReason !== undefined) updates.earlyArrivalReason = earlyArrivalReason;
    if (lateDepartureReason !== undefined) updates.lateDepartureReason = lateDepartureReason;
    if (Object.keys(updates).length === 0) return undefined;
    return auditedAtomic(tx, async (t) => {
      await prepareAudit(t);
      const [before] = await t.select().from(clockRecords).where(eq(clockRecords.id, id)).for("update");
      const [record] = await t.update(clockRecords).set(updates).where(eq(clockRecords.id, id)).returning();
      if (record) await recordOperation(t, { entity: "clock_records", recordId: id, employeeId: record.employeeId, action: "reason_update", before, after: record });
      return record;
    });
  },

  async applyClockRecordAmendment(clockRecordId: number, amendedTime: Date, amendmentId: number, newFailReason: string | null, tx: Executor = db): Promise<ClockRecord | undefined> {
    return auditedAtomic(tx, async (t) => {
    await prepareAudit(t);
    const [before] = await t.select().from(clockRecords).where(eq(clockRecords.id, clockRecordId)).for("update");
    const [record] = await t.update(clockRecords).set({
      amendedTime,
      amendmentId,
      failReason: newFailReason,
    }).where(eq(clockRecords.id, clockRecordId)).returning();
    if (record) await recordOperation(t, { entity: "clock_records", recordId: clockRecordId, employeeId: record.employeeId, action: "amend", before, after: record });
    return record;
    });
  },

  async countPendingAmendments(tx: Executor = db): Promise<number> {
    const [row] = await tx.select({ cnt: count() }).from(clockAmendments).where(eq(clockAmendments.status, "pending"));
    return Number(row?.cnt ?? 0);
  },
};
