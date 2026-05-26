/**
 * Schedule-slot service.
 *
 * Owns:
 *  - Multi-region read with per-(venue,date) virtual-slot synthesis from
 *    venue_shift_templates (so the scheduling UI sees a complete grid even
 *    when only templates exist).
 *  - Materialization (template → real slots) with explicit exclusion list.
 *  - Batch-copy across multiple venues with same-key dedupe.
 *  - Venue-shift-template CRUD + atomic batch replace.
 */
import { storage } from "../../storage";
import {
  insertScheduleSlotSchema,
  insertVenueShiftTemplateSchema,
  type Venue,
  type ScheduleSlot,
  type InsertScheduleSlot,
  type InsertVenueShiftTemplate,
} from "@shared/schema";

export interface VirtualSlot {
  id: number;
  venueId: number;
  date: string;
  startTime: string;
  endTime: string;
  role: string;
  requiredCount: number;
  _fromTemplate: true;
}

export const scheduleSlotService = {
  async listSlotsForRegions(regionCodeCsv: string, startDate: string, endDate: string): Promise<(ScheduleSlot | VirtualSlot)[]> {
    const codes = regionCodeCsv.split(",").map((c) => c.trim()).filter(Boolean);
    const allRealSlots: ScheduleSlot[] = [];
    const allRegionVenues: Venue[] = [];
    const seenSlot = new Set<number>();
    const seenVenue = new Set<number>();

    for (const code of codes) {
      const region = await storage.getRegionByCode(code);
      if (!region) continue;
      const realSlots = await storage.getScheduleSlotsByRegionAndDateRange(region.id, startDate, endDate);
      for (const s of realSlots) {
        if (seenSlot.has(s.id)) continue;
        seenSlot.add(s.id);
        allRealSlots.push(s);
      }
      const regionVenues = await storage.getVenuesByRegion(region.id);
      for (const v of regionVenues) {
        if (seenVenue.has(v.id)) continue;
        seenVenue.add(v.id);
        allRegionVenues.push(v);
      }
    }

    const allTemplates: Record<number, any[]> = {};
    for (const v of allRegionVenues) {
      const tpls = await storage.getVenueShiftTemplates(v.id);
      if (tpls.length > 0) allTemplates[v.id] = tpls;
    }

    const realSlotDates = new Set<string>();
    allRealSlots.forEach((s) => realSlotDates.add(`${s.venueId}-${s.date}`));

    const virtualSlots: VirtualSlot[] = [];
    let virtualId = -1;

    const start = new Date(startDate + "T00:00:00");
    const end = new Date(endDate + "T00:00:00");
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const dateStr = `${year}-${month}-${day}`;
      const dayOfWeek = d.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

      for (const venue of allRegionVenues) {
        const key = `${venue.id}-${dateStr}`;
        if (realSlotDates.has(key)) continue;

        const tpls = allTemplates[venue.id];
        if (!tpls) continue;

        const matched = tpls.filter((t) => {
          const tDayType = t.dayType.toLowerCase();
          if (isWeekend) return tDayType === "weekend" || tDayType === "假日";
          return tDayType === "weekday" || tDayType === "平日";
        });
        for (const t of matched) {
          virtualSlots.push({
            id: virtualId--,
            venueId: venue.id,
            date: dateStr,
            startTime: t.startTime,
            endTime: t.endTime,
            role: t.role,
            requiredCount: t.requiredCount,
            _fromTemplate: true,
          });
        }
      }
    }

    return [...allRealSlots, ...virtualSlots];
  },

  async materialize(payload: any) {
    const { venueId, date, excludeTemplateIds } = payload;
    if (!venueId || !date) {
      const err: any = new Error("Missing venueId or date");
      err.status = 400;
      throw err;
    }
    const venue = await storage.getVenue(venueId);
    if (!venue) {
      const err: any = new Error("Venue not found");
      err.status = 404;
      throw err;
    }
    const existingSlots = await storage.getScheduleSlotsByRegionAndDateRange(venue.regionId, date, date);
    const hasReal = existingSlots.some((s) => s.venueId === venueId);
    if (hasReal) return { message: "Already has real slots", created: 0 };

    const templates = await storage.getVenueShiftTemplates(venueId);
    const d = new Date(date + "T00:00:00");
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const matched = templates.filter((t) => {
      const dt = t.dayType.toLowerCase();
      return isWeekend ? (dt === "weekend" || dt === "假日") : (dt === "weekday" || dt === "平日");
    });

    const excludeSlots = (excludeTemplateIds || []) as Array<{ startTime: string; endTime: string; role: string }>;
    const results: ScheduleSlot[] = [];
    for (const t of matched) {
      const isExcluded = excludeSlots.some(
        (ex) => ex.startTime === t.startTime && ex.endTime === t.endTime && ex.role === t.role,
      );
      if (isExcluded) continue;
      const slot = await storage.createScheduleSlot({
        venueId,
        date,
        startTime: t.startTime,
        endTime: t.endTime,
        role: t.role,
        requiredCount: t.requiredCount,
      });
      results.push(slot);
    }
    return { created: results.length, slots: results };
  },

  async create(payload: unknown): Promise<ScheduleSlot> {
    const parsed = insertScheduleSlotSchema.parse(payload);
    return storage.createScheduleSlot(parsed);
  },

  async update(id: number, payload: unknown): Promise<ScheduleSlot | null> {
    const partial = insertScheduleSlotSchema.partial().parse(payload);
    return (await storage.updateScheduleSlot(id, partial as Partial<InsertScheduleSlot>)) ?? null;
  },

  remove: (id: number) => storage.deleteScheduleSlot(id),

  async batchCopy(payload: any) {
    const { venueId, venueIds, startTime, endTime, role, requiredCount, targetDates } = payload;
    const resolvedVenueIds: number[] = Array.isArray(venueIds) && venueIds.length > 0 ? venueIds : (venueId ? [venueId] : []);
    if (resolvedVenueIds.length === 0 || !startTime || !endTime || !role || !requiredCount || !Array.isArray(targetDates) || targetDates.length === 0) {
      const err: any = new Error("缺少必要欄位");
      err.status = 400;
      throw err;
    }
    const results: ScheduleSlot[] = [];
    let skipped = 0;
    for (const vid of resolvedVenueIds) {
      for (const date of targetDates) {
        const existing = await storage.getScheduleSlotsByVenueAndDate(vid, date);
        const duplicate = existing.find(
          (s) => s.startTime === startTime && s.endTime === endTime && s.role === role,
        );
        if (duplicate) {
          skipped++;
          continue;
        }
        const slot = await storage.createScheduleSlot({ venueId: vid, date, startTime, endTime, role, requiredCount });
        results.push(slot);
      }
    }
    return { created: results.length, skipped, slots: results };
  },

  async venueRequirementsByRegionCode(regionCode: string) {
    const region = await storage.getRegionByCode(regionCode);
    if (!region) return [];
    return storage.getVenueRequirementsByRegion(region.id);
  },

  templatesByVenue: (venueId: number) => storage.getVenueShiftTemplates(venueId),

  async createTemplate(payload: unknown) {
    const parsed = insertVenueShiftTemplateSchema.parse(payload);
    return storage.createVenueShiftTemplate(parsed);
  },

  async batchReplaceTemplates(venueId: number, templates: any[]) {
    if (!Array.isArray(templates)) {
      const err: any = new Error("templates must be an array");
      err.status = 400;
      throw err;
    }
    await storage.deleteVenueShiftTemplatesByVenue(venueId);
    const results = [];
    for (const t of templates) {
      const parsed = insertVenueShiftTemplateSchema.parse({ ...t, venueId } satisfies InsertVenueShiftTemplate);
      results.push(await storage.createVenueShiftTemplate(parsed));
    }
    return results;
  },

  removeTemplate: (id: number) => storage.deleteVenueShiftTemplate(id),
};
