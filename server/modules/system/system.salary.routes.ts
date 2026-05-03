/**
 * System salary + weekly-attendance sub-routes.
 * Endpoints:
 *   GET    /api/salary-report
 *   GET    /api/weekly-attendance/:weekStart
 *   POST   /api/weekly-attendance/notify
 */
import { type Express } from "express";
import { type Server } from "http";
import { systemService } from "./system.service";

export function mountSystemSalaryRoutes(_httpServer: Server, app: Express): void {
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
