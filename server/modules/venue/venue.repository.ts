import { db, pool } from "../../db";
import { eq, inArray } from "drizzle-orm";
import {
  regions,
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
import { normalizeScheduleRole } from "@shared/scheduleMapping";

function normalizeTemplateRoleData<T extends Partial<InsertVenueShiftTemplate>>(data: T): T {
  if (data.role === undefined) return data;
  return { ...data, role: normalizeScheduleRole(data.role) || data.role } as T;
}

async function assertRegionExists(regionId: number): Promise<void> {
  const [region] = await db.select({ id: regions.id }).from(regions).where(eq(regions.id, regionId));
  if (!region) throw new Error(`Invalid venue regionId ${regionId}: region does not exist`);
}

async function assertVenueExists(venueId: number, label = "venueId"): Promise<void> {
  const [venue] = await db.select({ id: venues.id }).from(venues).where(eq(venues.id, venueId));
  if (!venue) throw new Error(`Invalid ${label} ${venueId}: venue does not exist`);
}

async function assertVenueRegionChangeSafe(venueId: number, nextRegionId: number): Promise<void> {
  const result = await pool.query<{ source: string; id: number; expected_region_id: number }>(
    `
      select 'shifts' as source, s.id, e.region_id as expected_region_id
      from shifts s
      join employees e on e.id = s.employee_id
      where s.venue_id = $1
        and s.status = 'active'
        and s.date >= current_date
        and e.region_id <> $2
      union all
      select 'dispatch_shifts' as source, d.id, d.region_id as expected_region_id
      from dispatch_shifts d
      where d.venue_id = $1
        and d.status <> 'cancelled'
        and d.date >= current_date
        and d.region_id <> $2
      order by source, id
      limit 20
    `,
    [venueId, nextRegionId],
  );
  if (result.rows.length > 0) {
    const summary = result.rows.map((row) => `${row.source}#${row.id}->region ${row.expected_region_id}`).join(", ");
    const error = new Error(`Cannot change venue ${venueId} region to ${nextRegionId}: future assignments are mapped to other regions (${summary})`);
    (error as Error & { status?: number }).status = 409;
    throw error;
  }
}

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
    await assertRegionExists(data.regionId);
    const [venue] = await db.insert(venues).values(data).returning();
    return venue;
  },

  async updateVenue(id: number, data: Partial<InsertVenue>): Promise<Venue | undefined> {
    if (data.regionId !== undefined) {
      await assertRegionExists(data.regionId);
      await assertVenueRegionChangeSafe(id, data.regionId);
    }
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
    await assertVenueExists(data.venueId, "venue requirement venueId");
    const [req] = await db.insert(venueRequirements).values(data).returning();
    return req;
  },

  async getVenueShiftTemplates(venueId: number): Promise<VenueShiftTemplate[]> {
    return db.select().from(venueShiftTemplates).where(eq(venueShiftTemplates.venueId, venueId));
  },

  async createVenueShiftTemplate(data: InsertVenueShiftTemplate): Promise<VenueShiftTemplate> {
    const normalizedData = normalizeTemplateRoleData(data);
    await assertVenueExists(normalizedData.venueId, "venue shift template venueId");
    const [t] = await db.insert(venueShiftTemplates).values(normalizedData).returning();
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
