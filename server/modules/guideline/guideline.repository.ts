import { db } from "../../db";
import { eq, desc } from "drizzle-orm";
import {
  guidelines,
  guidelineAcknowledgments,
  employees,
  venues,
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

async function assertGuidelineVenueExists(venueId: number | null | undefined): Promise<void> {
  if (venueId == null) return;
  const [venue] = await db.select({ id: venues.id }).from(venues).where(eq(venues.id, venueId));
  if (!venue) throw new Error(`Invalid guideline venueId ${venueId}: venue does not exist`);
}

async function assertGuidelineAckReferences(data: InsertGuidelineAck): Promise<void> {
  const [[guideline], [employee]] = await Promise.all([
    db.select({ id: guidelines.id }).from(guidelines).where(eq(guidelines.id, data.guidelineId)),
    db.select({ id: employees.id }).from(employees).where(eq(employees.id, data.employeeId)),
  ]);
  if (!guideline) throw new Error(`Invalid guideline acknowledgment guidelineId ${data.guidelineId}: guideline does not exist`);
  if (!employee) throw new Error(`Invalid guideline acknowledgment employeeId ${data.employeeId}: employee does not exist`);
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
    await assertGuidelineVenueExists(data.venueId);
    const [g] = await db.insert(guidelines).values(data).returning();
    return g;
  },

  async updateGuideline(id: number, data: Partial<InsertGuideline>): Promise<Guideline | undefined> {
    if (data.venueId !== undefined) await assertGuidelineVenueExists(data.venueId);
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
    await assertGuidelineAckReferences(data);
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
