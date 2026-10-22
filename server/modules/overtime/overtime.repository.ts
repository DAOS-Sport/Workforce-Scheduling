import { db } from "../../infra/db";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import {
  overtimeRequests,
  type OvertimeRequest,
  type InsertOvertimeRequest,
} from "@shared/schema";

export const overtimeRepository = {
  async createOvertimeRequest(data: InsertOvertimeRequest): Promise<OvertimeRequest> {
    const [record] = await db.insert(overtimeRequests).values(data).returning();
    return record;
  },

  async getOvertimeRequests(status?: string): Promise<OvertimeRequest[]> {
    if (status) {
      return db.select().from(overtimeRequests)
        .where(eq(overtimeRequests.status, status))
        .orderBy(desc(overtimeRequests.createdAt));
    }
    return db.select().from(overtimeRequests).orderBy(desc(overtimeRequests.createdAt));
  },

  async getOvertimeRequestsByEmployee(employeeId: number): Promise<OvertimeRequest[]> {
    return db.select().from(overtimeRequests)
      .where(eq(overtimeRequests.employeeId, employeeId))
      .orderBy(desc(overtimeRequests.createdAt));
  },

  async getOvertimeRequest(id: number): Promise<OvertimeRequest | undefined> {
    const [record] = await db.select().from(overtimeRequests).where(eq(overtimeRequests.id, id));
    return record;
  },

  async updateOvertimeRequestStatus(id: number, status: string, reviewedBy: number, reviewedByName: string, reviewNote?: string): Promise<OvertimeRequest | undefined> {
    const [record] = await db.update(overtimeRequests).set({
      status,
      reviewedBy,
      reviewedByName,
      reviewedAt: new Date(),
      reviewNote: reviewNote || null,
    }).where(eq(overtimeRequests.id, id)).returning();
    return record;
  },

  async getOvertimeRequestsByEmployeeAndDate(employeeId: number, date: string): Promise<OvertimeRequest[]> {
    return db.select().from(overtimeRequests).where(
      and(
        eq(overtimeRequests.employeeId, employeeId),
        eq(overtimeRequests.date, date)
      )
    );
  },

  async getApprovedOvertimeByDateRange(startDate: string, endDate: string): Promise<OvertimeRequest[]> {
    return db.select().from(overtimeRequests).where(
      and(
        eq(overtimeRequests.status, "approved"),
        gte(overtimeRequests.date, startDate),
        lte(overtimeRequests.date, endDate)
      )
    );
  },

};
