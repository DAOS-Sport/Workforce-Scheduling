import { type Express } from "express";
import { type Server } from "http";
import { leaveService } from "./leave.service";

export function mountLeaveRoutes(_httpServer: Server, app: Express): void {
  // ── 請假申請 (員工端提交) ──────────────────────────────────────────────
  app.post("/api/portal/leave-request", async (req, res) => {
    try {
      const record = await leaveService.submit(req.body);
      res.json(record);
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  app.get("/api/portal/leave-requests/:employeeId", async (req, res) => {
    try {
      const records = await leaveService.byEmployee(parseInt(req.params.employeeId));
      res.json(records);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── 請假申請 (管理端) ──────────────────────────────────────────────────
  app.get("/api/leave-requests", async (req, res) => {
    try {
      const enriched = await leaveService.listForAdmin(req.query.status as string | undefined);
      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/leave-requests/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const adminId = req.session.adminId || 0;
      const adminName = req.session.adminName || "管理員";
      const updated = await leaveService.review(id, req.body?.status, req.body?.reviewNote, adminId, adminName);
      res.json(updated);
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });
}
