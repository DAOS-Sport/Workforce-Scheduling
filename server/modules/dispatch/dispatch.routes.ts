import { type Express } from "express";
import { type Server } from "http";
import { dispatchService } from "./dispatch.service";

export function mountDispatchRoutes(_httpServer: Server, app: Express): void {
  app.get("/api/dispatch-shifts/:regionCode/:startDate/:endDate", async (req, res) => {
    try {
      const { regionCode, startDate, endDate } = req.params;
      res.json(await dispatchService.listByRegionCodes(regionCode, startDate, endDate));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/dispatch-shifts", async (req, res) => {
    try {
      res.json(await dispatchService.create(req.body));
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  app.post("/api/dispatch-shifts/batch-create", async (req, res) => {
    try {
      res.json(await dispatchService.batchCreate(req.body));
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  app.patch("/api/dispatch-shifts/:id", async (req, res) => {
    try {
      const updated = await dispatchService.update(parseInt(req.params.id), req.body);
      res.json(updated);
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  app.delete("/api/dispatch-shifts/:id", async (req, res) => {
    try {
      await dispatchService.remove(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/dispatch-shifts/reconcile-links", async (_req, res) => {
    try {
      res.json(await dispatchService.reconcileLinks());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
