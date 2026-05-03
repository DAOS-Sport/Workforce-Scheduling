/**
 * Portal guidelines sub-routes — relevant guideline list + ack workflow.
 * Endpoints:
 *   GET    /api/portal/guidelines-check/:employeeId
 *   GET    /api/portal/guidelines/:id
 *   POST   /api/portal/acknowledge-all
 */
import { type Express } from "express";
import { type Server } from "http";
import { portalService } from "./portal.service";

export function mountPortalGuidelinesRoutes(_httpServer: Server, app: Express): void {
  app.get("/api/portal/guidelines-check/:employeeId", async (req, res) => {
    try {
      res.json(await portalService.guidelinesCheck(parseInt(req.params.employeeId)));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/portal/guidelines/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const employeeId = parseInt(req.query.employeeId as string);
      res.json(await portalService.getGuideline(id, employeeId));
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  app.post("/api/portal/acknowledge-all", async (req, res) => {
    try {
      const { employeeId, guidelineIds } = req.body;
      res.json(await portalService.acknowledgeAll(employeeId, guidelineIds));
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });
}
