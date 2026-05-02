import { db } from "../../db";
import { eq, desc } from "drizzle-orm";
import {
  anomalyReports,
  type AnomalyReport,
  type InsertAnomalyReport,
} from "@shared/schema";

export const anomalyRepository = {
  async createAnomalyReport(data: InsertAnomalyReport): Promise<AnomalyReport> {
    const [record] = await db.insert(anomalyReports).values(data).returning();
    return record;
  },

  async getAnomalyReports(): Promise<AnomalyReport[]> {
    return db.select().from(anomalyReports).orderBy(desc(anomalyReports.createdAt));
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
