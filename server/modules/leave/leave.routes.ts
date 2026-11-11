import { type Express } from "express";
import { type Server } from "http";
import { leaveService } from "./leave.service";
import { ok, created, fail } from "../../shared/http/response";
import { requireAdmin } from "../../shared/middleware/requireAdmin";

export function mountLeaveRoutes(_httpServer: Server, app: Express): void {
  app.post("/api/leave-requests/:id/revoke", requireAdmin, async (req, res) => {
    try { ok(res, await leaveService.revoke(Number(req.params.id), req.body?.reason)); }
    catch (err: any) { fail(res, err.status || 500, err.message); }
  });
  app.patch("/api/leave-requests/:id/adjust", requireAdmin, async (req, res) => {
    try { ok(res, await leaveService.adjustRequest(Number(req.params.id), req.body)); }
    catch (err: any) { fail(res, err.name === "ZodError" ? 400 : err.status || 500, err.message); }
  });
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

  app.get("/api/portal/leave-summary/:employeeId", async (req, res) => {
    try {
      ok(res, await leaveService.getEmployeeSummary(parseInt(req.params.employeeId)));
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  app.get("/api/leave-requests", requireAdmin, async (req, res) => {
    try {
      ok(res, await leaveService.listForAdmin(req.query.status as string | undefined));
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  app.patch("/api/leave-requests/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const adminId = req.session.adminId || 0;
      const adminName = req.session.adminName || "管理員";
      ok(res, await leaveService.review(id, req.body?.status, req.body?.reviewNote, adminId, adminName));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });

  app.get("/api/leave-balances", requireAdmin, async (req, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      ok(res, await leaveService.getBalanceOverview(year));
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  app.post("/api/leave-balances/adjust", requireAdmin, async (req, res) => {
    try {
      const { employeeId, year, totalHours } = req.body;
      if (!employeeId || !year || totalHours === undefined) {
        return fail(res, 400, "缺少必要欄位 employeeId / year / totalHours");
      }
      const adminId = req.session.adminId || 0;
      const adminName = req.session.adminName || "管理員";
      ok(res, await leaveService.adjustBalance(Number(employeeId), Number(year), Number(totalHours), adminId, adminName));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });
}
