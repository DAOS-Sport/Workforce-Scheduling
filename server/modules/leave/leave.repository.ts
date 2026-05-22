import { db } from "../../db";
import { eq, desc } from "drizzle-orm";
import {
  employees,
  leaveRequests,
  type LeaveRequest,
  type InsertLeaveRequest,
} from "@shared/schema";

async function assertEmployeeExists(employeeId: number, label: string): Promise<void> {
  const [employee] = await db.select({ id: employees.id }).from(employees).where(eq(employees.id, employeeId));
  if (!employee) throw new Error(`Invalid leave request ${label} ${employeeId}: employee does not exist`);
}

export const leaveRepository = {
  async createLeaveRequest(data: InsertLeaveRequest): Promise<LeaveRequest> {
    await assertEmployeeExists(data.employeeId, "employeeId");
    const [row] = await db.insert(leaveRequests).values(data).returning();
    return row;
  },

  async getLeaveRequests(status?: string): Promise<LeaveRequest[]> {
    if (status) {
      return db.select().from(leaveRequests).where(eq(leaveRequests.status, status)).orderBy(desc(leaveRequests.createdAt));
    }
    return db.select().from(leaveRequests).orderBy(desc(leaveRequests.createdAt));
  },

  async getLeaveRequestsByEmployee(employeeId: number): Promise<LeaveRequest[]> {
    return db.select().from(leaveRequests).where(eq(leaveRequests.employeeId, employeeId)).orderBy(desc(leaveRequests.createdAt));
  },

  async getLeaveRequest(id: number): Promise<LeaveRequest | undefined> {
    const [row] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, id));
    return row;
  },

  async updateLeaveRequestStatus(id: number, status: string, reviewedBy: number, reviewedByName: string, reviewNote?: string): Promise<LeaveRequest | undefined> {
    await assertEmployeeExists(reviewedBy, "reviewedBy");
    const [row] = await db.update(leaveRequests)
      .set({ status, reviewedBy, reviewedByName, reviewNote: reviewNote || null, reviewedAt: new Date() })
      .where(eq(leaveRequests.id, id))
      .returning();
    return row;
  },

};
