import { type Express } from "express";
import { type Server } from "http";
import { notificationService } from "./notification.service";

export function mountNotificationRoutes(_httpServer: Server, app: Express): void {
  app.get("/api/notification-recipients", async (_req, res) => {
    try {
      const recipients = await notificationService.findAll();
      res.json(recipients);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/notification-recipients", async (req, res) => {
    try {
      const record = await notificationService.create(req.body);
      res.json(record);
    } catch (err: any) {
      const status = err.message === "缺少 email" ? 400 : 500;
      res.status(status).json({ message: err.message });
    }
  });

  app.patch("/api/notification-recipients/:id", async (req, res) => {
    try {
      const record = await notificationService.update(Number(req.params.id), req.body);
      if (!record) return res.status(404).json({ message: "找不到此收件者" });
      res.json(record);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/notification-recipients/:id", async (req, res) => {
    try {
      await notificationService.remove(Number(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/test-email", async (req, res) => {
    try {
      const { email } = req.body;
      await notificationService.sendTest(email);
      res.json({ success: true, message: "測試郵件已發送" });
    } catch (err: any) {
      console.error("[EMAIL] Test email failed:", err);
      const status = err.message === "缺少 email" ? 400 : 500;
      res.status(status).json({ message: status === 500 ? `郵件發送失敗: ${err.message}` : err.message });
    }
  });
}
