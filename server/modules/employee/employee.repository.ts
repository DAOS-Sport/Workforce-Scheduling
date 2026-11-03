import { db } from "../../infra/db";
import type { Executor } from "../../infra/db/tx";
import { eq, and, or, inArray, isNull, sql } from "drizzle-orm";
import {
  employees,
  shifts,
  type Employee,
  type InsertEmployee,
} from "@shared/schema";

export const employeeRepository = {
  async getEmployeesByRegion(regionId: number, tx: Executor = db): Promise<Employee[]> {
    return tx.select().from(employees).where(eq(employees.regionId, regionId));
  },

  async getEmployeesForNeiQin(regionId: number, tx: Executor = db): Promise<Employee[]> {
    const rows = await tx.select().from(employees).where(
      or(
        eq(employees.regionId, regionId),
        eq(employees.department, "營運管理處")
      )
    );
    const seen = new Set<number>();
    return rows.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
  },

  async getAllEmployees(tx: Executor = db): Promise<Employee[]> {
    return tx.select().from(employees);
  },

  async getEmployee(id: number, tx: Executor = db): Promise<Employee | undefined> {
    const [emp] = await tx.select().from(employees).where(eq(employees.id, id));
    return emp;
  },

  async createEmployee(data: InsertEmployee, tx: Executor = db): Promise<Employee> {
    const [emp] = await tx.insert(employees).values(data).returning();
    return emp;
  },

  async updateEmployee(id: number, data: Partial<InsertEmployee>, tx: Executor = db): Promise<Employee | undefined> {
    const [emp] = await tx.update(employees).set(data).where(eq(employees.id, id)).returning();
    return emp;
  },

  async getEmployeeByCode(code: string, tx: Executor = db): Promise<Employee | undefined> {
    const [emp] = await tx.select().from(employees).where(eq(employees.employeeCode, code));
    return emp;
  },

  /** The record a LINE account stands for: an active one first, then the lowest id (decision D1). */
  async getEmployeeByLineId(lineId: string, tx: Executor = db): Promise<Employee | undefined> {
    const [emp] = await tx
      .select()
      .from(employees)
      .where(eq(employees.lineId, lineId))
      .orderBy(sql`(${employees.status} = 'active') desc`, employees.id)
      .limit(1);
    return emp;
  },

  /**
   * Bind a LINE account to an active employee, only if no other LINE account holds the record. The
   * condition is evaluated on the row after any concurrent binder has committed, so of two accounts
   * racing for one record exactly one gets a row back.
   */
  async bindLineIdIfFree(id: number, lineId: string, tx: Executor = db): Promise<Employee | undefined> {
    const [emp] = await tx
      .update(employees)
      .set({ lineId })
      .where(
        and(
          eq(employees.id, id),
          eq(employees.status, "active"),
          or(isNull(employees.lineId), sql`${employees.lineId} !~ '^U[0-9a-f]{32}$'`, eq(employees.lineId, lineId)),
        ),
      )
      .returning();
    return emp;
  },

  /** Every record bound to this LINE account, lowest id first. One person can have an old inactive record and a new one. */
  async getEmployeesByLineId(lineId: string, tx: Executor = db): Promise<Employee[]> {
    return tx.select().from(employees).where(eq(employees.lineId, lineId)).orderBy(employees.id);
  },

  async getCoworkersByVenueAndDate(venueId: number, date: string, excludeEmployeeId: number, tx: Executor = db): Promise<Employee[]> {
    const venueShifts = await tx.select().from(shifts).where(
      and(
        eq(shifts.venueId, venueId),
        eq(shifts.date, date),
        eq(shifts.status, "active")
      )
    );
    const coworkerIds = venueShifts
      .map((s) => s.employeeId)
      .filter((id) => id !== excludeEmployeeId);
    if (coworkerIds.length === 0) return [];
    const uniqueIds = Array.from(new Set(coworkerIds));
    return tx.select().from(employees).where(inArray(employees.id, uniqueIds));
  },

  async deleteEmployee(id: number, tx: Executor = db): Promise<boolean> {
    const result = await tx.delete(employees).where(eq(employees.id, id)).returning();
    return result.length > 0;
  },

};
