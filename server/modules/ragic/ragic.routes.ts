/**
 * Ragic HTTP route layer.
 *
 * Owns all Ragic manual-trigger endpoints (admin-gated by the global
 * `gateAdminApi` middleware applied to `/api/*` in server/routes.ts).
 *
 * Legacy URLs (created in Task #72 重構 C — kept for any existing callers
 * outside the admin UI):
 *   POST /api/ragic-sync         — sync employees from Ragic
 *   POST /api/ragic-venue-sync   — sync venues from Ragic
 *
 * New module-scoped URLs (added in Task #73 重構 D — what the admin UI
 * "手動觸發 Ragic 同步" buttons should call going forward):
 *   POST /api/ragic/sync-employees
 *   POST /api/ragic/sync-venues
 *
 * Both pairs delegate to the same service functions, so request bodies,
 * response shapes, and side-effects are identical.
 */
import { type Express } from "express";
import { type Server } from "http";
import { syncFromRagic, syncVenuesFromRagic } from "./ragic.service";

export function mountRagicRoutes(_httpServer: Server, app: Express): void {
  // Legacy URLs (kept verbatim for backwards compatibility).
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

  // Module-scoped URLs (Task #73 重構 D).
  app.post("/api/ragic/sync-employees", async (_req, res) => {
    try {
      res.json(await syncFromRagic());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/ragic/sync-venues", async (_req, res) => {
    try {
      res.json(await syncVenuesFromRagic());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
