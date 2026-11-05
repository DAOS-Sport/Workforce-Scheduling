import { db } from "../../infra/db";
import type { Executor } from "../../infra/db/tx";
import { eq, and, gte, lte, desc, count } from "drizzle-orm";
import {
  overtimeRequests,
  type OvertimeRequest,
  type InsertOvertimeRequest,
} from "@shared/schema";

export const overtimeRepository = {
  async createOvertimeRequest(data: InsertOvertimeRequest, tx: Executor = db): Promise<OvertimeRequest> {
    const [record] = await tx.insert(overtimeRequests).values(data).returning();
    return record;
  },

  async getOvertimeRequests(status?: string, tx: Executor = db): Promise<OvertimeRequest[]> {
    if (status) {
      return tx.select().from(overtimeRequests)
        .where(eq(overtimeRequests.status, status))
        .orderBy(desc(overtimeRequests.createdAt));
    }
    return tx.select().from(overtimeRequests).orderBy(desc(overtimeRequests.createdAt));
  },

  async getOvertimeRequestsByEmployee(employeeId: number, tx: Executor = db): Promise<OvertimeRequest[]> {
    return tx.select().from(overtimeRequests)
      .where(eq(overtimeRequests.employeeId, employeeId))
      .orderBy(desc(overtimeRequests.createdAt));
  },

  async getOvertimeRequest(id: number, tx: Executor = db): Promise<OvertimeRequest | undefined> {
    const [record] = await tx.select().from(overtimeRequests).where(eq(overtimeRequests.id, id));
    return record;
  },

  /** Moves a pending request to its reviewed status. Undefined means it was not pending, so someone else already reviewed it (or it does not exist). */
  async reviewPendingRequest(id: number, status: string, reviewedBy: number, reviewedByName: string, reviewNote?: string, tx: Executor = db): Promise<OvertimeRequest | undefined> {
    const [record] = await tx.update(overtimeRequests).set({
      status,
      reviewedBy,
      reviewedByName,
      reviewedAt: new Date(),
      reviewNote: reviewNote || null,
    }).where(and(eq(overtimeRequests.id, id), eq(overtimeRequests.status, "pending"))).returning();
    return record;
  },

  async getOvertimeRequestsByEmployeeAndDate(employeeId: number, date: string, tx: Executor = db): Promise<OvertimeRequest[]> {
    return tx.select().from(overtimeRequests).where(
      and(
        eq(overtimeRequests.employeeId, employeeId),
        eq(overtimeRequests.date, date)
      )
    );
  },

  async getApprovedOvertimeByDateRange(startDate: string, endDate: string, tx: Executor = db): Promise<OvertimeRequest[]> {
    return tx.select().from(overtimeRequests).where(
      and(
        eq(overtimeRequests.status, "approved"),
        gte(overtimeRequests.date, startDate),
        lte(overtimeRequests.date, endDate)
      )
    );
  },

  async countPendingRequests(tx: Executor = db): Promise<number> {
    const [row] = await tx.select({ cnt: count() }).from(overtimeRequests).where(eq(overtimeRequests.status, "pending"));
    return Number(row?.cnt ?? 0);
  },
};
