/**
 * Announcement service plus the cross-domain pending-counts roll-up
 * that powers the admin dashboard badge.
 *
 * The pending-counts query is intentionally flat on purpose — duplicating
 * the four aggregations here is faster than asking each domain service
 * for its pending count over a separate round trip.
 */
import { db } from "../../db";
import { eq, count } from "drizzle-orm";
import {
  announcements,
  insertAnnouncementSchema,
  clockAmendments,
  overtimeRequests,
  leaveRequests,
  anomalyReports,
  type Announcement,
} from "@shared/schema";

export const announcementService = {
  async pendingCounts() {
    const [caRows, otRows, lrRows, arRows] = await Promise.all([
      db.select({ cnt: count() }).from(clockAmendments).where(eq(clockAmendments.status, "pending")),
      db.select({ cnt: count() }).from(overtimeRequests).where(eq(overtimeRequests.status, "pending")),
      db.select({ cnt: count() }).from(leaveRequests).where(eq(leaveRequests.status, "pending")),
      db.select({ cnt: count() }).from(anomalyReports).where(eq(anomalyReports.resolution, "pending")),
    ]);
    const clockAmt = Number(caRows[0]?.cnt ?? 0);
    const overtimeAmt = Number(otRows[0]?.cnt ?? 0);
    const leaveAmt = Number(lrRows[0]?.cnt ?? 0);
    const anomalyAmt = Number(arRows[0]?.cnt ?? 0);
    return {
      clockAmendments: clockAmt,
      overtimeRequests: overtimeAmt,
      leaveRequests: leaveAmt,
      anomalyReports: anomalyAmt,
      total: clockAmt + overtimeAmt + leaveAmt + anomalyAmt,
    };
  },

  async create(payload: unknown): Promise<Announcement> {
    const parsed = insertAnnouncementSchema.parse(payload);
    const [ann] = await db.insert(announcements).values(parsed).returning();
    return ann;
  },

  list: () => db.select().from(announcements).orderBy(announcements.publishedAt),

  async remove(id: number) {
    await db.delete(announcements).where(eq(announcements.id, id));
  },

  async listActive(regionCode?: string) {
    const now = new Date();
    const all = await db.select().from(announcements).orderBy(announcements.publishedAt);
    const active = all.filter((a) => !a.expiresAt || new Date(a.expiresAt) > now);
    return regionCode
      ? active.filter((a) => !a.targetRegion || a.targetRegion === regionCode)
      : active;
  },
};
