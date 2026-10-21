/**
 * GET /api/health/pipelines：給監控中樞讀的 health-v1 報告。
 * 不走後台登入閘門（/api/health/ 在放行清單裡），改在這裡驗 HEALTH_TOKEN：
 * 沒設定回 503，token 不對回 401。
 */
import type { Express } from "express";
import { timingSafeEqual } from "crypto";
import { buildHealthReport } from "./health.service";

function tokenMatches(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function mountHealthRoutes(app: Express): void {
  app.get("/api/health/pipelines", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const expected = process.env.HEALTH_TOKEN;
    if (!expected) return res.status(503).json({ message: "HEALTH_TOKEN not configured" });
    const header = req.header("authorization") ?? "";
    const received = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (!received || !tokenMatches(received, expected)) return res.status(401).json({ message: "invalid health token" });
    try {
      res.json(await buildHealthReport(new Date()));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
