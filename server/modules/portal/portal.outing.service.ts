import { db } from "../../infra/db";
import { outingRecords } from "../../../shared/schema";
import { eq, desc } from "drizzle-orm";

export async function createOutingRecord(body: any) {
  const { employeeId, outType, destination, note, latitude, longitude, accuracy, imageUrl } = body;
  const [record] = await db
    .insert(outingRecords)
    .values({
      employeeId: Number(employeeId),
      outType,
      destination: destination?.trim() || null,
      note: note?.trim() || null,
      latitude: Number(latitude),
      longitude: Number(longitude),
      accuracy: accuracy != null ? Number(accuracy) : null,
      imageUrl: imageUrl || null,
      status: "submitted",
    })
    .returning();
  return record;
}

export function listEmployeeOutingRecords(employeeId: number) {
  return db
    .select()
    .from(outingRecords)
    .where(eq(outingRecords.employeeId, employeeId))
    .orderBy(desc(outingRecords.createdAt));
}

export function listAllOutingRecords() {
  return db.select().from(outingRecords).orderBy(desc(outingRecords.createdAt));
}
