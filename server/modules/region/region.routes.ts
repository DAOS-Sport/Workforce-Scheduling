import { type Express } from "express";
import { type Server } from "http";
import { regionService } from "./region.service";

export function mountRegionRoutes(_httpServer: Server, app: Express): void {
  app.get("/api/regions", async (_req, res) => {
    try {
      const regions = await regionService.findAll();
      res.json(regions);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
