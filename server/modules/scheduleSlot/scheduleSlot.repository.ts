import { db } from "../../db";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import {
  scheduleSlots,
  venues,
  type ScheduleSlot,
  type InsertScheduleSlot,
} from "@shared/schema";
import { normalizeScheduleRole } from "@shared/scheduleMapping";
import { venueRepository } from "../venue/venue.repository";

function normalizeSlotRoleData<T extends Partial<InsertScheduleSlot>>(data: T): T {
  if (data.role === undefined) return data;
  return { ...data, role: normalizeScheduleRole(data.role) || data.role } as T;
}

async function assertVenueExists(venueId: number): Promise<void> {
  const [venue] = await db.select({ id: venues.id }).from(venues).where(eq(venues.id, venueId));
  if (!venue) throw new Error(`Invalid schedule slot venueId ${venueId}: venue does not exist`);
}

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
    const normalizedData = normalizeSlotRoleData(data);
    await assertVenueExists(normalizedData.venueId);
    const [slot] = await db.insert(scheduleSlots).values(normalizedData).returning();
    return slot;
  },

  async updateScheduleSlot(id: number, data: Partial<InsertScheduleSlot>): Promise<ScheduleSlot | undefined> {
    const normalizedData = normalizeSlotRoleData(data);
    if (normalizedData.venueId !== undefined) await assertVenueExists(normalizedData.venueId);
    const [slot] = await db.update(scheduleSlots).set(normalizedData).where(eq(scheduleSlots.id, id)).returning();
    return slot;
  },

  async deleteScheduleSlot(id: number): Promise<boolean> {
    const result = await db.delete(scheduleSlots).where(eq(scheduleSlots.id, id)).returning();
    return result.length > 0;
  },

};
