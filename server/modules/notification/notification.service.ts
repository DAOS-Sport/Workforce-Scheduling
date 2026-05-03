/**
 * Notification recipient service.
 *
 * Owns CRUD on email-notification recipients plus the test-email
 * dispatcher used by the admin UI to validate SMTP configuration.
 */
import { storage } from "../../storage";
import { sendAnomalyEmail } from "../../shared/email/sendAnomalyEmail";

export const notificationService = {
  findAll: () => storage.getNotificationRecipients(),

  create(payload: { email: string; label?: string | null; enabled?: boolean; notifyNewReport?: boolean; notifyResolution?: boolean }) {
    if (!payload.email) throw new Error("缺少 email");
    return storage.createNotificationRecipient({
      email: payload.email,
      label: payload.label ?? null,
      enabled: payload.enabled !== false,
      notifyNewReport: payload.notifyNewReport !== false,
      notifyResolution: payload.notifyResolution !== false,
    });
  },

  update(id: number, patch: Record<string, any>) {
    return storage.updateNotificationRecipient(id, patch);
  },

  remove(id: number) {
    return storage.deleteNotificationRecipient(id);
  },

  async sendTest(email: string) {
    if (!email) throw new Error("缺少 email");
    await sendAnomalyEmail(
      [email],
      "測試郵件 — DAOS 打卡異常通知系統",
      `<h2>測試郵件</h2><p>此為 DAOS 打卡異常通知系統的測試郵件。</p><p>如果您收到此郵件，表示郵件通知功能運作正常。</p><p>發送時間：${new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</p>`,
    );
  },
};
