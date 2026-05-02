import { db } from "../../db";
import { eq, desc } from "drizzle-orm";
import {
  leaveRequests,
  type LeaveRequest,
  type InsertLeaveRequest,
} from "@shared/schema";

export const leaveRepository = {
  async createLeaveRequest(data: InsertLeaveRequest): Promise<LeaveRequest> {
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
    const [row] = await db.update(leaveRequests)
      .set({ status, reviewedBy, reviewedByName, reviewNote: reviewNote || null, reviewedAt: new Date() })
      .where(eq(leaveRequests.id, id))
      .returning();
    return row;
  },

};
