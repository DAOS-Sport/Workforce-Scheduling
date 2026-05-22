import { db, pool } from "../../db";
import { eq, and, or, inArray } from "drizzle-orm";
import {
  employees,
  regions,
  shifts,
  type Employee,
  type InsertEmployee,
} from "@shared/schema";

async function assertRegionExists(regionId: number): Promise<void> {
  const [region] = await db.select({ id: regions.id }).from(regions).where(eq(regions.id, regionId));
  if (!region) throw new Error(`Invalid employee regionId ${regionId}: region does not exist`);
}

async function assertEmployeeCanBeDeleted(employeeId: number): Promise<void> {
  const result = await pool.query<{ source: string; count: string }>(
    `
      select source, count(*)::text
      from (
        select 'shifts' as source from shifts where employee_id = $1
        union all
        select 'dispatch_shifts' as source from dispatch_shifts where linked_employee_id = $1
        union all
        select 'clock_records' as source from clock_records where employee_id = $1
        union all
        select 'clock_amendments' as source from clock_amendments where employee_id = $1 or reviewed_by = $1
        union all
        select 'overtime_requests' as source from overtime_requests where employee_id = $1 or reviewed_by = $1
        union all
        select 'leave_requests' as source from leave_requests where employee_id = $1 or reviewed_by = $1
        union all
        select 'outing_records' as source from outing_records where employee_id = $1
        union all
        select 'shift_availabilities' as source from shift_availabilities where employee_id = $1
        union all
        select 'guideline_acknowledgments' as source from guideline_acknowledgments where employee_id = $1
        union all
        select 'missing_clock_notifications' as source from missing_clock_notifications where employee_id = $1
        union all
        select 'weekly_push_notifications' as source from weekly_push_notifications where employee_id = $1
        union all
        select 'announcements' as source from announcements where created_by = $1
        union all
        select 'anomaly_reports' as source from anomaly_reports where employee_id = $1
      ) refs
      group by source
      order by source
    `,
    [employeeId],
  );
  const dependencies = result.rows.filter((row) => Number(row.count) > 0);
  if (dependencies.length > 0) {
    const summary = dependencies.map((row) => `${row.source}=${row.count}`).join(", ");
    const error = new Error(`Cannot delete employee ${employeeId}: dependent records exist (${summary}). Set status to inactive instead.`);
    (error as Error & { status?: number }).status = 409;
    throw error;
  }
}

async function assertEmployeeRegionChangeSafe(employeeId: number, nextRegionId: number): Promise<void> {
  const result = await pool.query<{ source: string; id: number; expected_region_id: number }>(
    `
      select 'shifts' as source, s.id, v.region_id as expected_region_id
      from shifts s
      join venues v on v.id = s.venue_id
      where s.employee_id = $1
        and s.status = 'active'
        and s.date >= current_date
        and v.region_id <> $2
      union all
      select 'dispatch_shifts' as source, d.id, v.region_id as expected_region_id
      from dispatch_shifts d
      join venues v on v.id = d.venue_id
      where d.linked_employee_id = $1
        and d.status <> 'cancelled'
        and d.date >= current_date
        and v.region_id <> $2
      order by source, id
      limit 20
    `,
    [employeeId, nextRegionId],
  );
  if (result.rows.length > 0) {
    const summary = result.rows.map((row) => `${row.source}#${row.id}->region ${row.expected_region_id}`).join(", ");
    const error = new Error(`Cannot change employee ${employeeId} region to ${nextRegionId}: future assignments belong to other venue regions (${summary})`);
    (error as Error & { status?: number }).status = 409;
    throw error;
  }
}

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
    await assertRegionExists(data.regionId);
    const [emp] = await db.insert(employees).values(data).returning();
    return emp;
  },

  async updateEmployee(id: number, data: Partial<InsertEmployee>): Promise<Employee | undefined> {
    if (data.regionId !== undefined) {
      await assertRegionExists(data.regionId);
      await assertEmployeeRegionChangeSafe(id, data.regionId);
    }
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
    await assertEmployeeCanBeDeleted(id);
    const result = await db.delete(employees).where(eq(employees.id, id)).returning();
    return result.length > 0;
  },

};
