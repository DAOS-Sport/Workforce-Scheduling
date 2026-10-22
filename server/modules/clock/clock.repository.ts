import { db } from "../../infra/db";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import {
  clockRecords,
  clockAmendments,
  type ClockRecord,
  type InsertClockRecord,
  type ClockAmendment,
  type InsertClockAmendment,
} from "@shared/schema";

export const clockRepository = {
  async createClockRecord(data: InsertClockRecord): Promise<ClockRecord> {
    const [record] = await db.insert(clockRecords).values(data).returning();
    return record;
  },

  async getClockRecord(id: number): Promise<ClockRecord | undefined> {
    const [record] = await db.select().from(clockRecords).where(eq(clockRecords.id, id));
    return record;
  },

  async getClockRecordsByDateRange(startDate: string, endDate: string): Promise<ClockRecord[]> {
    return db.select().from(clockRecords).where(
      and(
        gte(clockRecords.clockTime, new Date(startDate + "T00:00:00+08:00")),
        lte(clockRecords.clockTime, new Date(endDate + "T23:59:59+08:00"))
      )
    ).orderBy(desc(clockRecords.clockTime));
  },

  async getClockRecordsByEmployee(employeeId: number, startDate: string, endDate: string): Promise<ClockRecord[]> {
    return db.select().from(clockRecords).where(
      and(
        eq(clockRecords.employeeId, employeeId),
        gte(clockRecords.clockTime, new Date(startDate + "T00:00:00+08:00")),
        lte(clockRecords.clockTime, new Date(endDate + "T23:59:59+08:00"))
      )
    ).orderBy(desc(clockRecords.clockTime));
  },

  async createClockAmendment(data: InsertClockAmendment): Promise<ClockAmendment> {
    const [record] = await db.insert(clockAmendments).values(data).returning();
    return record;
  },

  async getClockAmendments(status?: string): Promise<ClockAmendment[]> {
    if (status) {
      return db.select().from(clockAmendments)
        .where(eq(clockAmendments.status, status))
        .orderBy(desc(clockAmendments.createdAt));
    }
    return db.select().from(clockAmendments).orderBy(desc(clockAmendments.createdAt));
  },

  async getClockAmendmentsByEmployee(employeeId: number): Promise<ClockAmendment[]> {
    return db.select().from(clockAmendments)
      .where(eq(clockAmendments.employeeId, employeeId))
      .orderBy(desc(clockAmendments.createdAt));
  },

  async getClockAmendment(id: number): Promise<ClockAmendment | undefined> {
    const [record] = await db.select().from(clockAmendments).where(eq(clockAmendments.id, id));
    return record;
  },

  async updateClockAmendmentStatus(id: number, status: string, reviewedBy: number, reviewedByName: string, reviewNote?: string): Promise<ClockAmendment | undefined> {
    const [record] = await db.update(clockAmendments).set({
      status,
      reviewedBy,
      reviewedByName,
      reviewedAt: new Date(),
      reviewNote: reviewNote || null,
    }).where(eq(clockAmendments.id, id)).returning();
    return record;
  },

  async updateClockRecordReason(id: number, earlyArrivalReason?: string, lateDepartureReason?: string): Promise<ClockRecord | undefined> {
    const updates: Record<string, any> = {};
    if (earlyArrivalReason !== undefined) updates.earlyArrivalReason = earlyArrivalReason;
    if (lateDepartureReason !== undefined) updates.lateDepartureReason = lateDepartureReason;
    if (Object.keys(updates).length === 0) return undefined;
    const [record] = await db.update(clockRecords).set(updates).where(eq(clockRecords.id, id)).returning();
    return record;
  },

  async applyClockRecordAmendment(clockRecordId: number, amendedTime: Date, amendmentId: number, newFailReason: string | null): Promise<ClockRecord | undefined> {
    const [record] = await db.update(clockRecords).set({
      amendedTime,
      amendmentId,
      failReason: newFailReason,
    }).where(eq(clockRecords.id, clockRecordId)).returning();
    return record;
  },

};
