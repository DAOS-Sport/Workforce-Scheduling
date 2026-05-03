/**
 * Four-week flexible-working-hours compliance sub-routes.
 * Endpoints:
 *   GET    /api/four-week-compliance
 */
import { type Express } from "express";
import { type Server } from "http";
import { systemService } from "./system.service";

export function mountSystemFourWeekRoutes(_httpServer: Server, app: Express): void {
  app.get("/api/four-week-compliance", async (req, res) => {
    try {
      const year = parseInt(req.query.year as string);
      const month = parseInt(req.query.month as string);
      res.json(await systemService.fourWeekCompliance(year, month, req.query.regionCode as string | undefined));
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });
}
