/**
 * Ragic HTTP route layer (Task #72 重構 C).
 *
 * Owns the two manual-trigger endpoints that fan out to ragic.service.ts:
 *   POST /api/ragic-sync         — sync employees from Ragic
 *   POST /api/ragic-venue-sync   — sync venues from Ragic
 *
 * Both endpoints preserve their original public URLs / response shapes
 * (they used to live in modules/sync/sync.routes.ts and were moved here
 * to keep ragic-related HTTP surface co-located with the service).
 */
import { type Express } from "express";
import { type Server } from "http";
import { syncFromRagic, syncVenuesFromRagic } from "./ragic.service";

export function mountRagicRoutes(_httpServer: Server, app: Express): void {
  app.post("/api/ragic-venue-sync", async (_req, res) => {
    try {
      res.json(await syncVenuesFromRagic());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/ragic-sync", async (_req, res) => {
    try {
      res.json(await syncFromRagic());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
