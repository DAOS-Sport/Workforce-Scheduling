import { type Express } from "express";
import { type Server } from "http";
import { announcementService } from "./announcement.service";
import { ok, created, fail } from "../../shared/http/response";

export function mountAnnouncementRoutes(_httpServer: Server, app: Express): void {
  app.get("/api/pending-counts", async (_req, res) => {
    try {
      ok(res, await announcementService.pendingCounts());
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  app.post("/api/announcements", async (req, res) => {
    try {
      created(res, await announcementService.create(req.body));
    } catch (err: any) {
      fail(res, 400, err.message);
    }
  });

  app.get("/api/announcements", async (_req, res) => {
    try {
      ok(res, await announcementService.list());
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  app.delete("/api/announcements/:id", async (req, res) => {
    try {
      await announcementService.remove(parseInt(req.params.id));
      ok(res, { success: true });
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  app.get("/api/announcements/active", async (req, res) => {
    try {
      const regionCode = req.query.regionCode as string | undefined;
      ok(res, await announcementService.listActive(regionCode));
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });
}
