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
 * Webhook URL (public prefix, protected by RAGIC_WEBHOOK_SECRET):
 *   POST /api/ragic/webhook/h01
 *
 * Both pairs delegate to the same service functions, so request bodies,
 * response shapes, and side-effects are identical.
 */
import { type Express, type Request } from "express";
import { type Server } from "http";
import { timingSafeEqual } from "crypto";
import { syncFromRagic, syncVenuesFromRagic } from "./ragic.service";
import { trackJob } from "../../shared/health/healthState";

function getWebhookSecret(req: Request): string {
  const headerSecret = req.header("x-ragic-webhook-secret");
  if (headerSecret) return headerSecret;

  const querySecret = req.query.secret;
  if (Array.isArray(querySecret)) return String(querySecret[0] ?? "");
  return typeof querySecret === "string" ? querySecret : "";
}

function secretsMatch(received: string, expected: string): boolean {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(receivedBuffer, expectedBuffer);
}

export function mountRagicRoutes(_httpServer: Server, app: Express): void {
  app.post("/api/ragic/webhook/h01", async (req, res) => {
    const expectedSecret = process.env.RAGIC_WEBHOOK_SECRET;
    if (!expectedSecret) {
      return res.status(503).json({ message: "RAGIC_WEBHOOK_SECRET not configured" });
    }

    const receivedSecret = getWebhookSecret(req);
    if (!receivedSecret || !secretsMatch(receivedSecret, expectedSecret)) {
      return res.status(403).json({ message: "Invalid Ragic webhook secret" });
    }

    try {
      const result = await trackJob("ragic.webhook", "webhook", () => syncFromRagic(), (r) => ({ created: r.created, updated: r.updated, deactivated: r.deactivated, skipped: r.skipped, errors: r.errors.length }));
      res.json({ message: "H01 webhook sync completed", result });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

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
      res.json(await trackJob("ragic.sync", "manual", () => syncFromRagic(), (r) => ({ created: r.created, updated: r.updated, deactivated: r.deactivated, skipped: r.skipped, errors: r.errors.length })));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Module-scoped URLs (Task #73 重構 D).
  app.post("/api/ragic/sync-employees", async (_req, res) => {
    try {
      res.json(await trackJob("ragic.sync", "manual", () => syncFromRagic(), (r) => ({ created: r.created, updated: r.updated, deactivated: r.deactivated, skipped: r.skipped, errors: r.errors.length })));
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
