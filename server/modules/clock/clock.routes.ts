import { type Express } from "express";
import { type Server } from "http";
import { clockService } from "./clock.service";

export function mountClockRoutes(_httpServer: Server, app: Express): void {
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

  app.post("/api/portal/clock-amendment", async (req, res) => {
    try {
      res.json(await clockService.createAmendment(req.body));
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  app.get("/api/portal/clock-amendments/:employeeId", async (req, res) => {
    try {
      res.json(await clockService.listAmendmentsByEmployee(parseInt(req.params.employeeId)));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/portal/amendment-eligible-dates", async (req, res) => {
    try {
      const employeeId = parseInt(String(req.query.employeeId || "0"));
      const yearMonth = String(req.query.yearMonth || "");
      res.json(await clockService.listEligibleDates(employeeId, yearMonth));
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  app.get("/api/clock-amendments", async (req, res) => {
    try {
      res.json(await clockService.listAmendments(req.query.status as string | undefined));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/clock-amendments/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status, reviewNote } = req.body;
      const adminId = req.session.adminId || 0;
      const adminName = req.session.adminName || "管理員";
      const updated = await clockService.approveAmendment(id, status, reviewNote, adminId, adminName);
      res.json(updated);
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
