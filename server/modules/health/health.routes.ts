/**
 * GET /api/health/pipelines：給監控中樞讀的 health-v1 報告。
 * 不走後台登入閘門（/api/health/ 在放行清單裡），改在這裡驗 HEALTH_TOKEN：
 * 沒設定回 503，token 不對回 401。
 *
 * GET /api/admin/health：給後台「IT 監控」頁用的同一份報告。瀏覽器不能拿到 HEALTH_TOKEN，
 * 所以這條走後台登入（不在放行清單裡），不驗 token；直接呼叫 health service，不轉發 HTTP。
 */
import type { Express } from "express";
import { timingSafeEqual } from "crypto";
import { requireAdmin } from "../../shared/middleware/requireAdmin";
import { buildHealthReport, readClockNeverSuccessEmployees } from "./health.service";

function tokenMatches(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function mountHealthRoutes(app: Express): void {
  app.get("/api/health/pipelines", async (req, res) => {
    res.set("Cache-Control", "no-store");
    // 在 Secrets 貼值時容易多帶空白或換行，只修剪設定值；送來的 token 照原樣比對。
    const expected = process.env.HEALTH_TOKEN?.trim();
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

  app.get("/api/admin/health", requireAdmin, async (_req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      res.json(await buildHealthReport(new Date()));
    } catch (err: any) {
      console.error("[health] 後台健康報告產生失敗:", err?.message ?? err);
      res.status(500).json({ message: "無法產生健康報告" });
    }
  });

  app.get("/api/admin/health/clock-never-success", requireAdmin, async (_req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      res.json(await readClockNeverSuccessEmployees(new Date()));
    } catch {
      res.status(500).json({ message: "無法取得從未成功打卡名單" });
    }
  });
}
