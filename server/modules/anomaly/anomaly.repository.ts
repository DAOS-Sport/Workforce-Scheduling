import { db } from "../../db";
import { eq, desc, sql, getTableColumns } from "drizzle-orm";
import {
  anomalyReports,
  type AnomalyReport,
  type InsertAnomalyReport,
} from "@shared/schema";

export type AnomalyReportListItem = Omit<AnomalyReport, "imageUrls"> & { imageCount: number };

const { imageUrls: _imageUrls, ...listColumns } = getTableColumns(anomalyReports);

export const anomalyRepository = {
  async createAnomalyReport(data: InsertAnomalyReport): Promise<AnomalyReport> {
    const [record] = await db.insert(anomalyReports).values(data).returning();
    return record;
  },

  /** image_urls holds base64 data URLs (tens of MB across all rows), so the list only carries a count. */
  async getAnomalyReports(): Promise<AnomalyReportListItem[]> {
    return db
      .select({
        ...listColumns,
        imageCount: sql<number>`coalesce(cardinality(${anomalyReports.imageUrls}), 0)`.mapWith(Number),
      })
      .from(anomalyReports)
      .orderBy(desc(anomalyReports.createdAt));
  },

  async getAnomalyReport(id: number): Promise<AnomalyReport | undefined> {
    const [record] = await db.select().from(anomalyReports).where(eq(anomalyReports.id, id));
    return record;
  },

  async updateAnomalyResolution(id: number, resolution: string, resolvedNote?: string): Promise<AnomalyReport | undefined> {
    const [record] = await db.update(anomalyReports).set({
      resolution,
      resolvedNote: resolvedNote || null,
    }).where(eq(anomalyReports.id, id)).returning();
    return record;
  },

  async deleteAnomalyReport(id: number): Promise<void> {
    await db.delete(anomalyReports).where(eq(anomalyReports.id, id));
  },

};
