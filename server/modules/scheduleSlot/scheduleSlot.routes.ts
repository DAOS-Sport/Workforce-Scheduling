import { type Express } from "express";
import { type Server } from "http";
import { scheduleSlotService } from "./scheduleSlot.service";

export function mountScheduleSlotRoutes(_httpServer: Server, app: Express): void {
  app.get("/api/schedule-slots/:regionCode/:startDate/:endDate", async (req, res) => {
    const { regionCode, startDate, endDate } = req.params;
    res.json(await scheduleSlotService.listSlotsForRegions(regionCode, startDate, endDate));
  });

  app.post("/api/schedule-slots/materialize", async (req, res) => {
    try {
      res.json(await scheduleSlotService.materialize(req.body));
    } catch (err: any) {
      res.status(err.status || 400).json({ message: err.message });
    }
  });

  app.post("/api/schedule-slots", async (req, res) => {
    try {
      res.json(await scheduleSlotService.create(req.body));
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "資料格式錯誤" });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/schedule-slots/:id", async (req, res) => {
    try {
      const slot = await scheduleSlotService.update(parseInt(req.params.id), req.body);
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
    const deleted = await scheduleSlotService.remove(parseInt(req.params.id));
    if (!deleted) return res.status(404).json({ message: "Slot not found" });
    res.json({ success: true });
  });

  app.post("/api/schedule-slots/batch-copy", async (req, res) => {
    try {
      res.json(await scheduleSlotService.batchCopy(req.body));
    } catch (err: any) {
      res.status(err.status || 400).json({ message: err.message });
    }
  });

  app.get("/api/venue-requirements/:regionCode", async (req, res) => {
    res.json(await scheduleSlotService.venueRequirementsByRegionCode(req.params.regionCode));
  });

  app.get("/api/venue-shift-templates/:venueId", async (req, res) => {
    res.json(await scheduleSlotService.templatesByVenue(parseInt(req.params.venueId)));
  });

  app.post("/api/venue-shift-templates", async (req, res) => {
    try {
      res.json(await scheduleSlotService.createTemplate(req.body));
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
      res.json(await scheduleSlotService.batchReplaceTemplates(venueId, req.body?.templates));
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "資料格式錯誤" });
      }
      res.status(err.status || 400).json({ message: err.message });
    }
  });

  app.delete("/api/venue-shift-templates/:id", async (req, res) => {
    const deleted = await scheduleSlotService.removeTemplate(parseInt(req.params.id));
    if (!deleted) return res.status(404).json({ message: "Template not found" });
    res.json({ success: true });
  });
}
