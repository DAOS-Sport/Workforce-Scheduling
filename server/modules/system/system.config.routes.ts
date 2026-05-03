/**
 * System config sub-routes — salary rate table + arbitrary key/value config.
 * Endpoints:
 *   GET    /api/salary-rates
 *   POST   /api/salary-rates
 *   GET    /api/system-config/:key
 *   POST   /api/system-config/:key
 */
import { type Express } from "express";
import { type Server } from "http";
import { systemService } from "./system.service";

export function mountSystemConfigRoutes(_httpServer: Server, app: Express): void {
  app.get("/api/salary-rates", async (_req, res) => {
    try { res.json(await systemService.listSalaryRates()); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/salary-rates", async (req, res) => {
    try {
      const { role, ratePerHour, label } = req.body;
      res.json(await systemService.upsertSalaryRate(role, Number(ratePerHour), label));
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  app.get("/api/system-config/:key", async (req, res) => {
    try { res.json(await systemService.getSystemConfig(req.params.key)); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/system-config/:key", async (req, res) => {
    try {
      res.json(await systemService.upsertSystemConfig(req.params.key, req.body?.value));
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });
}
