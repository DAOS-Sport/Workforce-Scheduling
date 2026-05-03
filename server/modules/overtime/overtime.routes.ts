import { type Express } from "express";
import { type Server } from "http";
import { overtimeService } from "./overtime.service";

export function mountOvertimeRoutes(_httpServer: Server, app: Express): void {
  app.post("/api/portal/overtime-request", async (req, res) => {
    try {
      const record = await overtimeService.submit(req.body);
      res.json(record);
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  app.get("/api/portal/overtime-requests/:employeeId", async (req, res) => {
    try {
      const records = await overtimeService.byEmployee(parseInt(req.params.employeeId));
      res.json(records);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/overtime-requests", async (req, res) => {
    try {
      const enriched = await overtimeService.listForAdmin(req.query.status as string | undefined);
      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/overtime-requests/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const adminId = req.session.adminId || 0;
      const adminName = req.session.adminName || "管理員";
      const updated = await overtimeService.review(id, req.body?.status, req.body?.reviewNote, adminId, adminName);
      res.json(updated);
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });
}
