/**
 * Clock amendment sub-routes — create/list/approve clock-amendment requests.
 * Endpoints:
 *   POST   /api/portal/clock-amendment
 *   GET    /api/portal/clock-amendments/:employeeId
 *   GET    /api/portal/amendment-eligible-dates
 *   GET    /api/clock-amendments
 *   PATCH  /api/clock-amendments/:id
 */
import { type Express } from "express";
import { type Server } from "http";
import { clockService } from "./clock.service";

export function mountClockAmendmentRoutes(_httpServer: Server, app: Express): void {
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
}
