import { lt } from "drizzle-orm";
import { appLogs } from "@shared/schema";
import { db } from "./db";
import type { LogEntry } from "../shared/logging/buffer";

export const writeLogBatch = (batch: LogEntry[]) => db.insert(appLogs).values(batch);
export async function deleteLogsBefore(cutoff: Date): Promise<number> {
  const deleted = await db.delete(appLogs).where(lt(appLogs.occurredAt, cutoff)).returning({ id: appLogs.id });
  return deleted.length;
}
