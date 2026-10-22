import { db } from "../../infra/db";
import type { Executor } from "../../infra/db/tx";
import { eq, desc } from "drizzle-orm";
import {
  notificationRecipients,
  type NotificationRecipient,
  type InsertNotificationRecipient,
} from "@shared/schema";

export const notificationRepository = {
  async getNotificationRecipients(tx: Executor = db): Promise<NotificationRecipient[]> {
    return tx.select().from(notificationRecipients).orderBy(desc(notificationRecipients.createdAt));
  },

  async createNotificationRecipient(data: InsertNotificationRecipient, tx: Executor = db): Promise<NotificationRecipient> {
    const [record] = await tx.insert(notificationRecipients).values(data).returning();
    return record;
  },

  async updateNotificationRecipient(id: number, data: Partial<InsertNotificationRecipient>, tx: Executor = db): Promise<NotificationRecipient | undefined> {
    const [record] = await tx.update(notificationRecipients).set(data).where(eq(notificationRecipients.id, id)).returning();
    return record;
  },

  async deleteNotificationRecipient(id: number, tx: Executor = db): Promise<void> {
    await tx.delete(notificationRecipients).where(eq(notificationRecipients.id, id));
  },

};
