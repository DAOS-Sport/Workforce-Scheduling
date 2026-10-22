import { db } from "../../infra/db";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import {
  scheduleSlots,
  type ScheduleSlot,
  type InsertScheduleSlot,
} from "@shared/schema";
import { venueRepository } from "../venue/venue.repository";

export const scheduleSlotRepository = {
  async getScheduleSlotsByRegionAndDateRange(regionId: number, startDate: string, endDate: string): Promise<ScheduleSlot[]> {
    const regionVenues = await venueRepository.getVenuesByRegion(regionId);
    const venueIds = regionVenues.map((v) => v.id);
    if (venueIds.length === 0) return [];
    return db.select().from(scheduleSlots).where(
      and(
        inArray(scheduleSlots.venueId, venueIds),
        gte(scheduleSlots.date, startDate),
        lte(scheduleSlots.date, endDate)
      )
    );
  },

  async getScheduleSlotsByVenueAndDate(venueId: number, date: string): Promise<ScheduleSlot[]> {
    return db.select().from(scheduleSlots).where(
      and(
        eq(scheduleSlots.venueId, venueId),
        eq(scheduleSlots.date, date)
      )
    );
  },

  async createScheduleSlot(data: InsertScheduleSlot): Promise<ScheduleSlot> {
    const [slot] = await db.insert(scheduleSlots).values(data).returning();
    return slot;
  },

  async updateScheduleSlot(id: number, data: Partial<InsertScheduleSlot>): Promise<ScheduleSlot | undefined> {
    const [slot] = await db.update(scheduleSlots).set(data).where(eq(scheduleSlots.id, id)).returning();
    return slot;
  },

  async deleteScheduleSlot(id: number): Promise<boolean> {
    const result = await db.delete(scheduleSlots).where(eq(scheduleSlots.id, id)).returning();
    return result.length > 0;
  },

};
