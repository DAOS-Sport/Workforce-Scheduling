import { db } from "../../db";
import { eq, inArray } from "drizzle-orm";
import {
  venues,
  venueRequirements,
  venueShiftTemplates,
  type Venue,
  type InsertVenue,
  type VenueRequirement,
  type InsertVenueRequirement,
  type VenueShiftTemplate,
  type InsertVenueShiftTemplate,
} from "@shared/schema";

export const venueRepository = {
  async getVenuesByRegion(regionId: number): Promise<Venue[]> {
    return db.select().from(venues).where(eq(venues.regionId, regionId));
  },

  async getAllVenues(): Promise<Venue[]> {
    return db.select().from(venues);
  },

  async getVenue(id: number): Promise<Venue | undefined> {
    const [venue] = await db.select().from(venues).where(eq(venues.id, id));
    return venue;
  },

  async createVenue(data: InsertVenue): Promise<Venue> {
    const [venue] = await db.insert(venues).values(data).returning();
    return venue;
  },

  async updateVenue(id: number, data: Partial<InsertVenue>): Promise<Venue | undefined> {
    const [venue] = await db.update(venues).set(data).where(eq(venues.id, id)).returning();
    return venue;
  },

  async getVenueRequirementsByRegion(regionId: number): Promise<VenueRequirement[]> {
    const regionVenues = await this.getVenuesByRegion(regionId);
    const venueIds = regionVenues.map((v) => v.id);
    if (venueIds.length === 0) return [];

    return db.select().from(venueRequirements).where(
      inArray(venueRequirements.venueId, venueIds)
    );
  },

  async createVenueRequirement(data: InsertVenueRequirement): Promise<VenueRequirement> {
    const [req] = await db.insert(venueRequirements).values(data).returning();
    return req;
  },

  async getVenueShiftTemplates(venueId: number): Promise<VenueShiftTemplate[]> {
    return db.select().from(venueShiftTemplates).where(eq(venueShiftTemplates.venueId, venueId));
  },

  async createVenueShiftTemplate(data: InsertVenueShiftTemplate): Promise<VenueShiftTemplate> {
    const [t] = await db.insert(venueShiftTemplates).values(data).returning();
    return t;
  },

  async deleteVenueShiftTemplate(id: number): Promise<boolean> {
    const result = await db.delete(venueShiftTemplates).where(eq(venueShiftTemplates.id, id)).returning();
    return result.length > 0;
  },

  async deleteVenueShiftTemplatesByVenue(venueId: number): Promise<void> {
    await db.delete(venueShiftTemplates).where(eq(venueShiftTemplates.venueId, venueId));
  },

};
