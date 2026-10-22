import { db } from "../../infra/db";
import type { Executor } from "../../infra/db/tx";
import { eq, desc, count } from "drizzle-orm";
import {
  anomalyReports,
  type AnomalyReport,
  type InsertAnomalyReport,
} from "@shared/schema";

export const anomalyRepository = {
  async createAnomalyReport(data: InsertAnomalyReport, tx: Executor = db): Promise<AnomalyReport> {
    const [record] = await tx.insert(anomalyReports).values(data).returning();
    return record;
  },

  async getAnomalyReports(tx: Executor = db): Promise<AnomalyReport[]> {
    return tx.select().from(anomalyReports).orderBy(desc(anomalyReports.createdAt));
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
