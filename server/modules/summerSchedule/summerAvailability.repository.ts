import { db } from "../../db";
import { eq, and } from "drizzle-orm";
import {
  summerAvailabilities,
  type SummerAvailability,
  type InsertSummerAvailability,
} from "@shared/schema";

export const summerAvailabilityRepository = {
  async getByEmployeeAndWeek(
    employeeId: number,
    weekNo: number
  ): Promise<SummerAvailability | undefined> {
    const [row] = await db
      .select()
      .from(summerAvailabilities)
      .where(
        and(
          eq(summerAvailabilities.employeeId, employeeId),
          eq(summerAvailabilities.weekNo, weekNo)
        )
      );
    return row;
  },

  async getAllByWeek(weekNo: number): Promise<SummerAvailability[]> {
    return db
      .select()
      .from(summerAvailabilities)
      .where(eq(summerAvailabilities.weekNo, weekNo));
  },

  async deleteByEmployeeAndWeek(employeeId: number, weekNo: number): Promise<number> {
    const rows = await db
      .delete(summerAvailabilities)
      .where(
        and(
          eq(summerAvailabilities.employeeId, employeeId),
          eq(summerAvailabilities.weekNo, weekNo)
        )
      )
      .returning({ id: summerAvailabilities.id });
    return rows.length;
  },

  async upsert(data: InsertSummerAvailability): Promise<SummerAvailability> {
    // JSONB columns with $type<> require an explicit cast due to Drizzle ORM
    // type inference limitations with createInsertSchema and JSONB arrays.
    const insertValue = {
      employeeId: data.employeeId,
      weekNo: data.weekNo,
      venueNames: (data.venueNames ?? []) as unknown as string[],
      weekdayDays: (data.weekdayDays ?? []) as unknown as number[],
      weekdaySlots: (data.weekdaySlots ?? []) as unknown as { startTime: string; endTime: string }[],
      satSlots: (data.satSlots ?? []) as unknown as { startTime: string; endTime: string }[],
      sunSlots: (data.sunSlots ?? []) as unknown as { startTime: string; endTime: string }[],
      notes: data.notes ?? null,
    };
    const [row] = await db
      .insert(summerAvailabilities)
      .values(insertValue)
      .onConflictDoUpdate({
        target: [summerAvailabilities.employeeId, summerAvailabilities.weekNo],
        set: {
          venueNames: insertValue.venueNames,
          weekdayDays: insertValue.weekdayDays,
          weekdaySlots: insertValue.weekdaySlots,
          satSlots: insertValue.satSlots,
          sunSlots: insertValue.sunSlots,
          notes: insertValue.notes,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  },
};
