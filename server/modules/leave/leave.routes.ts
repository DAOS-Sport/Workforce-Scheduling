import { type Express } from "express";
import { type Server } from "http";
import { leaveService } from "./leave.service";
import { ok, created, fail } from "../../shared/http/response";

export function mountLeaveRoutes(_httpServer: Server, app: Express): void {
  app.post("/api/portal/leave-request", async (req, res) => {
    try {
      created(res, await leaveService.submit(req.body));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });

  app.get("/api/portal/leave-requests/:employeeId", async (req, res) => {
    try {
      ok(res, await leaveService.byEmployee(parseInt(req.params.employeeId)));
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  app.get("/api/leave-requests", async (req, res) => {
    try {
      ok(res, await leaveService.listForAdmin(req.query.status as string | undefined));
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  app.patch("/api/leave-requests/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const adminId = req.session.adminId || 0;
      const adminName = req.session.adminName || "管理員";
      ok(res, await leaveService.review(id, req.body?.status, req.body?.reviewNote, adminId, adminName));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });
}
