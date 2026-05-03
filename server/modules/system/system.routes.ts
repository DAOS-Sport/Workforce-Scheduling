import { type Express } from "express";
import { type Server } from "http";
import { systemService } from "./system.service";

export function mountSystemRoutes(_httpServer: Server, app: Express): void {
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

  app.get("/api/four-week-compliance", async (req, res) => {
    try {
      const year = parseInt(req.query.year as string);
      const month = parseInt(req.query.month as string);
      res.json(await systemService.fourWeekCompliance(year, month, req.query.regionCode as string | undefined));
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  app.get("/api/salary-report", async (req, res) => {
    try {
      const year = parseInt(req.query.year as string);
      const month = parseInt(req.query.month as string);
      res.json(await systemService.salaryReport(year, month, req.query.regionCode as string | undefined));
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  app.get("/api/weekly-attendance/:weekStart", async (req, res) => {
    try {
      res.json(await systemService.weeklyAttendance(req.params.weekStart));
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  app.post("/api/weekly-attendance/notify", async (req, res) => {
    try {
      res.json(await systemService.notifyWeeklyAttendance(req.body?.weekStart));
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });
}
