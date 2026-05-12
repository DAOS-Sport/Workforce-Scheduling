import { type Express } from "express";
import { type Server } from "http";
import { venueService } from "./venue.service";

export function mountVenueRoutes(_httpServer: Server, app: Express): void {
  app.get("/api/venues-all", async (_req, res) => {
    try {
      const venues = await venueService.findAll();
      res.json(venues);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/venues/:regionCode", async (req, res) => {
    try {
      const out = await venueService.findByRegionCodes(req.params.regionCode);
      res.json(out);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/venues", async (req, res) => {
    try {
      const venue = await venueService.create(req.body);
      res.json(venue);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "資料格式錯誤" });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/venues/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const venue = await venueService.update(id, req.body);
      if (!venue) return res.status(404).json({ message: "Venue not found" });
      res.json(venue);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "資料格式錯誤" });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/portal/region-hours/:regionCode", async (req, res) => {
    try {
      const venues = await venueService.findByRegionCodes(req.params.regionCode);
      const active = venues.filter((v) => v.openTime && v.closeTime);
      if (active.length === 0) return res.json(null);
      const openTime = active.map((v) => v.openTime!).sort()[0];
      const closeTime = active.map((v) => v.closeTime!).sort().reverse()[0];
      res.json({ openTime, closeTime });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
