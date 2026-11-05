import { db } from "../../infra/db";
import type { Executor } from "../../infra/db/tx";
import { eq, desc, count, sql, getTableColumns } from "drizzle-orm";
import {
  anomalyReports,
  type AnomalyReport,
  type InsertAnomalyReport,
} from "@shared/schema";

export type AnomalyReportListItem = Omit<AnomalyReport, "imageUrls"> & { imageCount: number };

const { imageUrls: _imageUrls, ...listColumns } = getTableColumns(anomalyReports);

export const anomalyRepository = {
  async createAnomalyReport(data: InsertAnomalyReport, tx: Executor = db): Promise<AnomalyReport> {
    const [record] = await tx.insert(anomalyReports).values(data).returning();
    return record;
  },

  /** image_urls holds base64 data URLs (tens of MB across all rows), so the list only carries a count. */
  async getAnomalyReports(tx: Executor = db): Promise<AnomalyReportListItem[]> {
    return tx
      .select({
        ...listColumns,
        imageCount: sql<number>`coalesce(cardinality(${anomalyReports.imageUrls}), 0)`.mapWith(Number),
      })
      .from(anomalyReports)
      .orderBy(desc(anomalyReports.createdAt));
  },

  async getAnomalyReport(id: number, tx: Executor = db): Promise<AnomalyReport | undefined> {
    const [record] = await tx.select().from(anomalyReports).where(eq(anomalyReports.id, id));
    return record;
  },

  async updateAnomalyResolution(id: number, resolution: string, resolvedNote?: string, tx: Executor = db): Promise<AnomalyReport | undefined> {
    const [record] = await tx.update(anomalyReports).set({
      resolution,
      resolvedNote: resolvedNote || null,
    }).where(eq(anomalyReports.id, id)).returning();
    return record;
  },

  async deleteAnomalyReport(id: number, tx: Executor = db): Promise<void> {
    await tx.delete(anomalyReports).where(eq(anomalyReports.id, id));
  },

  async countPendingReports(tx: Executor = db): Promise<number> {
    const [row] = await tx.select({ cnt: count() }).from(anomalyReports).where(eq(anomalyReports.resolution, "pending"));
    return Number(row?.cnt ?? 0);
  },
};
