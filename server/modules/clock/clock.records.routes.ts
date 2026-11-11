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
import { employeeService } from "../employee/employee.service";
import { currentAuditActor, withAuditActor, type AuditActor } from "../../shared/audit/actor";
import { requireAdmin } from "../../shared/middleware/requireAdmin";

export function mountClockRecordsRoutes(_httpServer: Server, app: Express): void {
  app.post("/api/clock-records", requireAdmin, async (req, res) => {
    try { res.status(201).json(await clockService.adminCreateRecord(req.body)); }
    catch (err: any) { res.status(err.name === "ZodError" ? 400 : err.status || 500).json({ message: err.message }); }
  });
  app.patch("/api/clock-records/:id", requireAdmin, async (req, res) => {
    try { res.json(await clockService.adminUpdateRecord(Number(req.params.id), req.body)); }
    catch (err: any) { res.status(err.name === "ZodError" ? 400 : err.status || 500).json({ message: err.message }); }
  });
  app.delete("/api/clock-records/:id", requireAdmin, async (req, res) => {
    try { res.json(await clockService.adminDeleteRecord(Number(req.params.id))); }
    catch (err: any) { res.status(err.name === "ZodError" ? 400 : err.status || 500).json({ message: err.message }); }
  });
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

  app.patch("/api/portal/clock-records/:id/reason", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { earlyArrivalReason, lateDepartureReason } = req.body;
      let actor: AuditActor = currentAuditActor();
      if (actor.kind === "system") {
        actor = { kind: "employee" };
        const lineId = req.header("x-line-user-id");
        if (lineId) {
          const matches = (await employeeService.getEmployeesByLineId(lineId)).filter((e) => e.status === "active");
          if (matches.length === 1) actor = { kind: "employee", employeeId: matches[0].id, name: matches[0].name };
        }
      }
      res.json(await withAuditActor(actor, () => clockService.updateRecordReason(id, earlyArrivalReason, lateDepartureReason)));
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });
}
