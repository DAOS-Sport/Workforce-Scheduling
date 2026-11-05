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
 *   Stores the delivery and answers 202; the sync runs after a short debounce.
 *
 * Both pairs delegate to the same service functions, so request bodies and
 * response shapes are identical. A sync that finds another one running answers 202.
 */
import { type Express, type Request, type Response } from "express";
import { type Server } from "http";
import { timingSafeEqual } from "crypto";
import { acceptWebhook, runRagicSync, runVenueSync } from "./ragic.service";
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

/** The event id Ragic sent, if it sent one; a delivery without one is simply recorded as its own event. */
function webhookEventId(req: Request): string | undefined {
  const id = req.header("x-ragic-event-id")?.trim();
  return id ? id.slice(0, 200) : undefined;
}

const BUSY = { status: "busy", message: "已有另一個 Ragic 同步在執行，已記錄待補跑" };

async function respondEmployeeSync(_req: Request, res: Response): Promise<void> {
  try {
    const outcome = await runRagicSync("manual");
    if (outcome.busy) res.status(202).json(BUSY);
    else res.json(outcome.result);
  } catch (err: any) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

async function respondVenueSync(_req: Request, res: Response): Promise<void> {
  try {
    const outcome = await runVenueSync();
    if (outcome.busy) res.status(202).json(BUSY);
    else res.json(outcome.result);
  } catch (err: any) {
    res.status(err.status || 500).json({ message: err.message });
  }
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
      const { eventId, duplicate } = await trackJob("ragic.webhook", "webhook", () => acceptWebhook(webhookEventId(req)));
      res.status(202).json({ message: "H01 webhook accepted", eventId, duplicate });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Legacy URLs (kept verbatim for backwards compatibility).
  app.post("/api/ragic-venue-sync", respondVenueSync);
  app.post("/api/ragic-sync", respondEmployeeSync);

  // Module-scoped URLs (Task #73 重構 D).
  app.post("/api/ragic/sync-employees", respondEmployeeSync);
  app.post("/api/ragic/sync-venues", respondVenueSync);
}
