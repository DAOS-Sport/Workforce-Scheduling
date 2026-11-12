import { sql } from "drizzle-orm";
import type { AppErrorRow } from "@shared/schema";
import { db } from "../../infra/db";

export type EvidenceError = Pick<AppErrorRow, "id" | "occurredAt" | "requestId" | "method" | "path" | "status">;

/** Five per raw path suffice for the newest five of every attributed pipeline. */
export async function readDrilldownErrors(now: Date): Promise<EvidenceError[]> {
  const result = await db.execute(sql`with ranked_errors as (
    select id, occurred_at, request_id, method, path, status,
      row_number() over (partition by path order by occurred_at desc, id desc) as position
    from app_errors where status >= 500 and status < 600
      and occurred_at >= ${new Date(now.getTime() - 24 * 60 * 60_000).toISOString()}::timestamptz
      and occurred_at <= ${now.toISOString()}::timestamptz
  ) select id, occurred_at as "occurredAt", request_id as "requestId", method, path, status
    from ranked_errors where position <= 5 order by occurred_at desc, id desc`);
  // Drizzle raw execute leaves PostgreSQL timestamps as strings.
  return (result.rows as Array<Omit<EvidenceError, "occurredAt"> & { occurredAt: string | Date }>)
    .map(row => ({ ...row, occurredAt: new Date(row.occurredAt) }));
}
