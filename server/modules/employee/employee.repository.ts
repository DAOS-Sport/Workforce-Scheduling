import { db } from "../../infra/db";
import type { Executor } from "../../infra/db/tx";
import { eq, and, or, inArray } from "drizzle-orm";
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

  async getEmployeeByLineId(lineId: string, tx: Executor = db): Promise<Employee | undefined> {
    const [emp] = await tx.select().from(employees).where(eq(employees.lineId, lineId));
    return emp;
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
