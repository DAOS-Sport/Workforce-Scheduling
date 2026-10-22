import { db } from "../../infra/db";
import type { Executor } from "../../infra/db/tx";
import { eq, inArray } from "drizzle-orm";
import {
  venues,
  venueRequirements,
  venueShiftTemplates,
  type Venue,
  type InsertVenue,
  type VenueRequirement,
  type VenueShiftTemplate,
  type InsertVenueShiftTemplate,
} from "@shared/schema";

export const venueRepository = {
  async getVenuesByRegion(regionId: number, tx: Executor = db): Promise<Venue[]> {
    return tx.select().from(venues).where(eq(venues.regionId, regionId));
  },

  async getAllVenues(tx: Executor = db): Promise<Venue[]> {
    return tx.select().from(venues);
  },

  async getVenue(id: number, tx: Executor = db): Promise<Venue | undefined> {
    const [venue] = await tx.select().from(venues).where(eq(venues.id, id));
    return venue;
  },

  async createVenue(data: InsertVenue, tx: Executor = db): Promise<Venue> {
    const [venue] = await tx.insert(venues).values(data).returning();
    return venue;
  },

  async updateVenue(id: number, data: Partial<InsertVenue>, tx: Executor = db): Promise<Venue | undefined> {
    const [venue] = await tx.update(venues).set(data).where(eq(venues.id, id)).returning();
    return venue;
  },

  async getVenueRequirementsByRegion(regionId: number, tx: Executor = db): Promise<VenueRequirement[]> {
    const regionVenues = await venueRepository.getVenuesByRegion(regionId, tx);
    const venueIds = regionVenues.map((v) => v.id);
    if (venueIds.length === 0) return [];

    return tx.select().from(venueRequirements).where(
      inArray(venueRequirements.venueId, venueIds)
    );
  },

  async getVenueShiftTemplates(venueId: number, tx: Executor = db): Promise<VenueShiftTemplate[]> {
    return tx.select().from(venueShiftTemplates).where(eq(venueShiftTemplates.venueId, venueId));
  },

  async createVenueShiftTemplate(data: InsertVenueShiftTemplate, tx: Executor = db): Promise<VenueShiftTemplate> {
    const [t] = await tx.insert(venueShiftTemplates).values(data).returning();
    return t;
  },

  async deleteVenueShiftTemplate(id: number, tx: Executor = db): Promise<boolean> {
    const result = await tx.delete(venueShiftTemplates).where(eq(venueShiftTemplates.id, id)).returning();
    return result.length > 0;
  },

  async deleteVenueShiftTemplatesByVenue(venueId: number, tx: Executor = db): Promise<void> {
    await tx.delete(venueShiftTemplates).where(eq(venueShiftTemplates.venueId, venueId));
  },

};
