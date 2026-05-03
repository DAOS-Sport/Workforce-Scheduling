import { type Express } from "express";
import { type Server } from "http";
import { announcementService } from "./announcement.service";

export function mountAnnouncementRoutes(_httpServer: Server, app: Express): void {
  app.get("/api/pending-counts", async (_req, res) => {
    try {
      res.json(await announcementService.pendingCounts());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── BRIDGE-04: Announcements ──────────────────────────────────────────────
  app.post("/api/announcements", async (req, res) => {
    try {
      res.json(await announcementService.create(req.body));
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/announcements", async (_req, res) => {
    try {
      res.json(await announcementService.list());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/announcements/:id", async (req, res) => {
    try {
      await announcementService.remove(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/announcements/active", async (req, res) => {
    try {
      const regionCode = req.query.regionCode as string | undefined;
      res.json(await announcementService.listActive(regionCode));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
