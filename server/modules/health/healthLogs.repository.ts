import { sql, type SQL } from "drizzle-orm";
import { db } from "../../infra/db";
import type { HealthLogEntry } from "../../core/health/types";

const logColumns = sql`id, to_char(occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at,
  level, pipeline, request_id as "requestId", message`;

export async function readHealthLogRows(options: {
  pipeline?: string;
  since?: string;
  level?: "info" | "warn" | "error";
  limit: number;
  before?: { at: string; id: number };
}): Promise<HealthLogEntry[]> {
  const conditions: SQL[] = [];
  if (options.pipeline) conditions.push(sql`pipeline = ${options.pipeline}`);
  if (options.since) conditions.push(sql`occurred_at >= ${options.since}::timestamp`);
  if (options.level === "warn") conditions.push(sql`level in ('warn', 'error')`);
  if (options.level === "error") conditions.push(sql`level = 'error'`);
  if (options.before) conditions.push(sql`(occurred_at, id) < (${options.before.at}::timestamp, ${options.before.id})`);
  const where = conditions.length ? sql`where ${sql.join(conditions, sql` and `)}` : sql``;
  const result = await db.execute(sql`select ${logColumns} from app_logs ${where}
    order by occurred_at desc, id desc limit ${options.limit}`);
  return result.rows as unknown as HealthLogEntry[];
}

export async function readRecentPipelineLogs(pipelines: string[], since: string, until: string): Promise<HealthLogEntry[]> {
  const ids = sql.join(pipelines.map((id) => sql`${id}`), sql`, `);
  const result = await db.execute(sql`with ranked as (
    select *, row_number() over (partition by pipeline order by occurred_at desc, id desc) as position
    from app_logs where pipeline in (${ids}) and level in ('warn', 'error')
      and occurred_at >= ${since}::timestamp and occurred_at <= ${until}::timestamp
  ) select ${logColumns} from ranked where position <= 20 order by occurred_at desc, id desc`);
  return result.rows as unknown as HealthLogEntry[];
}
