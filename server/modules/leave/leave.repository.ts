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

  /** Moves a pending request to its reviewed status. Undefined means it was not pending, so someone else already reviewed it (or it does not exist). */
  async reviewPendingRequest(id: number, status: string, reviewedBy: number, reviewedByName: string, reviewNote?: string, tx: Executor = db): Promise<LeaveRequest | undefined> {
    const [row] = await tx.update(leaveRequests)
      .set({ status, reviewedBy, reviewedByName, reviewNote: reviewNote || null, reviewedAt: new Date() })
      .where(and(eq(leaveRequests.id, id), eq(leaveRequests.status, "pending")))
      .returning();
    return row;
  },

  async getLeaveBalance(employeeId: number, year: number, tx: Executor = db): Promise<EmployeeLeaveBalance | undefined> {
    const [row] = await tx.select().from(employeeLeaveBalances)
      .where(and(eq(employeeLeaveBalances.employeeId, employeeId), eq(employeeLeaveBalances.year, year)));
    return row;
  },

  /** Sets the year's total in one statement, creating the row if there is none; used and pending hours are kept. */
  async upsertLeaveBalance(employeeId: number, year: number, totalHours: number, tx: Executor = db): Promise<EmployeeLeaveBalance> {
    const [row] = await tx.insert(employeeLeaveBalances)
      .values({ employeeId, year, totalHours, usedHours: 0, pendingHours: 0 })
      .onConflictDoUpdate({ target: [employeeLeaveBalances.employeeId, employeeLeaveBalances.year], set: { totalHours, updatedAt: new Date() } })
      .returning();
    return row;
  },

  // The hour columns are float4, where 4 - 2.67 is not 1.33. Hours are whole hundredths, so each statement computes in numeric and rounds to two decimals.
  /** Adds hours (zero or more) to the year's pending hours, creating the row if there is none. False when the hours were negative. */
  async adjustLeaveBalancePending(employeeId: number, year: number, hours: number, tx: Executor = db): Promise<boolean> {
    const { rows } = await tx.execute(
      sql`INSERT INTO employee_leave_balances (employee_id, year, total_hours, used_hours, pending_hours, updated_at)
       SELECT ${employeeId}, ${year}, 0, 0, ${hours}::real, NOW() WHERE ${hours}::real >= 0
       ON CONFLICT (employee_id, year) DO UPDATE
       SET pending_hours = round(employee_leave_balances.pending_hours::numeric + ${hours}::numeric, 2)::real,
           updated_at = NOW()
       RETURNING id`,
    );
    return rows.length > 0;
  },

  /** Turns pending hours into used hours. False when the row is missing or holds fewer pending hours than that, and then nothing changes. */
  async adjustLeaveBalanceOnApprove(employeeId: number, year: number, hours: number, tx: Executor = db): Promise<boolean> {
    const { rows } = await tx.execute(
      sql`UPDATE employee_leave_balances
       SET pending_hours = round(pending_hours::numeric - ${hours}::numeric, 2)::real,
           used_hours = round(used_hours::numeric + ${hours}::numeric, 2)::real,
           updated_at = NOW()
       WHERE employee_id = ${employeeId} AND year = ${year} AND round(pending_hours::numeric, 2) >= round(${hours}::numeric, 2)
       RETURNING id`,
    );
    return rows.length > 0;
  },

  /** Gives pending hours back. False when the row is missing or holds fewer pending hours than that, and then nothing changes. */
  async adjustLeaveBalanceOnReject(employeeId: number, year: number, hours: number, tx: Executor = db): Promise<boolean> {
    const { rows } = await tx.execute(
      sql`UPDATE employee_leave_balances
       SET pending_hours = round(pending_hours::numeric - ${hours}::numeric, 2)::real,
           updated_at = NOW()
       WHERE employee_id = ${employeeId} AND year = ${year} AND round(pending_hours::numeric, 2) >= round(${hours}::numeric, 2)
       RETURNING id`,
    );
    return rows.length > 0;
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
