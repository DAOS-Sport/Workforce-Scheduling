import { db } from "../../infra/db";
import { eq, desc } from "drizzle-orm";
import {
  notificationRecipients,
  type NotificationRecipient,
  type InsertNotificationRecipient,
} from "@shared/schema";

export const notificationRepository = {
  async getNotificationRecipients(): Promise<NotificationRecipient[]> {
    return db.select().from(notificationRecipients).orderBy(desc(notificationRecipients.createdAt));
  },

  async createNotificationRecipient(data: InsertNotificationRecipient): Promise<NotificationRecipient> {
    const [record] = await db.insert(notificationRecipients).values(data).returning();
    return record;
  },

  async updateNotificationRecipient(id: number, data: Partial<InsertNotificationRecipient>): Promise<NotificationRecipient | undefined> {
    const [record] = await db.update(notificationRecipients).set(data).where(eq(notificationRecipients.id, id)).returning();
    return record;
  },

  async deleteNotificationRecipient(id: number): Promise<void> {
    await db.delete(notificationRecipients).where(eq(notificationRecipients.id, id));
  },

};
