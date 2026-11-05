/**
 * Notification recipient service.
 *
 * Owns CRUD on email-notification recipients plus the test-email
 * dispatcher used by the admin UI to validate SMTP configuration.
 */
import { insertNotificationRecipientSchema } from "@shared/schema";
import { LOCK_NS, lockXact, withTx } from "../../infra/db/tx";
import { sendAnomalyEmail } from "../../shared/email/sendAnomalyEmail";
import { httpError } from "../../shared/http/response";
import { notificationRepository } from "./notification.repository";

const DUPLICATE = "此 email 已在收件名單中";

export const notificationService = {
  findAll: () => notificationRepository.getNotificationRecipients(),

  /** One recipient per address, in any letter case: the address's lock makes the check and the insert one step. */
  async create(payload: { email: string; label?: string | null; enabled?: boolean; notifyNewReport?: boolean; notifyResolution?: boolean }) {
    const email = payload.email?.trim();
    if (!email) throw new Error("缺少 email");
    return withTx(async (tx) => {
      await lockXact(tx, LOCK_NS.notificationRecipient, email.toLowerCase());
      if (await notificationRepository.findByEmail(email, undefined, tx)) throw httpError(409, DUPLICATE);
      return notificationRepository.createNotificationRecipient(
        {
          email,
          label: payload.label || null,
          enabled: payload.enabled !== false,
          notifyNewReport: payload.notifyNewReport !== false,
          notifyResolution: payload.notifyResolution !== false,
        },
        tx,
      );
    });
  },

  async update(id: number, patch: unknown) {
    const parsed = insertNotificationRecipientSchema.partial().parse(patch);
    const email = parsed.email?.trim();
    if (email === undefined) return notificationRepository.updateNotificationRecipient(id, parsed);
    return withTx(async (tx) => {
      await lockXact(tx, LOCK_NS.notificationRecipient, email.toLowerCase());
      if (await notificationRepository.findByEmail(email, id, tx)) throw httpError(409, DUPLICATE);
      return notificationRepository.updateNotificationRecipient(id, { ...parsed, email }, tx);
    });
  },

  remove(id: number) {
    return notificationRepository.deleteNotificationRecipient(id);
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
