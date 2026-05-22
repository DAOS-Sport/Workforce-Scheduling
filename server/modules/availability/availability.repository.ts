import { db } from "../../db";
import { eq, and, gte, lte, inArray, sql } from "drizzle-orm";
import {
  employees,
  shiftAvailabilities,
  type ShiftAvailability,
  type InsertShiftAvailability,
} from "@shared/schema";

async function assertEmployeeExists(employeeId: number): Promise<void> {
  const [employee] = await db.select({ id: employees.id }).from(employees).where(eq(employees.id, employeeId));
  if (!employee) throw new Error(`Invalid availability employeeId ${employeeId}: employee does not exist`);
}

export const availabilityRepository = {
  async getByEmployeeAndYearMonth(employeeId: number, yearMonth: string): Promise<ShiftAvailability[]> {
    const start = `${yearMonth}-01`;
    const [y, m] = yearMonth.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;
    return db
      .select()
      .from(shiftAvailabilities)
      .where(
        and(
          eq(shiftAvailabilities.employeeId, employeeId),
          gte(shiftAvailabilities.date, start),
          lte(shiftAvailabilities.date, end)
        )
      );
  },

  async getByEmployeeIds(employeeIds: number[], yearMonth: string): Promise<ShiftAvailability[]> {
    if (employeeIds.length === 0) return [];
    const start = `${yearMonth}-01`;
    const [y, m] = yearMonth.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;
    return db
      .select()
      .from(shiftAvailabilities)
      .where(
        and(
          inArray(shiftAvailabilities.employeeId, employeeIds),
          gte(shiftAvailabilities.date, start),
          lte(shiftAvailabilities.date, end)
        )
      );
  },

  async create(data: InsertShiftAvailability): Promise<ShiftAvailability> {
    await assertEmployeeExists(data.employeeId);
    const [row] = await db.insert(shiftAvailabilities).values(data).returning();
    return row;
  },

  async delete(id: number): Promise<boolean> {
    const result = await db.delete(shiftAvailabilities).where(eq(shiftAvailabilities.id, id));
    return (result.rowCount ?? 0) > 0;
  },

  async getById(id: number): Promise<ShiftAvailability | undefined> {
    const [row] = await db.select().from(shiftAvailabilities).where(eq(shiftAvailabilities.id, id));
    return row;
  },

  async countOffRequestsInWeek(employeeId: number, weekStart: string, weekEnd: string): Promise<number> {
    const [row] = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(shiftAvailabilities)
      .where(
        and(
          eq(shiftAvailabilities.employeeId, employeeId),
          eq(shiftAvailabilities.entryType, "off_request"),
          gte(shiftAvailabilities.date, weekStart),
          lte(shiftAvailabilities.date, weekEnd)
        )
      );
    return row?.cnt ?? 0;
  },

  /** 計算某員工在指定年度中，特定假別的天數（leaveType 欄位） */
  async countOffRequestsByNoteAndYear(
    employeeId: number,
    leaveType: string,
    year: number
  ): Promise<number> {
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const [row] = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(shiftAvailabilities)
      .where(
        and(
          eq(shiftAvailabilities.employeeId, employeeId),
          eq(shiftAvailabilities.entryType, "off_request"),
          eq(shiftAvailabilities.leaveType, leaveType),
          gte(shiftAvailabilities.date, yearStart),
          lte(shiftAvailabilities.date, yearEnd)
        )
      );
    return row?.cnt ?? 0;
  },

  /** 取得某年月所有員工的意願填寫記錄（用於計算未填人員） */
  async getByYearMonth(yearMonth: string): Promise<ShiftAvailability[]> {
    const start = `${yearMonth}-01`;
    const [y, m] = yearMonth.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;
    return db
      .select()
      .from(shiftAvailabilities)
      .where(
        and(
          gte(shiftAvailabilities.date, start),
          lte(shiftAvailabilities.date, end)
        )
      );
  },

  /** 檢查同一員工在同一天是否已有任何填寫記錄（防止重複） */
  async existsOnDate(employeeId: number, date: string): Promise<boolean> {
    const [row] = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(shiftAvailabilities)
      .where(
        and(
          eq(shiftAvailabilities.employeeId, employeeId),
          eq(shiftAvailabilities.date, date)
        )
      );
    return (row?.cnt ?? 0) > 0;
  },
};
