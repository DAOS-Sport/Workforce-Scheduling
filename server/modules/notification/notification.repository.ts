import { db } from "../../infra/db";
import type { Executor } from "../../infra/db/tx";
import { and, eq, desc, ne, sql } from "drizzle-orm";
import {
  notificationRecipients,
  type NotificationRecipient,
  type InsertNotificationRecipient,
} from "@shared/schema";

export const notificationRepository = {
  async getNotificationRecipients(tx: Executor = db): Promise<NotificationRecipient[]> {
    return tx.select().from(notificationRecipients).orderBy(desc(notificationRecipients.createdAt));
  },

  /** A recipient with this address in any letter case, other than `exceptId`. */
  async findByEmail(email: string, exceptId?: number, tx: Executor = db): Promise<NotificationRecipient | undefined> {
    const sameAddress = sql`lower(${notificationRecipients.email}) = lower(${email})`;
    const [record] = await tx
      .select()
      .from(notificationRecipients)
      .where(exceptId === undefined ? sameAddress : and(sameAddress, ne(notificationRecipients.id, exceptId)))
      .limit(1);
    return record;
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
