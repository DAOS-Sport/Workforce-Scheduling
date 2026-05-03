import { type Express } from "express";
import { type Server } from "http";
import { notificationService } from "./notification.service";
import { ok, created, fail, notFound, badRequest } from "../../shared/http/response";

export function mountNotificationRoutes(_httpServer: Server, app: Express): void {
  app.get("/api/notification-recipients", async (_req, res) => {
    try {
      ok(res, await notificationService.findAll());
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  app.post("/api/notification-recipients", async (req, res) => {
    try {
      created(res, await notificationService.create(req.body));
    } catch (err: any) {
      fail(res, err.message === "缺少 email" ? 400 : 500, err.message);
    }
  });

  app.patch("/api/notification-recipients/:id", async (req, res) => {
    try {
      const record = await notificationService.update(Number(req.params.id), req.body);
      if (!record) return notFound(res, "找不到此收件者");
      ok(res, record);
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  app.delete("/api/notification-recipients/:id", async (req, res) => {
    try {
      await notificationService.remove(Number(req.params.id));
      ok(res, { success: true });
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  app.post("/api/test-email", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return badRequest(res, "缺少 email");
      await notificationService.sendTest(email);
      ok(res, { success: true, message: "測試郵件已發送" });
    } catch (err: any) {
      console.error("[EMAIL] Test email failed:", err);
      fail(res, 500, `郵件發送失敗: ${err.message}`);
    }
  });
}
