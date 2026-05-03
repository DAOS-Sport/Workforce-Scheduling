/**
 * Portal shifts sub-routes — employee's own schedule + certificate upload.
 * Endpoints:
 *   GET    /api/portal/my-shifts/:employeeId/:startDate/:endDate
 *   PATCH  /api/portal/shifts/:shiftId/certificate
 */
import { type Express } from "express";
import { type Server } from "http";
import { portalService } from "./portal.service";

export function mountPortalShiftsRoutes(_httpServer: Server, app: Express): void {
  app.get("/api/portal/my-shifts/:employeeId/:startDate/:endDate", async (req, res) => {
    try {
      const employeeId = parseInt(req.params.employeeId);
      const { startDate, endDate } = req.params;
      res.json(await portalService.getMyShifts(employeeId, startDate, endDate));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/portal/shifts/:shiftId/certificate", async (req, res) => {
    try {
      const shiftId = parseInt(req.params.shiftId);
      const { employeeId, certificateImageUrl } = req.body;
      const actor = req.session.adminName || "admin:certificate";
      res.json(await portalService.updateShiftCertificate(shiftId, parseInt(employeeId), certificateImageUrl, actor));
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });
}
