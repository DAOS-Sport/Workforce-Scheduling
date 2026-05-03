import { type Express, type Request, type Response } from "express";
import { type Server } from "http";
import {
  verifyLineSignature,
  verifyForwardedRequest,
  handleLineWebhook,
} from "../../line-webhook";
import { lineService } from "./line.service";

export function mountLineLiffRoutes(_httpServer: Server, app: Express): void {
  app.post("/api/line/webhook", async (req: Request, res: Response) => {
    const signature = req.headers["x-line-signature"] as string;
    const forwardSecret = req.headers["x-forward-secret"] as string;
    const rawBody = req.rawBody ? Buffer.from(req.rawBody as any).toString("utf8") : JSON.stringify(req.body);

    const isDirectLine = signature && verifyLineSignature(rawBody, signature);
    const isForwarded = forwardSecret && verifyForwardedRequest(forwardSecret);

    if (!isDirectLine && !isForwarded) {
      console.error("[LINE Webhook] Authentication failed (neither LINE signature nor forward secret valid)");
      res.status(403).json({ message: "Invalid signature" });
      return;
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (isForwarded) {
      console.log("[LINE Webhook] Received forwarded request with", (body.events || []).length, "events");
    }
    res.status(200).json({ status: "ok" });

    try {
      await handleLineWebhook(body);
    } catch (err) {
      console.error("[LINE Webhook] Error handling event:", err);
    }
  });

  app.post("/api/liff/clock-in", async (req: Request, res: Response) => {
    try {
      const result = await lineService.processLiffClockIn(req.body);
      res.json(result);
    } catch (err: any) {
      console.error("[Clock-in] Error:", err);
      res.status(err.status || 500).json({ message: err.message });
    }
  });
}
