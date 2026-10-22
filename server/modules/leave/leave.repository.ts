import { db } from "../../infra/db";
import type { Executor } from "../../infra/db/tx";
import { eq, and, desc, getTableColumns, sql, count } from "drizzle-orm";
import {
  leaveRequests,
  employeeLeaveBalances,
  leaveBalanceLogs,
  employees,
  type LeaveRequest,
  type InsertLeaveRequest,
  type EmployeeLeaveBalance,
} from "@shared/schema";

export const leaveRepository = {
  async createLeaveRequest(data: InsertLeaveRequest, tx: Executor = db): Promise<LeaveRequest> {
    const [row] = await tx.insert(leaveRequests).values(data).returning();
    return row;
  },

  async getLeaveRequests(status?: string, tx: Executor = db): Promise<LeaveRequest[]> {
    if (status) {
      return tx.select().from(leaveRequests).where(eq(leaveRequests.status, status)).orderBy(desc(leaveRequests.createdAt));
    }
    return tx.select().from(leaveRequests).orderBy(desc(leaveRequests.createdAt));
  },

  async getLeaveRequestsByEmployee(employeeId: number, tx: Executor = db): Promise<LeaveRequest[]> {
    return tx.select().from(leaveRequests).where(eq(leaveRequests.employeeId, employeeId)).orderBy(desc(leaveRequests.createdAt));
  },

  async getLeaveRequest(id: number, tx: Executor = db): Promise<LeaveRequest | undefined> {
    const [row] = await tx.select().from(leaveRequests).where(eq(leaveRequests.id, id));
    return row;
  },

  async updateLeaveRequestStatus(id: number, status: string, reviewedBy: number, reviewedByName: string, reviewNote?: string, tx: Executor = db): Promise<LeaveRequest | undefined> {
    const [row] = await tx.update(leaveRequests)
      .set({ status, reviewedBy, reviewedByName, reviewNote: reviewNote || null, reviewedAt: new Date() })
      .where(eq(leaveRequests.id, id))
      .returning();
    return row;
  },

  async getLeaveBalance(employeeId: number, year: number, tx: Executor = db): Promise<EmployeeLeaveBalance | undefined> {
    const [row] = await tx.select().from(employeeLeaveBalances)
      .where(and(eq(employeeLeaveBalances.employeeId, employeeId), eq(employeeLeaveBalances.year, year)));
    return row;
  },

  async upsertLeaveBalance(employeeId: number, year: number, totalHours: number, tx: Executor = db): Promise<EmployeeLeaveBalance> {
    const existing = await leaveRepository.getLeaveBalance(employeeId, year, tx);
    if (existing) {
      const [row] = await tx.update(employeeLeaveBalances)
        .set({ totalHours, updatedAt: new Date() })
        .where(and(eq(employeeLeaveBalances.employeeId, employeeId), eq(employeeLeaveBalances.year, year)))
        .returning();
      return row;
    }
    const [row] = await tx.insert(employeeLeaveBalances)
      .values({ employeeId, year, totalHours, usedHours: 0, pendingHours: 0 })
      .returning();
    return row;
  },

  async adjustLeaveBalancePending(employeeId: number, year: number, delta: number, tx: Executor = db): Promise<void> {
    await tx.execute(
      sql`INSERT INTO employee_leave_balances (employee_id, year, total_hours, used_hours, pending_hours, updated_at)
       VALUES (${employeeId}, ${year}, 0, 0, GREATEST(0, ${delta}::real), NOW())
       ON CONFLICT (employee_id, year) DO UPDATE
       SET pending_hours = GREATEST(0, employee_leave_balances.pending_hours + ${delta}::real),
           updated_at = NOW()`,
    );
  },

  async adjustLeaveBalanceOnApprove(employeeId: number, year: number, hours: number, tx: Executor = db): Promise<void> {
    await tx.execute(
      sql`UPDATE employee_leave_balances
       SET pending_hours = GREATEST(0, pending_hours - ${hours}::real),
           used_hours = used_hours + ${hours}::real,
           updated_at = NOW()
       WHERE employee_id = ${employeeId} AND year = ${year}`,
    );
  },

  async adjustLeaveBalanceOnReject(employeeId: number, year: number, hours: number, tx: Executor = db): Promise<void> {
    await tx.execute(
      sql`UPDATE employee_leave_balances
       SET pending_hours = GREATEST(0, pending_hours - ${hours}::real),
           updated_at = NOW()
       WHERE employee_id = ${employeeId} AND year = ${year}`,
    );
  },

  async getAllLeaveBalances(year: number, tx: Executor = db): Promise<(EmployeeLeaveBalance & { employeeName: string; employeeCode: string })[]> {
    return tx
      .select({ ...getTableColumns(employeeLeaveBalances), employeeName: employees.name, employeeCode: employees.employeeCode })
      .from(employeeLeaveBalances)
      .innerJoin(employees, eq(employees.id, employeeLeaveBalances.employeeId))
      .where(eq(employeeLeaveBalances.year, year))
      .orderBy(employees.name);
  },

  async appendLeaveBalanceLog(
    employeeId: number,
    year: number,
    delta: number,
    reason: string,
    leaveRequestId?: number,
    operatedBy?: number,
    operatedByName?: string,
    tx: Executor = db,
  ): Promise<void> {
    await tx.insert(leaveBalanceLogs).values({
      employeeId,
      year,
      delta,
      reason,
      leaveRequestId: leaveRequestId ?? null,
      operatedBy: operatedBy ?? null,
      operatedByName: operatedByName ?? null,
    });
  },
  async countPendingRequests(tx: Executor = db): Promise<number> {
    const [row] = await tx.select({ cnt: count() }).from(leaveRequests).where(eq(leaveRequests.status, "pending"));
    return Number(row?.cnt ?? 0);
  },
};
