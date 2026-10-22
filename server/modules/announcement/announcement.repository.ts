import { db } from "../../infra/db";
import type { Executor } from "../../infra/db/tx";
import { eq } from "drizzle-orm";
import { announcements, type Announcement, type InsertAnnouncement } from "@shared/schema";

export const announcementRepository = {
  async create(data: InsertAnnouncement, tx: Executor = db): Promise<Announcement> {
    const [ann] = await tx.insert(announcements).values(data).returning();
    return ann;
  },

  async list(tx: Executor = db): Promise<Announcement[]> {
    return tx.select().from(announcements).orderBy(announcements.publishedAt);
  },

  async remove(id: number, tx: Executor = db): Promise<void> {
    await tx.delete(announcements).where(eq(announcements.id, id));
  },
};
