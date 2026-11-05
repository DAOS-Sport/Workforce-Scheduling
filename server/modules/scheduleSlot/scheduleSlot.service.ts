/**
 * Schedule-slot service.
 *
 * Owns:
 *  - Multi-region read with per-(venue,date) virtual-slot synthesis from
 *    venue_shift_templates (so the scheduling UI sees a complete grid even
 *    when only templates exist).
 *  - Materialization (template → real slots) with explicit exclusion list.
 *  - Batch-copy across multiple venues with same-key dedupe.
 *  - Venue-shift-template CRUD + batch replace (validates the whole batch,
 *    then deletes and inserts in one transaction).
 *
 * Materialize, batch-copy and batch-replace run under the venue's slot lock
 * (LOCK_NS.venueSlots), re-read inside it, and write in one transaction.
 */
import {
  insertScheduleSlotSchema,
  insertVenueShiftTemplateSchema,
  type Venue,
  type ScheduleSlot,
  type InsertScheduleSlot,
  type InsertVenueShiftTemplate,
} from "@shared/schema";
import { LOCK_NS, lockXact, lockXactAscending, withTx } from "../../infra/db/tx";
import { regionService } from "../region/region.service";
import { scheduleSlotRepository } from "./scheduleSlot.repository";
import { venueService } from "../venue/venue.service";
import { httpError } from "../../shared/errors";

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
      const region = await regionService.findByCode(code);
      if (!region) continue;
      const realSlots = await scheduleSlotRepository.getScheduleSlotsByRegionAndDateRange(region.id, startDate, endDate);
      for (const s of realSlots) {
        if (seenSlot.has(s.id)) continue;
        seenSlot.add(s.id);
        allRealSlots.push(s);
      }
      const regionVenues = await venueService.getVenuesByRegion(region.id);
      for (const v of regionVenues) {
        if (seenVenue.has(v.id)) continue;
        seenVenue.add(v.id);
        allRegionVenues.push(v);
      }
    }

    const allTemplates: Record<number, any[]> = {};
    for (const v of allRegionVenues) {
      const tpls = await venueService.getVenueShiftTemplates(v.id);
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
      throw httpError(400, "Missing venueId or date");
    }
    const venue = await venueService.getVenue(venueId);
    if (!venue) {
      throw httpError(404, "Venue not found");
    }
    return withTx(async (tx) => {
      await lockXact(tx, LOCK_NS.venueSlots, Number(venueId));
      const existingSlots = await scheduleSlotRepository.getScheduleSlotsByVenueAndDate(venueId, date, tx);
      if (existingSlots.length > 0) return { message: "Already has real slots", created: 0 };

      const templates = await venueService.getVenueShiftTemplates(venueId, tx);
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
        const slot = await scheduleSlotRepository.createScheduleSlot({
          venueId,
          date,
          startTime: t.startTime,
          endTime: t.endTime,
          role: t.role,
          requiredCount: t.requiredCount,
        }, tx);
        results.push(slot);
      }
      return { created: results.length, slots: results };
    });
  },

  async create(payload: unknown): Promise<ScheduleSlot> {
    const parsed = insertScheduleSlotSchema.parse(payload);
    return scheduleSlotRepository.createScheduleSlot(parsed);
  },

  async update(id: number, payload: unknown): Promise<ScheduleSlot | null> {
    const partial = insertScheduleSlotSchema.partial().parse(payload);
    return (await scheduleSlotRepository.updateScheduleSlot(id, partial as Partial<InsertScheduleSlot>)) ?? null;
  },

  remove: (id: number) => scheduleSlotRepository.deleteScheduleSlot(id),

  async batchCopy(payload: any) {
    const { venueId, venueIds, startTime, endTime, role, requiredCount, targetDates } = payload;
    const resolvedVenueIds: number[] = Array.isArray(venueIds) && venueIds.length > 0 ? venueIds : (venueId ? [venueId] : []);
    if (resolvedVenueIds.length === 0 || !startTime || !endTime || !role || !requiredCount || !Array.isArray(targetDates) || targetDates.length === 0) {
      throw httpError(400, "缺少必要欄位");
    }
    return withTx(async (tx) => {
      await lockXactAscending(tx, LOCK_NS.venueSlots, resolvedVenueIds.map(Number));
      const results: ScheduleSlot[] = [];
      let skipped = 0;
      for (const vid of resolvedVenueIds) {
        for (const date of targetDates) {
          const existing = await scheduleSlotRepository.getScheduleSlotsByVenueAndDate(vid, date, tx);
          const duplicate = existing.find(
            (s) => s.startTime === startTime && s.endTime === endTime && s.role === role,
          );
          if (duplicate) {
            skipped++;
            continue;
          }
          const slot = await scheduleSlotRepository.createScheduleSlot({ venueId: vid, date, startTime, endTime, role, requiredCount }, tx);
          results.push(slot);
        }
      }
      return { created: results.length, skipped, slots: results };
    });
  },

  async venueRequirementsByRegionCode(regionCode: string) {
    const region = await regionService.findByCode(regionCode);
    if (!region) return [];
    return venueService.getVenueRequirementsByRegion(region.id);
  },

  templatesByVenue: (venueId: number) => venueService.getVenueShiftTemplates(venueId),

  async createTemplate(payload: unknown) {
    const parsed = insertVenueShiftTemplateSchema.parse(payload);
    return venueService.createVenueShiftTemplate(parsed);
  },

  async batchReplaceTemplates(venueId: number, templates: any[]) {
    if (!Array.isArray(templates)) {
      throw httpError(400, "templates must be an array");
    }
    // 先整批檢查，有一筆格式錯就不動場館現有的模板。
    const parsed = templates.map((t) => insertVenueShiftTemplateSchema.parse({ ...t, venueId } satisfies InsertVenueShiftTemplate));
    return withTx(async (tx) => {
      await lockXact(tx, LOCK_NS.venueSlots, venueId);
      await venueService.deleteVenueShiftTemplatesByVenue(venueId, tx);
      const results = [];
      for (const row of parsed) {
        results.push(await venueService.createVenueShiftTemplate(row, tx));
      }
      return results;
    });
  },

  removeTemplate: (id: number) => venueService.deleteVenueShiftTemplate(id),

  getScheduleSlotsByVenueAndDate: scheduleSlotRepository.getScheduleSlotsByVenueAndDate,
};
