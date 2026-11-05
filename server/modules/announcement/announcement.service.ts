/**
 * Announcement service plus the cross-domain pending-counts roll-up
 * that powers the admin dashboard badge.
 */
import { insertAnnouncementSchema, type Announcement } from "@shared/schema";
import { announcementRepository } from "./announcement.repository";
import { clockService } from "../clock/clock.service";
import { overtimeService } from "../overtime/overtime.service";
import { leaveService } from "../leave/leave.service";
import { anomalyService } from "../anomaly/anomaly.service";

export const announcementService = {
  async pendingCounts() {
    const [clockAmt, overtimeAmt, leaveAmt, anomalyAmt] = await Promise.all([
      clockService.countPendingAmendments(),
      overtimeService.countPendingRequests(),
      leaveService.countPendingRequests(),
      anomalyService.countPendingReports(),
    ]);
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
    return announcementRepository.create(parsed);
  },

  list: () => announcementRepository.list(),

  async remove(id: number) {
    await announcementRepository.remove(id);
  },

  async listActive(regionCode?: string) {
    const now = new Date();
    const all = await announcementRepository.list();
    const active = all.filter((a) => !a.expiresAt || new Date(a.expiresAt) > now);
    return regionCode
      ? active.filter((a) => !a.targetRegion || a.targetRegion === regionCode)
      : active;
  },
};
