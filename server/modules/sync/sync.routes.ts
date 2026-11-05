import { type Express, type Response } from "express";
import { type Server } from "http";
import { syncService, type TriggerResult } from "./sync.service";

/** 202 when the same job is still running elsewhere; the caller may trigger again later. */
async function respond(res: Response, result: Promise<TriggerResult>): Promise<void> {
  const done = await result;
  res.status("busy" in done ? 202 : 200).json(done);
}

export function mountSyncRoutes(_httpServer: Server, app: Express): void {
  // Note: POST /api/ragic-sync and POST /api/ragic-venue-sync moved to
  // modules/ragic/ragic.routes.ts in Task #72 重構 C. URLs unchanged.

  app.post("/api/send-shift-reminders", async (req, res) => {
    try {
      await respond(res, syncService.shiftReminders());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/trigger-weekly-schedule", async (req, res) => {
    if (!req.session.adminId) {
      return res.status(401).json({ message: "未登入" });
    }
    try {
      await respond(res, syncService.weeklySchedule());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/trigger-weekly-late-report", async (req, res) => {
    if (!req.session.adminId) {
      return res.status(401).json({ message: "未登入" });
    }
    try {
      await respond(res, syncService.weeklyLateReport());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
