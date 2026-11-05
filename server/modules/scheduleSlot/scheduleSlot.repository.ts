import { db } from "../../infra/db";
import type { Executor } from "../../infra/db/tx";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import {
  scheduleSlots,
  venues,
  type ScheduleSlot,
  type InsertScheduleSlot,
} from "@shared/schema";

export const scheduleSlotRepository = {
  async getScheduleSlotsByRegionAndDateRange(regionId: number, startDate: string, endDate: string, tx: Executor = db): Promise<ScheduleSlot[]> {
    return tx.select().from(scheduleSlots).where(
      and(
        inArray(scheduleSlots.venueId, tx.select({ id: venues.id }).from(venues).where(eq(venues.regionId, regionId))),
        gte(scheduleSlots.date, startDate),
        lte(scheduleSlots.date, endDate)
      )
    );
  },

  async getScheduleSlotsByVenueAndDate(venueId: number, date: string, tx: Executor = db): Promise<ScheduleSlot[]> {
    return tx.select().from(scheduleSlots).where(
      and(
        eq(scheduleSlots.venueId, venueId),
        eq(scheduleSlots.date, date)
      )
    );
  },

  async createScheduleSlot(data: InsertScheduleSlot, tx: Executor = db): Promise<ScheduleSlot> {
    const [slot] = await tx.insert(scheduleSlots).values(data).returning();
    return slot;
  },

  async updateScheduleSlot(id: number, data: Partial<InsertScheduleSlot>, tx: Executor = db): Promise<ScheduleSlot | undefined> {
    const [slot] = await tx.update(scheduleSlots).set(data).where(eq(scheduleSlots.id, id)).returning();
    return slot;
  },

  async deleteScheduleSlot(id: number, tx: Executor = db): Promise<boolean> {
    const result = await tx.delete(scheduleSlots).where(eq(scheduleSlots.id, id)).returning();
    return result.length > 0;
  },

};
