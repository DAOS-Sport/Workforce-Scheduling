import { type Express } from "express";
import { type Server } from "http";
import { storage } from "../../storage";
import { insertScheduleSlotSchema, insertVenueShiftTemplateSchema, type Venue, type ScheduleSlot } from "@shared/schema";

export function mountScheduleSlotRoutes(httpServer: Server, app: Express): void {
  app.get("/api/schedule-slots/:regionCode/:startDate/:endDate", async (req, res) => {
  const { regionCode, startDate, endDate } = req.params;
  const codes = regionCode.split(",").map(c => c.trim()).filter(Boolean);
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

  const virtualSlots: any[] = [];
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

  res.json([...allRealSlots, ...virtualSlots]);
});

app.post("/api/schedule-slots/materialize", async (req, res) => {
  try {
    const { venueId, date, excludeTemplateIds } = req.body;
    if (!venueId || !date) return res.status(400).json({ message: "Missing venueId or date" });

    const venue = await storage.getVenue(venueId);
    if (!venue) return res.status(404).json({ message: "Venue not found" });
    const existingSlots = await storage.getScheduleSlotsByRegionAndDateRange(venue.regionId, date, date);
    const hasReal = existingSlots.some((s) => s.venueId === venueId);
    if (hasReal) return res.json({ message: "Already has real slots", created: 0 });

    const templates = await storage.getVenueShiftTemplates(venueId);
    const d = new Date(date + "T00:00:00");
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const matched = templates.filter((t) => {
      const dt = t.dayType.toLowerCase();
      return isWeekend ? (dt === "weekend" || dt === "假日") : (dt === "weekday" || dt === "平日");
    });

    const excludeSlots = (excludeTemplateIds || []) as Array<{startTime: string; endTime: string; role: string}>;
    const results = [];
    for (const t of matched) {
      const isExcluded = excludeSlots.some((ex: any) => 
        ex.startTime === t.startTime && ex.endTime === t.endTime && ex.role === t.role
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
    res.json({ created: results.length, slots: results });
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});

app.post("/api/schedule-slots", async (req, res) => {
  try {
    const parsed = insertScheduleSlotSchema.parse(req.body);
    const slot = await storage.createScheduleSlot(parsed);
    res.json(slot);
  } catch (err: any) {
    if (err.name === "ZodError") {
      return res.status(400).json({ message: "資料格式錯誤" });
    }
    res.status(400).json({ message: err.message });
  }
});

app.patch("/api/schedule-slots/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const partial = insertScheduleSlotSchema.partial().parse(req.body);
    const slot = await storage.updateScheduleSlot(id, partial);
    if (!slot) return res.status(404).json({ message: "Slot not found" });
    res.json(slot);
  } catch (err: any) {
    if (err.name === "ZodError") {
      return res.status(400).json({ message: "資料格式錯誤" });
    }
    res.status(400).json({ message: err.message });
  }
});

app.delete("/api/schedule-slots/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const deleted = await storage.deleteScheduleSlot(id);
  if (!deleted) return res.status(404).json({ message: "Slot not found" });
  res.json({ success: true });
});

app.post("/api/schedule-slots/batch-copy", async (req, res) => {
  try {
    const { venueId, venueIds, startTime, endTime, role, requiredCount, targetDates } = req.body;
    const resolvedVenueIds: number[] = Array.isArray(venueIds) && venueIds.length > 0 ? venueIds : (venueId ? [venueId] : []);
    if (resolvedVenueIds.length === 0 || !startTime || !endTime || !role || !requiredCount || !Array.isArray(targetDates) || targetDates.length === 0) {
      return res.status(400).json({ message: "缺少必要欄位" });
    }
    const results: any[] = [];
    let skipped = 0;
    for (const vid of resolvedVenueIds) {
      for (const date of targetDates) {
        const existing = await storage.getScheduleSlotsByVenueAndDate(vid, date);
        const duplicate = existing.find(s => s.startTime === startTime && s.endTime === endTime && s.role === role);
        if (duplicate) {
          skipped++;
          continue;
        }
        const slot = await storage.createScheduleSlot({ venueId: vid, date, startTime, endTime, role, requiredCount });
        results.push(slot);
      }
    }
    res.json({ created: results.length, skipped, slots: results });
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});

app.get("/api/venue-requirements/:regionCode", async (req, res) => {
  const { regionCode } = req.params;
  const region = await storage.getRegionByCode(regionCode);
  if (!region) return res.json([]);
  const requirements = await storage.getVenueRequirementsByRegion(region.id);
  res.json(requirements);
});

app.get("/api/venue-shift-templates/:venueId", async (req, res) => {
  const venueId = parseInt(req.params.venueId);
  const templates = await storage.getVenueShiftTemplates(venueId);
  res.json(templates);
});

app.post("/api/venue-shift-templates", async (req, res) => {
  try {
    const parsed = insertVenueShiftTemplateSchema.parse(req.body);
    const template = await storage.createVenueShiftTemplate(parsed);
    res.json(template);
  } catch (err: any) {
    if (err.name === "ZodError") {
      return res.status(400).json({ message: "資料格式錯誤" });
    }
    res.status(400).json({ message: err.message });
  }
});

app.post("/api/venue-shift-templates/batch/:venueId", async (req, res) => {
  try {
    const venueId = parseInt(req.params.venueId);
    const { templates } = req.body;
    if (!Array.isArray(templates)) {
      return res.status(400).json({ message: "templates must be an array" });
    }
    await storage.deleteVenueShiftTemplatesByVenue(venueId);
    const results = [];
    for (const t of templates) {
      const parsed = insertVenueShiftTemplateSchema.parse({ ...t, venueId });
      const created = await storage.createVenueShiftTemplate(parsed);
      results.push(created);
    }
    res.json(results);
  } catch (err: any) {
    if (err.name === "ZodError") {
      return res.status(400).json({ message: "資料格式錯誤" });
    }
    res.status(400).json({ message: err.message });
  }
});

app.delete("/api/venue-shift-templates/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const deleted = await storage.deleteVenueShiftTemplate(id);
  if (!deleted) return res.status(404).json({ message: "Template not found" });
  res.json({ success: true });
});

}

