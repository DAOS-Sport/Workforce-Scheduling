/**
 * Venue service — CRUD + region-scoped lookup with multi-region de-dupe.
 *
 * The cache invalidation hook (line-webhook venue cache) is owned by the
 * service so any future caller (LINE, internal-api) cannot forget to call it.
 */
import { insertVenueSchema, type Venue, type InsertVenue } from "@shared/schema";
import { invalidateVenueCache } from "../clock/venueCache";
import { venueRepository } from "./venue.repository";
import { regionService } from "../region/region.service";

export const venueService = {
  findAll: () => venueRepository.getAllVenues(),

  async findByRegionCodes(regionCodeCsv: string): Promise<Venue[]> {
    const codes = regionCodeCsv.split(",").map((c) => c.trim()).filter(Boolean);
    const seen = new Set<number>();
    const out: Venue[] = [];
    for (const code of codes) {
      const region = await regionService.findByCode(code);
      if (!region) continue;
      const venues = await venueRepository.getVenuesByRegion(region.id);
      for (const v of venues) {
        if (seen.has(v.id)) continue;
        seen.add(v.id);
        out.push(v);
      }
    }
    return out;
  },

  async create(payload: unknown): Promise<Venue> {
    const parsed = insertVenueSchema.parse(payload);
    const venue = await venueRepository.createVenue(parsed);
    invalidateVenueCache();
    return venue;
  },

  async update(id: number, payload: unknown): Promise<Venue | null> {
    const partial = insertVenueSchema.partial().parse(payload);
    const venue = await venueRepository.updateVenue(id, partial as Partial<InsertVenue>);
    if (!venue) return null;
    invalidateVenueCache();
    return venue;
  },

  createVenue: venueRepository.createVenue,
  createVenueShiftTemplate: venueRepository.createVenueShiftTemplate,
  deleteVenueShiftTemplate: venueRepository.deleteVenueShiftTemplate,
  deleteVenueShiftTemplatesByVenue: venueRepository.deleteVenueShiftTemplatesByVenue,
  getVenue: venueRepository.getVenue,
  getVenueRequirementsByRegion: venueRepository.getVenueRequirementsByRegion,
  getVenueShiftTemplates: venueRepository.getVenueShiftTemplates,
  getVenuesByRegion: venueRepository.getVenuesByRegion,
};
