import { type Express } from "express";
import { type Server } from "http";
import { storage } from "../../storage";
import { insertVenueSchema, type Venue } from "@shared/schema";
import { invalidateVenueCache } from "../../line-webhook";

export function mountVenueRoutes(httpServer: Server, app: Express): void {
  app.get("/api/venues-all", async (_req, res) => {
  const allVenues = await storage.getAllVenues();
  res.json(allVenues);
});

app.get("/api/venues/:regionCode", async (req, res) => {
  const { regionCode } = req.params;
  const codes = regionCode.split(",").map(c => c.trim()).filter(Boolean);
  const seen = new Set<number>();
  const out: Venue[] = [];
  for (const code of codes) {
    const region = await storage.getRegionByCode(code);
    if (!region) continue;
    const venues = await storage.getVenuesByRegion(region.id);
    for (const v of venues) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      out.push(v);
    }
  }
  res.json(out);
});

app.post("/api/venues", async (req, res) => {
  try {
    const parsed = insertVenueSchema.parse(req.body);
    const venue = await storage.createVenue(parsed);
    invalidateVenueCache();
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
    const partial = insertVenueSchema.partial().parse(req.body);
    const venue = await storage.updateVenue(id, partial);
    if (!venue) return res.status(404).json({ message: "Venue not found" });
    invalidateVenueCache();
    res.json(venue);
  } catch (err: any) {
    if (err.name === "ZodError") {
      return res.status(400).json({ message: "資料格式錯誤" });
    }
    res.status(400).json({ message: err.message });
  }
});

}

