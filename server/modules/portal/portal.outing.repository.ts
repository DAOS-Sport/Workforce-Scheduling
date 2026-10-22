import { db } from "../../infra/db";
import type { Executor } from "../../infra/db/tx";
import { eq, desc } from "drizzle-orm";
import { outingRecords, type InsertOutingRecord, type OutingRecord } from "@shared/schema";

export const outingRepository = {
  async create(data: InsertOutingRecord, tx: Executor = db): Promise<OutingRecord> {
    const [record] = await tx.insert(outingRecords).values(data).returning();
    return record;
  },

  async listByEmployee(employeeId: number, tx: Executor = db): Promise<OutingRecord[]> {
    return tx.select().from(outingRecords).where(eq(outingRecords.employeeId, employeeId)).orderBy(desc(outingRecords.createdAt));
  },

  async listAll(tx: Executor = db): Promise<OutingRecord[]> {
    return tx.select().from(outingRecords).orderBy(desc(outingRecords.createdAt));
  },
};
