import { db } from "../../infra/db";
import { eq, and, or, inArray } from "drizzle-orm";
import {
  employees,
  shifts,
  type Employee,
  type InsertEmployee,
} from "@shared/schema";

export const employeeRepository = {
  async getEmployeesByRegion(regionId: number): Promise<Employee[]> {
    return db.select().from(employees).where(eq(employees.regionId, regionId));
  },

  async getEmployeesForNeiQin(regionId: number): Promise<Employee[]> {
    const rows = await db.select().from(employees).where(
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

  async getAllEmployees(): Promise<Employee[]> {
    return db.select().from(employees);
  },

  async getEmployee(id: number): Promise<Employee | undefined> {
    const [emp] = await db.select().from(employees).where(eq(employees.id, id));
    return emp;
  },

  async createEmployee(data: InsertEmployee): Promise<Employee> {
    const [emp] = await db.insert(employees).values(data).returning();
    return emp;
  },

  async updateEmployee(id: number, data: Partial<InsertEmployee>): Promise<Employee | undefined> {
    const [emp] = await db.update(employees).set(data).where(eq(employees.id, id)).returning();
    return emp;
  },

  async getEmployeeByCode(code: string): Promise<Employee | undefined> {
    const [emp] = await db.select().from(employees).where(eq(employees.employeeCode, code));
    return emp;
  },

  async getEmployeeByLineId(lineId: string): Promise<Employee | undefined> {
    const [emp] = await db.select().from(employees).where(eq(employees.lineId, lineId));
    return emp;
  },

  async getCoworkersByVenueAndDate(venueId: number, date: string, excludeEmployeeId: number): Promise<Employee[]> {
    const venueShifts = await db.select().from(shifts).where(
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
    return db.select().from(employees).where(inArray(employees.id, uniqueIds));
  },

  async deleteEmployee(id: number): Promise<boolean> {
    const result = await db.delete(employees).where(eq(employees.id, id)).returning();
    return result.length > 0;
  },

};
