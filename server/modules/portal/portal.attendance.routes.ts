/**
 * Portal attendance sub-routes — employee's monthly attendance summary.
 * Endpoints:
 *   GET    /api/portal/my-attendance/:employeeId
 */
import { type Express } from "express";
import { type Server } from "http";
import { portalService } from "./portal.service";

export function mountPortalAttendanceRoutes(_httpServer: Server, app: Express): void {
  app.get("/api/portal/my-attendance/:employeeId", async (req, res) => {
    try {
      res.json(await portalService.getMyAttendance(parseInt(req.params.employeeId)));
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });
}
