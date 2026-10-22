import { db, pool } from "../../infra/db";
import { eq, and, desc } from "drizzle-orm";
import {
  leaveRequests,
  employeeLeaveBalances,
  leaveBalanceLogs,
  type LeaveRequest,
  type InsertLeaveRequest,
  type EmployeeLeaveBalance,
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

  async getLeaveBalance(employeeId: number, year: number): Promise<EmployeeLeaveBalance | undefined> {
    const [row] = await db.select().from(employeeLeaveBalances)
      .where(and(eq(employeeLeaveBalances.employeeId, employeeId), eq(employeeLeaveBalances.year, year)));
    return row;
  },

  async upsertLeaveBalance(employeeId: number, year: number, totalHours: number): Promise<EmployeeLeaveBalance> {
    const existing = await this.getLeaveBalance(employeeId, year);
    if (existing) {
      const [row] = await db.update(employeeLeaveBalances)
        .set({ totalHours, updatedAt: new Date() })
        .where(and(eq(employeeLeaveBalances.employeeId, employeeId), eq(employeeLeaveBalances.year, year)))
        .returning();
      return row;
    }
    const [row] = await db.insert(employeeLeaveBalances)
      .values({ employeeId, year, totalHours, usedHours: 0, pendingHours: 0 })
      .returning();
    return row;
  },

  async adjustLeaveBalancePending(employeeId: number, year: number, delta: number): Promise<void> {
    await pool.query(
      `INSERT INTO employee_leave_balances (employee_id, year, total_hours, used_hours, pending_hours, updated_at)
       VALUES ($1, $2, 0, 0, GREATEST(0, $3::real), NOW())
       ON CONFLICT (employee_id, year) DO UPDATE
       SET pending_hours = GREATEST(0, employee_leave_balances.pending_hours + $3::real),
           updated_at = NOW()`,
      [employeeId, year, delta]
    );
  },

  async adjustLeaveBalanceOnApprove(employeeId: number, year: number, hours: number): Promise<void> {
    await pool.query(
      `UPDATE employee_leave_balances
       SET pending_hours = GREATEST(0, pending_hours - $3::real),
           used_hours = used_hours + $3::real,
           updated_at = NOW()
       WHERE employee_id = $1 AND year = $2`,
      [employeeId, year, hours]
    );
  },

  async adjustLeaveBalanceOnReject(employeeId: number, year: number, hours: number): Promise<void> {
    await pool.query(
      `UPDATE employee_leave_balances
       SET pending_hours = GREATEST(0, pending_hours - $3::real),
           updated_at = NOW()
       WHERE employee_id = $1 AND year = $2`,
      [employeeId, year, hours]
    );
  },

  async getAllLeaveBalances(year: number): Promise<(EmployeeLeaveBalance & { employeeName: string; employeeCode: string })[]> {
    const result = await pool.query<any>(
      `SELECT b.id, b.employee_id AS "employeeId", b.year, b.total_hours AS "totalHours",
              b.used_hours AS "usedHours", b.pending_hours AS "pendingHours",
              b.created_at AS "createdAt", b.updated_at AS "updatedAt",
              e.name AS "employeeName", e.employee_code AS "employeeCode"
       FROM employee_leave_balances b
       JOIN employees e ON e.id = b.employee_id
       WHERE b.year = $1
       ORDER BY e.name`,
      [year]
    );
    return result.rows;
  },

  async appendLeaveBalanceLog(
    employeeId: number,
    year: number,
    delta: number,
    reason: string,
    leaveRequestId?: number,
    operatedBy?: number,
    operatedByName?: string,
  ): Promise<void> {
    await db.insert(leaveBalanceLogs).values({
      employeeId,
      year,
      delta,
      reason,
      leaveRequestId: leaveRequestId ?? null,
      operatedBy: operatedBy ?? null,
      operatedByName: operatedByName ?? null,
    });
  },
};
