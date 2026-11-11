import { sql } from "drizzle-orm";
import { db } from "../../infra/db";
import type { AuditActor } from "../../shared/audit/actor";

export type TimelineOptions = { employeeId?: number; entity?: string; recordId?: string; since?: Date; limit?: number; cursor?: number };
export type TimelineItem = {
  id: string; entity: string; recordId: string; employeeId: number | null;
  at: string; action: string; actor: AuditActor; before: unknown; after: unknown;
  source: "audit" | "original";
};

export const auditRepository = {
  async timeline(options: TimelineOptions): Promise<TimelineItem[]> {
    const conditions = [sql`true`];
    if (options.employeeId !== undefined) conditions.push(sql`(employee_id = ${options.employeeId}
      OR COALESCE(before_data->>'employeeId',before_data->>'employee_id')::int = ${options.employeeId}
      OR COALESCE(after_data->>'employeeId',after_data->>'employee_id')::int = ${options.employeeId})`);
    if (options.entity !== undefined) conditions.push(sql`entity = ${options.entity}`);
    if (options.recordId !== undefined) conditions.push(sql`record_id = ${options.recordId}`);
    if (options.since) conditions.push(sql`at >= ${options.since.toISOString()}::timestamptz`);
    const result = await db.execute(sql`
      WITH timeline AS (
        SELECT 'operation:' || id AS id, entity, record_id, employee_id,
          created_at AT TIME ZONE 'UTC' AS at, action, actor, before_data, after_data, 'audit' AS source
        FROM operation_audit
        UNION ALL
        SELECT 'shift:' || id, 'shifts', shift_id::text,
          COALESCE((payload->'after'->>'employeeId')::int,(payload->'before'->>'employeeId')::int),
          created_at AT TIME ZONE 'UTC', action,
          COALESCE(payload->'actor',jsonb_build_object('kind','system','name','歷史來源：' || actor)),
          payload->'before',payload->'after','audit'
        FROM shift_audit_log
        UNION ALL
        SELECT 'dispatch:' || id, 'dispatch_shifts', dispatch_shift_id::text,
          COALESCE((payload->'after'->>'linkedEmployeeId')::int,(payload->'before'->>'linkedEmployeeId')::int),
          created_at AT TIME ZONE 'UTC', action,
          COALESCE(payload->'actor',jsonb_build_object('kind','system','name','歷史來源：' || actor)),
          payload->'before',payload->'after','audit'
        FROM dispatch_shift_audit_log
        UNION ALL
        SELECT 'clock-original:' || c.id, 'clock_records', c.id::text,COALESCE((first_change.before_data->>'employeeId')::int,c.employee_id),
          COALESCE((first_change.before_data->>'clockTime')::timestamptz,c.clock_time AT TIME ZONE 'UTC'),
          'submit',jsonb_build_object('kind','employee','employeeId',COALESCE((first_change.before_data->>'employeeId')::int,c.employee_id),'name',e.name),
          NULL,COALESCE(first_change.before_data,to_jsonb(c)),'original'
        FROM clock_records c
        LEFT JOIN LATERAL (SELECT a.before_data FROM operation_audit a WHERE a.entity='clock_records' AND a.record_id=c.id::text AND a.before_data IS NOT NULL ORDER BY a.id LIMIT 1) first_change ON TRUE
        LEFT JOIN employees e ON e.id=COALESCE((first_change.before_data->>'employeeId')::int,c.employee_id)
        WHERE NOT EXISTS (SELECT 1 FROM operation_audit a WHERE a.entity='clock_records' AND a.record_id=c.id::text AND a.action='create')
        UNION ALL
        SELECT 'clock-original:' || a.record_id,'clock_records',a.record_id,COALESCE((a.before_data->>'employeeId')::int,a.employee_id),
          (a.before_data->>'clockTime')::timestamptz,'submit',jsonb_build_object('kind','employee','employeeId',COALESCE((a.before_data->>'employeeId')::int,a.employee_id)),
          NULL,a.before_data,'original'
        FROM operation_audit a
        WHERE a.entity='clock_records' AND a.before_data->>'clockTime' IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM clock_records c WHERE c.id::text=a.record_id)
          AND NOT EXISTS (SELECT 1 FROM operation_audit n WHERE n.entity='clock_records' AND n.record_id=a.record_id AND n.action='create')
          AND a.id=(SELECT min(n.id) FROM operation_audit n WHERE n.entity='clock_records' AND n.record_id=a.record_id)
        UNION ALL
        SELECT 'leave-original:' || l.id,'leave_requests',l.id::text,l.employee_id,
          l.created_at AT TIME ZONE 'UTC','submit',jsonb_build_object('kind','employee','employeeId',l.employee_id,'name',e.name),
          NULL,COALESCE(first_change.before_data,to_jsonb(l)),'original'
        FROM leave_requests l LEFT JOIN employees e ON e.id=l.employee_id
        LEFT JOIN LATERAL (SELECT a.before_data FROM operation_audit a WHERE a.entity='leave_requests' AND a.record_id=l.id::text AND a.before_data IS NOT NULL ORDER BY a.id LIMIT 1) first_change ON TRUE
        UNION ALL
        SELECT 'amendment-original:' || c.id,'clock_amendments',c.id::text,c.employee_id,
          c.created_at AT TIME ZONE 'UTC','submit',jsonb_build_object('kind','employee','employeeId',c.employee_id,'name',e.name),
          NULL,COALESCE(first_change.before_data,to_jsonb(c)),'original'
        FROM clock_amendments c LEFT JOIN employees e ON e.id=c.employee_id
        LEFT JOIN LATERAL (SELECT a.before_data FROM operation_audit a WHERE a.entity='clock_amendments' AND a.record_id=c.id::text AND a.before_data IS NOT NULL ORDER BY a.id LIMIT 1) first_change ON TRUE
      )
      SELECT * FROM timeline WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY at DESC NULLS LAST,id DESC LIMIT ${options.limit ?? 100} OFFSET ${options.cursor ?? 0}
    `);
    return result.rows.map((row) => ({
      id: String(row.id), entity: String(row.entity), recordId: String(row.record_id), employeeId: row.employee_id == null ? null : Number(row.employee_id),
      at: row.at instanceof Date ? row.at.toISOString() : new Date(String(row.at)).toISOString(),
      action: String(row.action), actor: row.actor as AuditActor, before: row.before_data ?? null, after: row.after_data ?? null,
      source: row.source as TimelineItem["source"],
    }));
  },
};
