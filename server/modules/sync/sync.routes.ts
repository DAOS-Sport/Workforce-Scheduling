import { type Express } from "express";
import { type Server } from "http";
import { syncFromRagic, syncVenuesFromRagic } from "../../ragic";
import { sendShiftReminders, sendWeeklySchedulePush, sendWeeklyLateReport } from "../../line-webhook";

export function mountSyncRoutes(httpServer: Server, app: Express): void {
  app.post("/api/ragic-venue-sync", async (_req, res) => {
  try {
    const result = await syncVenuesFromRagic();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/ragic-sync", async (_req, res) => {
  try {
    const result = await syncFromRagic();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/send-shift-reminders", async (req, res) => {
  try {
    const force = req.body?.force === true;
    const result = await sendShiftReminders(force);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/admin/trigger-weekly-schedule", async (req, res) => {
  if (!req.session.adminId) {
    return res.status(401).json({ message: "未登入" });
  }
  try {
    const force = req.body?.force === true; // default false (respect dedup)
    const result = await sendWeeklySchedulePush(force);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/admin/trigger-weekly-late-report", async (req, res) => {
  if (!req.session.adminId) {
    return res.status(401).json({ message: "未登入" });
  }
  try {
    const force = req.body?.force === true; // default false (respect dedup)
    const result = await sendWeeklyLateReport(force);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

}

