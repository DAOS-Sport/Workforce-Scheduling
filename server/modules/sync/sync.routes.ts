import { type Express } from "express";
import { type Server } from "http";
import { syncService } from "./sync.service";

export function mountSyncRoutes(_httpServer: Server, app: Express): void {
  app.post("/api/ragic-venue-sync", async (_req, res) => {
    try {
      res.json(await syncService.ragicVenues());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/ragic-sync", async (_req, res) => {
    try {
      res.json(await syncService.ragicAll());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/send-shift-reminders", async (req, res) => {
    try {
      res.json(await syncService.shiftReminders(req.body?.force === true));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/trigger-weekly-schedule", async (req, res) => {
    if (!req.session.adminId) {
      return res.status(401).json({ message: "未登入" });
    }
    try {
      res.json(await syncService.weeklySchedule(req.body?.force === true));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/trigger-weekly-late-report", async (req, res) => {
    if (!req.session.adminId) {
      return res.status(401).json({ message: "未登入" });
    }
    try {
      res.json(await syncService.weeklyLateReport(req.body?.force === true));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
