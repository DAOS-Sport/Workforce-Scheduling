import { db } from "../../db";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import {
  clockRecords,
  employees,
  overtimeRequests,
  type OvertimeRequest,
  type InsertOvertimeRequest,
} from "@shared/schema";

async function assertEmployeeExists(employeeId: number, label: string): Promise<void> {
  const [employee] = await db.select({ id: employees.id }).from(employees).where(eq(employees.id, employeeId));
  if (!employee) throw new Error(`Invalid overtime request ${label} ${employeeId}: employee does not exist`);
}

async function assertClockRecordMatches(clockRecordId: number | null | undefined, employeeId: number): Promise<void> {
  if (clockRecordId == null) return;
  const [record] = await db.select({ id: clockRecords.id, employeeId: clockRecords.employeeId }).from(clockRecords).where(eq(clockRecords.id, clockRecordId));
  if (!record) throw new Error(`Invalid overtime request clockRecordId ${clockRecordId}: clock record does not exist`);
  if (record.employeeId !== employeeId) {
    throw new Error(`Invalid overtime request mapping: clockRecordId ${clockRecordId} belongs to employee ${record.employeeId}, not ${employeeId}`);
  }
}

export const overtimeRepository = {
  async createOvertimeRequest(data: InsertOvertimeRequest): Promise<OvertimeRequest> {
    await assertEmployeeExists(data.employeeId, "employeeId");
    await assertClockRecordMatches(data.clockRecordId, data.employeeId);
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
    await assertEmployeeExists(reviewedBy, "reviewedBy");
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
