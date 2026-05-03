import { type Express } from "express";
import { type Server } from "http";
import { dispatchService } from "./dispatch.service";
import { ok, created, fail } from "../../shared/http/response";

export function mountDispatchRoutes(_httpServer: Server, app: Express): void {
  app.get("/api/dispatch-shifts/:regionCode/:startDate/:endDate", async (req, res) => {
    try {
      const { regionCode, startDate, endDate } = req.params;
      ok(res, await dispatchService.listByRegionCodes(regionCode, startDate, endDate));
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  app.post("/api/dispatch-shifts", async (req, res) => {
    try {
      created(res, await dispatchService.create(req.body));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });

  app.post("/api/dispatch-shifts/batch-create", async (req, res) => {
    try {
      created(res, await dispatchService.batchCreate(req.body));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });

  app.patch("/api/dispatch-shifts/:id", async (req, res) => {
    try {
      ok(res, await dispatchService.update(parseInt(req.params.id), req.body));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });

  app.get("/api/dispatch-shifts-cancelled/:regionCode/:startDate/:endDate", async (req, res) => {
    try {
      const { regionCode, startDate, endDate } = req.params;
      ok(res, await dispatchService.listCancelledByRegionCodes(regionCode, startDate, endDate));
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  app.delete("/api/dispatch-shifts/:id", async (req, res) => {
    try {
      const actor = (req.session as any)?.user?.username || "admin";
      await dispatchService.remove(parseInt(req.params.id), actor);
      ok(res, { success: true });
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });

  app.post("/api/dispatch-shifts/:id/restore", async (req, res) => {
    try {
      const actor = (req.session as any)?.user?.username || "admin";
      ok(res, await dispatchService.restore(parseInt(req.params.id), actor));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });

  app.post("/api/dispatch-shifts/reconcile-links", async (_req, res) => {
    try {
      ok(res, await dispatchService.reconcileLinks());
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });
}
