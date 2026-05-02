import { type Express } from "express";
import { type Server } from "http";
import { storage } from "../../storage";

export function mountRegionRoutes(httpServer: Server, app: Express): void {
  app.get("/api/regions", async (_req, res) => {
  const regions = await storage.getRegions();
  res.json(regions);
});

}

