/**
 * Admin availability routes — view all employee availabilities.
 * Endpoints:
 *   GET  /api/availabilities?regionCode=A&yearMonth=2026-06
 */
import { type Express } from "express";
import { type Server } from "http";
import { listAvailabilities } from "./availability.service";
import { ok, fail } from "../../shared/http/response";

export function mountAvailabilityRoutes(_httpServer: Server, app: Express): void {
  app.get("/api/availabilities", async (req, res) => {
    try {
      const { regionCode, yearMonth } = req.query as Record<string, string>;
      ok(res, await listAvailabilities(regionCode, yearMonth));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });
}
