import { type Express } from "express";
import { type Server } from "http";
import { overtimeService } from "./overtime.service";
import { ok, created, fail } from "../../shared/http/response";

export function mountOvertimeRoutes(_httpServer: Server, app: Express): void {
  app.post("/api/portal/overtime-request", async (req, res) => {
    try {
      created(res, await overtimeService.submit(req.body));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });

  app.get("/api/portal/overtime-requests/:employeeId", async (req, res) => {
    try {
      ok(res, await overtimeService.byEmployee(parseInt(req.params.employeeId)));
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  app.get("/api/overtime-requests", async (req, res) => {
    try {
      ok(res, await overtimeService.listForAdmin(req.query.status as string | undefined));
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  app.patch("/api/overtime-requests/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const adminId = req.session.adminId || 0;
      const adminName = req.session.adminName || "管理員";
      ok(res, await overtimeService.review(id, req.body?.status, req.body?.reviewNote, adminId, adminName));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });
}
