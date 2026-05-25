/**
 * Clock-records sub-routes — read/list clock records and reasons.
 * Endpoints:
 *   GET    /api/clock-records
 *   GET    /api/reports/clock-records
 *   GET    /api/reports/anomalies
 *   PATCH  /api/portal/clock-records/:id/reason
 */
import { type Express } from "express";
import { type Server } from "http";
import { clockService } from "./clock.service";

export function mountClockRecordsRoutes(_httpServer: Server, app: Express): void {
  app.get("/api/clock-records", async (req, res) => {
    try {
      const { startDate, endDate, employeeId } = req.query;
      const result = await clockService.listRecords({
        startDate: startDate as string,
        endDate: endDate as string,
        employeeId: employeeId ? Number(employeeId) : undefined,
      });
      res.json(result);
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  // Live log feed: today's clock attempts (incl. fail / warning) sorted newest first.
  // Used by the admin "打卡即時日誌" page for real-time monitoring.
  app.get("/api/clock-logs/today", async (_req, res) => {
    try {
      const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const result = await clockService.listRecords({ startDate: today, endDate: today });
      result.sort((a: any, b: any) => new Date(b.clockTime || 0).getTime() - new Date(a.clockTime || 0).getTime());
      res.json(result);
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  app.get("/api/reports/clock-records", async (req, res) => {
    try {
      const result = await clockService.listClockReports({
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        employeeName: req.query.employeeName as string,
        employeeCode: req.query.employeeCode as string,
        status: req.query.status as string,
        clockType: req.query.clockType as string,
        venueId: req.query.venueId as string,
      });
      res.json(result);
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  app.get("/api/reports/anomalies", async (req, res) => {
    try {
      res.json(await clockService.listAnomaliesReport(String(req.query.yearMonth || "")));
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  app.patch("/api/portal/clock-records/:id/reason", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { earlyArrivalReason, lateDepartureReason } = req.body;
      res.json(await clockService.updateRecordReason(id, earlyArrivalReason, lateDepartureReason));
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });
}
