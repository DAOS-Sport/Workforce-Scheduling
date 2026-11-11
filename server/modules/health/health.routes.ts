/**
 * GET /api/health/pipelines：給監控中樞讀的 health-v1 報告。
 * 不走後台登入閘門（/api/health/ 在放行清單裡），改在這裡驗 HEALTH_TOKEN：
 * 沒設定回 503，token 不對回 401。
 *
 * GET /api/admin/health：給後台「IT 監控」頁用的同一份報告。瀏覽器不能拿到 HEALTH_TOKEN，
 * 所以這條走後台登入（不在放行清單裡），不驗 token；直接呼叫 health service，不轉發 HTTP。
 */
import type { Express, RequestHandler } from "express";
import { timingSafeEqual } from "crypto";
import { requireAdmin } from "../../shared/middleware/requireAdmin";
import { buildHealthReport } from "./health.service";
import { InvalidHealthLogQuery, parseHealthLogsOptions, queryHealthLogs } from "./healthLogs";

function tokenMatches(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function mountHealthRoutes(app: Express): void {
  const healthToken: RequestHandler = (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const expected = process.env.HEALTH_TOKEN?.trim();
    if (!expected) return void res.status(503).json({ message: "HEALTH_TOKEN not configured" });
    const header = req.header("authorization") ?? "";
    const received = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (!received || !tokenMatches(received, expected)) return void res.status(401).json({ message: "invalid health token" });
    next();
  };
  const readLogs: RequestHandler = async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const options = parseHealthLogsOptions(req.query);
      res.json(await queryHealthLogs(options));
    } catch (err) {
      if (err instanceof InvalidHealthLogQuery) return void res.status(400).json({ message: err.message });
      res.status(500).json({ message: "無法讀取日誌" });
    }
  };
  app.get("/api/health/logs", healthToken, readLogs);
  app.get("/api/admin/health/logs", requireAdmin, readLogs);

  app.get("/api/health/pipelines", healthToken, async (_req, res) => {
    try {
      res.json(await buildHealthReport(new Date()));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/health", requireAdmin, async (_req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      res.json(await buildHealthReport(new Date()));
    } catch (err: any) {
      console.error("[health] 後台健康報告產生失敗:", err?.message ?? err);
      res.status(500).json({ message: "無法產生健康報告" });
    }
  });
}
