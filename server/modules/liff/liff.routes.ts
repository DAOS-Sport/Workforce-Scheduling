/**
 * LIFF HTTP route layer (Task #73 重構 D).
 *
 * Owns all `/api/liff/*` endpoints. The single endpoint today is
 * `POST /api/liff/clock-in` (moved from modules/line/line.routes.ts —
 * URL and request/response shape unchanged).
 *
 * `/api/liff/` is on the public-prefix bypass list
 * (server/config/openApiPrefixes.ts) — these endpoints are reached from
 * the LIFF browser frame and are authenticated by lineUserId /
 * employeeId in the request body, not by admin session.
 */
import { type Express, type Request, type Response } from "express";
import { type Server } from "http";
import { liffService } from "./liff.service";

export function mountLiffRoutes(_httpServer: Server, app: Express): void {
  app.post("/api/liff/clock-in", async (req: Request, res: Response) => {
    try {
      const result = await liffService.processLiffClockIn(req.body);
      res.json(result);
    } catch (err: any) {
      console.error("[Clock-in] Error:", err);
      res.status(err.status || 500).json({ message: err.message });
    }
  });
}
