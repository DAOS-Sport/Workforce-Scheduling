import { db } from "../../infra/db";
import type { Executor } from "../../infra/db/tx";
import { eq, desc } from "drizzle-orm";
import {
  guidelines,
  guidelineAcknowledgments,
  employees,
  type Guideline,
  type InsertGuideline,
  type GuidelineAck,
  type InsertGuidelineAck,
} from "@shared/schema";

export interface GuidelineAckDetail {
  id: number;
  guidelineId: number;
  employeeId: number;
  acknowledgedAt: Date | null;
  guidelineTitle: string | null;
  guidelineCategory: string | null;
  employeeName: string | null;
  employeeCode: string | null;
}

export const guidelineRepository = {
  async getGuidelines(category?: string, tx: Executor = db): Promise<Guideline[]> {
    if (category) {
      return tx.select().from(guidelines).where(eq(guidelines.category, category)).orderBy(guidelines.sortOrder);
    }
    return tx.select().from(guidelines).orderBy(guidelines.sortOrder);
  },

  async getGuideline(id: number, tx: Executor = db): Promise<Guideline | undefined> {
    const [g] = await tx.select().from(guidelines).where(eq(guidelines.id, id));
    return g;
  },

  async createGuideline(data: InsertGuideline, tx: Executor = db): Promise<Guideline> {
    const [g] = await tx.insert(guidelines).values(data).returning();
    return g;
  },

  async updateGuideline(id: number, data: Partial<InsertGuideline>, tx: Executor = db): Promise<Guideline | undefined> {
    const [g] = await tx.update(guidelines).set({ ...data, updatedAt: new Date() }).where(eq(guidelines.id, id)).returning();
    return g;
  },

  async deleteGuidelineAcks(guidelineId: number, tx: Executor = db): Promise<void> {
    await tx.delete(guidelineAcknowledgments).where(eq(guidelineAcknowledgments.guidelineId, guidelineId));
  },

  async deleteGuideline(id: number, tx: Executor = db): Promise<boolean> {
    const result = await tx.delete(guidelines).where(eq(guidelines.id, id)).returning();
    return result.length > 0;
  },

  async getGuidelineAcks(guidelineId: number, tx: Executor = db): Promise<GuidelineAck[]> {
    return tx.select().from(guidelineAcknowledgments).where(eq(guidelineAcknowledgments.guidelineId, guidelineId));
  },

  async createGuidelineAck(data: InsertGuidelineAck, tx: Executor = db): Promise<GuidelineAck> {
    const [ack] = await tx.insert(guidelineAcknowledgments).values(data).returning();
    return ack;
  },

  async getGuidelineAcksByEmployee(employeeId: number, tx: Executor = db): Promise<GuidelineAck[]> {
    return tx.select().from(guidelineAcknowledgments).where(eq(guidelineAcknowledgments.employeeId, employeeId));
  },

  async getAllGuidelineAcksWithDetails(tx: Executor = db): Promise<GuidelineAckDetail[]> {
    return tx
      .select({
        id: guidelineAcknowledgments.id,
        guidelineId: guidelineAcknowledgments.guidelineId,
        employeeId: guidelineAcknowledgments.employeeId,
        acknowledgedAt: guidelineAcknowledgments.acknowledgedAt,
        guidelineTitle: guidelines.title,
        guidelineCategory: guidelines.category,
        employeeName: employees.name,
        employeeCode: employees.employeeCode,
      })
      .from(guidelineAcknowledgments)
      .leftJoin(guidelines, eq(guidelineAcknowledgments.guidelineId, guidelines.id))
      .leftJoin(employees, eq(guidelineAcknowledgments.employeeId, employees.id))
      .orderBy(desc(guidelineAcknowledgments.acknowledgedAt));
  },

};
