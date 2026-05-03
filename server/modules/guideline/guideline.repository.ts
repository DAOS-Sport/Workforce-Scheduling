import { db } from "../../db";
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
  async getGuidelines(category?: string): Promise<Guideline[]> {
    if (category) {
      return db.select().from(guidelines).where(eq(guidelines.category, category)).orderBy(guidelines.sortOrder);
    }
    return db.select().from(guidelines).orderBy(guidelines.sortOrder);
  },

  async getGuideline(id: number): Promise<Guideline | undefined> {
    const [g] = await db.select().from(guidelines).where(eq(guidelines.id, id));
    return g;
  },

  async createGuideline(data: InsertGuideline): Promise<Guideline> {
    const [g] = await db.insert(guidelines).values(data).returning();
    return g;
  },

  async updateGuideline(id: number, data: Partial<InsertGuideline>): Promise<Guideline | undefined> {
    const [g] = await db.update(guidelines).set({ ...data, updatedAt: new Date() }).where(eq(guidelines.id, id)).returning();
    return g;
  },

  async deleteGuideline(id: number): Promise<boolean> {
    await db.delete(guidelineAcknowledgments).where(eq(guidelineAcknowledgments.guidelineId, id));
    const result = await db.delete(guidelines).where(eq(guidelines.id, id)).returning();
    return result.length > 0;
  },

  async getGuidelineAcks(guidelineId: number): Promise<GuidelineAck[]> {
    return db.select().from(guidelineAcknowledgments).where(eq(guidelineAcknowledgments.guidelineId, guidelineId));
  },

  async createGuidelineAck(data: InsertGuidelineAck): Promise<GuidelineAck> {
    const [ack] = await db.insert(guidelineAcknowledgments).values(data).returning();
    return ack;
  },

  async getGuidelineAcksByEmployee(employeeId: number): Promise<GuidelineAck[]> {
    return db.select().from(guidelineAcknowledgments).where(eq(guidelineAcknowledgments.employeeId, employeeId));
  },

  async getAllGuidelineAcksWithDetails(): Promise<GuidelineAckDetail[]> {
    return db
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
