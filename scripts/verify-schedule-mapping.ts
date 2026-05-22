import assert from "node:assert/strict";
import { pool } from "../server/infra/db";
import {
  countAssignedToScheduleSlot,
  normalizeCoworkerGroupRole,
  normalizeScheduleRole,
  shiftOverlapsScheduleSlot,
  type ScheduleSlotLike,
  type ShiftLike,
} from "../shared/scheduleMapping";

const includeDetails = process.argv.includes("--details");
const detailLimitArg = process.argv.find((arg) => arg.startsWith("--detail-limit="));
const detailLimit = Math.max(1, Math.min(100, Number(detailLimitArg?.split("=")[1] ?? 20) || 20));
const SQL_NON_WORK_ROLES = "('休假','特休','病假','事假','喪假','公假','生理假','國定假','婚假','補休','曠職','育嬰','留職停薪')";

const SQL_NORMALIZED_ROLE = `
  replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
    regexp_replace(role, '\\s+', '', 'g'),
    'lifeguard', '救生'),
    'counter', '櫃檯'),
    'cleaning', '清潔'),
    'manager', '管理'),
    '櫃台', '櫃檯'),
    '櫃臺', '櫃檯'),
    '指導員', '教練'),
    '主管職', '管理'),
    '行政專員', '行政'),
    '資訊班', '資訊'),
    '在校實習', '無職')
`;

function normalizedRoleSql(column: string): string {
  return `
    replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
      regexp_replace(${column}, '\\s+', '', 'g'),
      'lifeguard', '救生'),
      'counter', '櫃檯'),
      'cleaning', '清潔'),
      'manager', '管理'),
      '櫃台', '櫃檯'),
      '櫃臺', '櫃檯'),
      '指導員', '教練'),
      '主管職', '管理'),
      '行政專員', '行政'),
      '資訊班', '資訊'),
      '在校實習', '無職')
  `;
}

function timeMinutesSql(column: string): string {
  return `
    split_part(left(${column}, 5), ':', 1)::int * 60
    + split_part(left(${column}, 5), ':', 2)::int
  `;
}

function intervalEndMinutesSql(startColumn: string, endColumn: string): string {
  const start = timeMinutesSql(startColumn);
  const end = timeMinutesSql(endColumn);
  return `(case when (${end}) <= (${start}) then (${end}) + 1440 else (${end}) end)`;
}

function slotOverlapConditionSql(shiftAlias: string, slotAlias: string): string {
  const shiftStart = timeMinutesSql(`${shiftAlias}.start_time::text`);
  const shiftEnd = intervalEndMinutesSql(`${shiftAlias}.start_time::text`, `${shiftAlias}.end_time::text`);
  const slotStart = timeMinutesSql(`${slotAlias}.start_time`);
  const slotEnd = intervalEndMinutesSql(`${slotAlias}.start_time`, `${slotAlias}.end_time`);
  return `
    greatest(0, least(${shiftEnd}, ${slotEnd}) - greatest(${shiftStart}, ${slotStart}))
    >= ((${slotEnd}) - (${slotStart})) * 0.5
  `;
}

function runSyntheticRegression() {
  const may23Slot: ScheduleSlotLike = {
    venueId: 2,
    date: "2026-05-23",
    startTime: "05:30",
    endTime: "14:00",
    role: "救生",
    requiredCount: 2,
  };
  const may23Shifts: ShiftLike[] = [
    { venueId: 2, date: "2026-05-23", startTime: "05:30", endTime: "14:00", role: "救生" },
    { venueId: 2, date: "2026-05-23", startTime: "05:30", endTime: "14:00", role: "救生" },
    { venueId: 2, date: "2026-05-23", startTime: "05:30", endTime: "14:00", role: "櫃台" },
  ];

  assert.equal(countAssignedToScheduleSlot(may23Slot, may23Shifts), 2);
  assert.equal(shiftOverlapsScheduleSlot(may23Shifts[2], may23Slot), false);

  const may24Slot: ScheduleSlotLike = {
    venueId: 2,
    date: "2026-05-24",
    startTime: "05:30",
    endTime: "14:15",
    role: "救生",
    requiredCount: 2,
  };
  const may24Shifts: ShiftLike[] = [
    { venueId: 2, date: "2026-05-24", startTime: "05:30", endTime: "14:00", role: "救生" },
    { venueId: 2, date: "2026-05-24", startTime: "05:30", endTime: "14:00", role: "救生" },
  ];

  assert.equal(countAssignedToScheduleSlot(may24Slot, may24Shifts), 2);
  assert.equal(normalizeScheduleRole("櫃台"), "櫃檯");
  assert.equal(normalizeScheduleRole("櫃臺"), "櫃檯");
  assert.equal(normalizeScheduleRole(" 救生 "), "救生");
  assert.equal(normalizeScheduleRole("救 生"), "救生");

  const feedbackCoworkerRoles = ["救生", " 救生 ", "救 生", "守望"];
  const groupedRoles = new Map<string, number>();
  for (const role of feedbackCoworkerRoles) {
    const key = normalizeCoworkerGroupRole(role);
    groupedRoles.set(key, (groupedRoles.get(key) ?? 0) + 1);
  }
  assert.deepEqual(Array.from(groupedRoles.entries()), [["救生", 4]]);
}

async function countRows(sql: string): Promise<number> {
  const result = await pool.query<{ count: string }>(sql);
  return Number(result.rows[0]?.count ?? 0);
}

async function sampleRows(sql: string): Promise<unknown[]> {
  const result = await pool.query(`${sql}\nlimit ${detailLimit}`);
  return result.rows;
}

function buildDetailQueries(): Record<string, string> {
  return {
    dirtyRoleCount: `
      select table_name, id, role, normalized_role
      from (
        select 'shifts' as table_name, id, role, ${normalizedRoleSql("role")} as normalized_role from shifts where role is not null and role <> ${SQL_NORMALIZED_ROLE}
        union all
        select 'schedule_slots' as table_name, id, role, ${normalizedRoleSql("role")} as normalized_role from schedule_slots where role is not null and role <> ${SQL_NORMALIZED_ROLE}
        union all
        select 'dispatch_shifts' as table_name, id, role, ${normalizedRoleSql("role")} as normalized_role from dispatch_shifts where role is not null and role <> ${SQL_NORMALIZED_ROLE}
        union all
        select 'venue_shift_templates' as table_name, id, role, ${normalizedRoleSql("role")} as normalized_role from venue_shift_templates where role is not null and role <> ${SQL_NORMALIZED_ROLE}
        union all
        select 'salary_rate_configs' as table_name, id, role, ${normalizedRoleSql("role")} as normalized_role from salary_rate_configs where role is not null and role <> ${SQL_NORMALIZED_ROLE}
      ) dirty
      order by table_name, id
    `,
    duplicateSlotCount: `
      select venue_id, date::text, left(start_time, 5) as start_time, left(end_time, 5) as end_time, role, count(*)::int
      from schedule_slots
      group by venue_id, date, left(start_time, 5), left(end_time, 5), role
      having count(*) > 1
      order by date, venue_id, start_time, role
    `,
    normalizedDuplicateSlotCount: `
      select venue_id, date::text, left(start_time, 5) as start_time, left(end_time, 5) as end_time, ${SQL_NORMALIZED_ROLE} as normalized_role, array_agg(id order by id) as ids, count(*)::int
      from schedule_slots
      group by venue_id, date, left(start_time, 5), left(end_time, 5), normalized_role
      having count(*) > 1
      order by date, venue_id, start_time, normalized_role
    `,
    normalizedDuplicateTemplateCount: `
      select venue_id, day_type, left(start_time, 5) as start_time, left(end_time, 5) as end_time, ${SQL_NORMALIZED_ROLE} as normalized_role, array_agg(id order by id) as ids, count(*)::int
      from venue_shift_templates
      group by venue_id, day_type, left(start_time, 5), left(end_time, 5), normalized_role
      having count(*) > 1
      order by venue_id, day_type, start_time, normalized_role
    `,
    normalizedDuplicateSalaryRateCount: `
      select ${SQL_NORMALIZED_ROLE} as normalized_role, array_agg(id order by updated_at desc nulls last, id) as ids, array_agg(role order by updated_at desc nulls last, id) as raw_roles, count(*)::int
      from salary_rate_configs
      group by normalized_role
      having count(*) > 1
      order by normalized_role
    `,
    duplicateVenueRequirementCount: `
      select venue_id, day_of_week, left(start_time::text, 5) as start_time, left(end_time::text, 5) as end_time, array_agg(id order by id) as ids, count(*)::int
      from venue_requirements
      group by venue_id, day_of_week, left(start_time::text, 5), left(end_time::text, 5)
      having count(*) > 1
      order by venue_id, day_of_week, start_time
    `,
    invalidVenueRequirementDayCount: `
      select id, venue_id, day_of_week, start_time::text, end_time::text, required_count
      from venue_requirements
      where day_of_week < 0 or day_of_week > 6
      order by id
    `,
    futureCrossRegionCount: `
      select s.id as shift_id, s.date::text, s.employee_id, e.name as employee_name, e.region_id as employee_region_id, s.venue_id, v.short_name as venue_name, v.region_id as venue_region_id, s.role
      from shifts s
      join venues v on v.id = s.venue_id
      join employees e on e.id = s.employee_id
      where s.status = 'active'
        and s.date >= current_date
        and v.region_id is distinct from e.region_id
      order by s.date, s.id
    `,
    futureInactiveShiftEmployeeCount: `
      select s.id as shift_id, s.date::text, s.employee_id, e.name as employee_name, e.status as employee_status, s.venue_id, s.role
      from shifts s
      join employees e on e.id = s.employee_id
      where s.status = 'active'
        and s.date >= current_date
        and e.status <> 'active'
      order by s.date, s.id
    `,
    roleMismatchFillCount: `
      select s.id as shift_id, s.date::text, s.venue_id, s.employee_id, s.start_time::text, s.end_time::text, s.role, ${normalizedRoleSql("s.role")} as normalized_role
      from shifts s
      where s.status = 'active'
        and s.date >= current_date
        and exists (
          select 1 from schedule_slots sl
          where sl.venue_id = s.venue_id
            and sl.date = s.date
            and ${slotOverlapConditionSql("s", "sl")}
        )
        and not exists (
          select 1 from schedule_slots sl
          where sl.venue_id = s.venue_id
            and sl.date = s.date
            and ${slotOverlapConditionSql("s", "sl")}
            and ${normalizedRoleSql("s.role")} = ${normalizedRoleSql("sl.role")}
        )
      order by s.date, s.id
    `,
    roleVariantGroupCount: `
      select venue_id, date::text, left(start_time::text, 5) as start_time, left(end_time::text, 5) as end_time, ${SQL_NORMALIZED_ROLE} as normalized_role, array_agg(distinct role) as raw_roles, count(*)::int
      from shifts
      where status = 'active'
        and date >= current_date
      group by venue_id, date, left(start_time::text, 5), left(end_time::text, 5), normalized_role
      having count(distinct role) > 1
      order by date, venue_id, start_time, normalized_role
    `,
    duplicateActiveShiftCount: `
      select
        employee_id,
        venue_id,
        date::text,
        left(start_time::text, 5) as start_time,
        left(end_time::text, 5) as end_time,
        ${SQL_NORMALIZED_ROLE} as normalized_role,
        array_agg(id order by id) as ids,
        count(*)::int
      from shifts
      where status = 'active'
        and date >= current_date
      group by employee_id, venue_id, date, left(start_time::text, 5), left(end_time::text, 5), normalized_role
      having count(*) > 1
      order by date, employee_id, venue_id, start_time, normalized_role
    `,
    duplicateActiveDispatchShiftCount: `
      select
        coalesce('employee:' || linked_employee_id::text, 'name:' || trim(dispatch_name)) as dispatch_identity,
        venue_id,
        date::text,
        left(start_time::text, 5) as start_time,
        left(end_time::text, 5) as end_time,
        ${SQL_NORMALIZED_ROLE} as normalized_role,
        array_agg(id order by id) as ids,
        count(*)::int
      from dispatch_shifts
      where status <> 'cancelled'
        and date >= current_date
      group by dispatch_identity, venue_id, date, left(start_time::text, 5), left(end_time::text, 5), normalized_role
      having count(*) > 1
      order by date, dispatch_identity, venue_id, start_time, normalized_role
    `,
    dispatchRoleMismatchFillCount: `
      select d.id as dispatch_shift_id, d.date::text, d.venue_id, d.linked_employee_id, d.dispatch_name, d.start_time::text, d.end_time::text, d.role, ${normalizedRoleSql("d.role")} as normalized_role
      from dispatch_shifts d
      where d.status <> 'cancelled'
        and d.venue_id is not null
        and d.date >= current_date
        and exists (
          select 1 from schedule_slots sl
          where sl.venue_id = d.venue_id
            and sl.date = d.date
            and ${slotOverlapConditionSql("d", "sl")}
        )
        and not exists (
          select 1 from schedule_slots sl
          where sl.venue_id = d.venue_id
            and sl.date = d.date
            and ${slotOverlapConditionSql("d", "sl")}
            and ${normalizedRoleSql("d.role")} = ${normalizedRoleSql("sl.role")}
        )
      order by d.date, d.id
    `,
    dispatchLinkedEmployeeNameMismatchCount: `
      select d.id as dispatch_shift_id, d.linked_employee_id, e.name as linked_employee_name, d.dispatch_name, d.date::text, d.venue_id, d.role
      from dispatch_shifts d
      join employees e on e.id = d.linked_employee_id
      where d.status <> 'cancelled'
        and d.dispatch_name is not null
        and trim(d.dispatch_name) <> trim(e.name)
      order by d.date, d.id
    `,
    unlinkedDispatchExactEmployeeNameCount: `
      with unique_active_names as (
        select trim(name) as name, min(id) as employee_id
        from employees
        where status = 'active'
        group by trim(name)
        having count(*) = 1
      )
      select d.id as dispatch_shift_id, d.dispatch_name, u.employee_id as matched_employee_id, d.date::text, d.venue_id, d.role
      from dispatch_shifts d
      join unique_active_names u on u.name = trim(d.dispatch_name)
      where d.status <> 'cancelled'
        and d.linked_employee_id is null
        and d.dispatch_name is not null
      order by d.date, d.id
    `,
    invalidScheduleRequirementCount: `
      select source_table, id, required_count
      from (
        select 'schedule_slots' as source_table, id, required_count from schedule_slots where required_count <= 0
        union all
        select 'venue_shift_templates' as source_table, id, required_count from venue_shift_templates where required_count <= 0
        union all
        select 'venue_requirements' as source_table, id, required_count from venue_requirements where required_count <= 0
      ) invalid
      order by source_table, id
    `,
    invalidScheduleTimeRangeCount: `
      select source_table, id, start_time::text, end_time::text
      from (
        select 'shifts' as source_table, id, start_time::text, end_time::text from shifts where left(start_time::text, 5) = left(end_time::text, 5) and role not in ${SQL_NON_WORK_ROLES}
        union all
        select 'dispatch_shifts' as source_table, id, start_time::text, end_time::text from dispatch_shifts where left(start_time::text, 5) = left(end_time::text, 5)
        union all
        select 'schedule_slots' as source_table, id, start_time::text, end_time::text from schedule_slots where left(start_time::text, 5) = left(end_time::text, 5)
        union all
        select 'venue_shift_templates' as source_table, id, start_time::text, end_time::text from venue_shift_templates where left(start_time::text, 5) = left(end_time::text, 5)
        union all
        select 'venue_requirements' as source_table, id, start_time::text, end_time::text from venue_requirements where left(start_time::text, 5) = left(end_time::text, 5)
      ) invalid
      order by source_table, id
    `,
    orphanShiftEmployeeCount: `
      select s.id as shift_id, s.employee_id, s.date::text, s.venue_id, s.role
      from shifts s
      left join employees e on e.id = s.employee_id
      where e.id is null
      order by s.id
    `,
    orphanShiftVenueCount: `
      select s.id as shift_id, s.venue_id, s.employee_id, s.date::text, s.role
      from shifts s
      left join venues v on v.id = s.venue_id
      where v.id is null
      order by s.id
    `,
    orphanSlotVenueCount: `
      select sl.id as slot_id, sl.venue_id, sl.date::text, sl.start_time, sl.end_time, sl.role
      from schedule_slots sl
      left join venues v on v.id = sl.venue_id
      where v.id is null
      order by sl.id
    `,
    orphanTemplateVenueCount: `
      select t.id as template_id, t.venue_id, t.day_type, t.start_time, t.end_time, t.role
      from venue_shift_templates t
      left join venues v on v.id = t.venue_id
      where v.id is null
      order by t.id
    `,
    orphanVenueRequirementVenueCount: `
      select vr.id as venue_requirement_id, vr.venue_id, vr.day_of_week, vr.start_time::text, vr.end_time::text, vr.required_count
      from venue_requirements vr
      left join venues v on v.id = vr.venue_id
      where v.id is null
      order by vr.id
    `,
    orphanDispatchVenueCount: `
      select d.id as dispatch_shift_id, d.venue_id, d.region_id, d.date::text, d.dispatch_name, d.role
      from dispatch_shifts d
      left join venues v on v.id = d.venue_id
      where d.venue_id is not null
        and v.id is null
      order by d.id
    `,
    orphanDispatchLinkedEmployeeCount: `
      select d.id as dispatch_shift_id, d.linked_employee_id, d.date::text, d.dispatch_name, d.role
      from dispatch_shifts d
      left join employees e on e.id = d.linked_employee_id
      where d.linked_employee_id is not null
        and e.id is null
      order by d.id
    `,
    futureInactiveDispatchLinkedEmployeeCount: `
      select d.id as dispatch_shift_id, d.linked_employee_id, e.name as employee_name, e.status as employee_status, d.date::text, d.dispatch_name, d.role
      from dispatch_shifts d
      join employees e on e.id = d.linked_employee_id
      where d.linked_employee_id is not null
        and d.status <> 'cancelled'
        and d.date >= current_date
        and e.status <> 'active'
      order by d.date, d.id
    `,
    futureDispatchLinkedEmployeeVenueRegionMismatchCount: `
      select d.id as dispatch_shift_id, d.date::text, d.linked_employee_id, e.name as employee_name, e.region_id as employee_region_id, d.venue_id, v.short_name as venue_name, v.region_id as venue_region_id, d.role
      from dispatch_shifts d
      join employees e on e.id = d.linked_employee_id
      join venues v on v.id = d.venue_id
      where d.linked_employee_id is not null
        and d.status <> 'cancelled'
        and d.date >= current_date
        and e.region_id is distinct from v.region_id
      order by d.date, d.id
    `,
    orphanClockEmployeeCount: `
      select cr.id as clock_record_id, cr.employee_id, cr.venue_id, cr.shift_id, cr.clock_type, cr.clock_time
      from clock_records cr
      left join employees e on e.id = cr.employee_id
      where e.id is null
      order by cr.id
    `,
    orphanClockVenueCount: `
      select cr.id as clock_record_id, cr.employee_id, cr.venue_id, cr.shift_id, cr.clock_type, cr.clock_time
      from clock_records cr
      left join venues v on v.id = cr.venue_id
      where cr.venue_id is not null
        and v.id is null
      order by cr.id
    `,
    orphanClockShiftCount: `
      select cr.id as clock_record_id, cr.employee_id, cr.venue_id, cr.shift_id, cr.clock_type, cr.clock_time
      from clock_records cr
      left join shifts s on s.id = cr.shift_id
      where cr.shift_id is not null
        and s.id is null
      order by cr.id
    `,
    clockShiftEmployeeMismatchCount: `
      select cr.id as clock_record_id, cr.employee_id as clock_employee_id, s.employee_id as shift_employee_id, cr.shift_id, cr.clock_time
      from clock_records cr
      join shifts s on s.id = cr.shift_id
      where cr.employee_id <> s.employee_id
      order by cr.id
    `,
    clockShiftVenueMismatchCount: `
      select cr.id as clock_record_id, cr.venue_id as clock_venue_id, s.venue_id as shift_venue_id, cr.shift_id, cr.clock_time
      from clock_records cr
      join shifts s on s.id = cr.shift_id
      where cr.venue_id is not null
        and cr.venue_id <> s.venue_id
      order by cr.id
    `,
    orphanVenueRegionCount: `
      select v.id as venue_id, v.name, v.short_name, v.region_id
      from venues v
      left join regions r on r.id = v.region_id
      where r.id is null
      order by v.id
    `,
    orphanEmployeeRegionCount: `
      select e.id as employee_id, e.name, e.employee_code, e.region_id
      from employees e
      left join regions r on r.id = e.region_id
      where r.id is null
      order by e.id
    `,
    orphanDispatchRegionCount: `
      select d.id as dispatch_shift_id, d.region_id, d.venue_id, d.date::text, d.dispatch_name
      from dispatch_shifts d
      left join regions r on r.id = d.region_id
      where r.id is null
      order by d.id
    `,
    dispatchVenueRegionMismatchCount: `
      select d.id as dispatch_shift_id, d.region_id as dispatch_region_id, d.venue_id, v.region_id as venue_region_id, d.date::text, d.dispatch_name
      from dispatch_shifts d
      join venues v on v.id = d.venue_id
      where d.region_id <> v.region_id
      order by d.id
    `,
    orphanGuidelineAckEmployeeCount: `
      select ga.id as guideline_ack_id, ga.guideline_id, ga.employee_id, ga.acknowledged_at
      from guideline_acknowledgments ga
      left join employees e on e.id = ga.employee_id
      where e.id is null
      order by ga.id
    `,
    orphanClockAmendmentReviewerCount: `
      select ca.id as clock_amendment_id, ca.employee_id, ca.shift_id, ca.reviewed_by, ca.reviewed_by_name, ca.reviewed_at, ca.status
      from clock_amendments ca
      left join employees e on e.id = ca.reviewed_by
      where ca.reviewed_by is not null
        and e.id is null
      order by ca.id
    `,
    orphanClockAmendmentShiftCount: `
      select ca.id as clock_amendment_id, ca.employee_id, ca.venue_id, ca.shift_id, ca.clock_type, ca.requested_time, ca.status
      from clock_amendments ca
      left join shifts s on ca.shift_id > 0 and s.id = ca.shift_id
      left join dispatch_shifts d on ca.shift_id < 0 and d.id = abs(ca.shift_id)
      where (ca.shift_id > 0 and s.id is null)
         or (ca.shift_id < 0 and d.id is null)
      order by ca.id
    `,
    clockAmendmentShiftEmployeeMismatchCount: `
      select ca.id as clock_amendment_id, ca.employee_id as amendment_employee_id, ca.shift_id, s.employee_id as shift_employee_id, d.linked_employee_id as dispatch_employee_id, ca.requested_time
      from clock_amendments ca
      left join shifts s on ca.shift_id > 0 and s.id = ca.shift_id
      left join dispatch_shifts d on ca.shift_id < 0 and d.id = abs(ca.shift_id)
      where (s.id is not null and ca.employee_id <> s.employee_id)
         or (d.id is not null and ca.employee_id <> d.linked_employee_id)
      order by ca.id
    `,
    clockAmendmentShiftVenueMismatchCount: `
      select ca.id as clock_amendment_id, ca.venue_id as amendment_venue_id, ca.shift_id, s.venue_id as shift_venue_id, d.venue_id as dispatch_venue_id, ca.requested_time
      from clock_amendments ca
      left join shifts s on ca.shift_id > 0 and s.id = ca.shift_id
      left join dispatch_shifts d on ca.shift_id < 0 and d.id = abs(ca.shift_id)
      where ca.venue_id is not null
        and ((s.id is not null and ca.venue_id <> s.venue_id)
          or (d.id is not null and ca.venue_id <> d.venue_id))
      order by ca.id
    `,
    orphanAttendanceEmployeeCodeWarning: `
      select ar.id as attendance_record_id, ar.upload_id, ar.employee_code, ar.employee_name, ar.date::text
      from attendance_records ar
      left join employees e on e.employee_code = ar.employee_code
      where e.id is null
      order by ar.date desc, ar.id
    `,
    attendanceEmployeeNameMismatchWarning: `
      select ar.id as attendance_record_id, ar.upload_id, ar.employee_code, ar.employee_name as attendance_employee_name, e.name as employee_name, ar.date::text
      from attendance_records ar
      join employees e on e.employee_code = ar.employee_code
      where trim(ar.employee_name) <> trim(e.name)
      order by ar.date desc, ar.id
    `,
    duplicateEmployeeCodeCaseWarning: `
      select lower(trim(employee_code)) as normalized_employee_code, array_agg(id order by id) as employee_ids, array_agg(employee_code order by id) as raw_employee_codes
      from employees
      group by normalized_employee_code
      having count(*) > 1
      order by normalized_employee_code
    `,
    duplicateLineIdWarning: `
      select line_id, array_agg(id order by id) as employee_ids, array_agg(name order by id) as employee_names
      from employees
      where line_id is not null and trim(line_id) <> ''
      group by line_id
      having count(*) > 1
      order by line_id
    `,
  };
}

async function collectDetails(audit: Record<string, number>): Promise<Record<string, unknown[]>> {
  const queries = buildDetailQueries();
  const details: Record<string, unknown[]> = {};
  for (const [key, count] of Object.entries(audit)) {
    if (count === 0 || !queries[key]) continue;
    details[key] = await sampleRows(queries[key]);
  }
  return details;
}

async function runWarningAudit() {
  const orphanAttendanceEmployeeCodeWarning = await countRows(`
    select count(*)::text
    from attendance_records ar
    left join employees e on e.employee_code = ar.employee_code
    where e.id is null
  `);

  const attendanceEmployeeNameMismatchWarning = await countRows(`
    select count(*)::text
    from attendance_records ar
    join employees e on e.employee_code = ar.employee_code
    where trim(ar.employee_name) <> trim(e.name)
  `);

  const duplicateEmployeeCodeCaseWarning = await countRows(`
    select count(*)::text
    from (
      select lower(trim(employee_code))
      from employees
      group by lower(trim(employee_code))
      having count(*) > 1
    ) duplicates
  `);

  const duplicateLineIdWarning = await countRows(`
    select count(*)::text
    from (
      select line_id
      from employees
      where line_id is not null and trim(line_id) <> ''
      group by line_id
      having count(*) > 1
    ) duplicates
  `);

  return {
    orphanAttendanceEmployeeCodeWarning,
    attendanceEmployeeNameMismatchWarning,
    duplicateEmployeeCodeCaseWarning,
    duplicateLineIdWarning,
  };
}

async function collectWarningDetails(warnings: Record<string, number>): Promise<Record<string, unknown[]>> {
  const queries = buildDetailQueries();
  const details: Record<string, unknown[]> = {};
  for (const [key, count] of Object.entries(warnings)) {
    if (count === 0 || !queries[key]) continue;
    details[key] = await sampleRows(queries[key]);
  }
  return details;
}

async function runDatabaseAudit() {
  const dirtyRoleCount = await countRows(`
    select sum(count)::text as count
    from (
      select count(*) from shifts where role is not null and role <> ${SQL_NORMALIZED_ROLE}
      union all
      select count(*) from schedule_slots where role is not null and role <> ${SQL_NORMALIZED_ROLE}
      union all
      select count(*) from dispatch_shifts where role is not null and role <> ${SQL_NORMALIZED_ROLE}
      union all
      select count(*) from venue_shift_templates where role is not null and role <> ${SQL_NORMALIZED_ROLE}
      union all
      select count(*) from salary_rate_configs where role is not null and role <> ${SQL_NORMALIZED_ROLE}
    ) counts
  `);

  const duplicateSlotCount = await countRows(`
    select count(*)::text
    from (
      select venue_id, date, left(start_time, 5), left(end_time, 5), role
      from schedule_slots
      group by venue_id, date, left(start_time, 5), left(end_time, 5), role
      having count(*) > 1
    ) duplicates
  `);

  const normalizedDuplicateSlotCount = await countRows(`
    select count(*)::text
    from (
      select
        venue_id,
        date,
        left(start_time, 5) as start_time,
        left(end_time, 5) as end_time,
        ${SQL_NORMALIZED_ROLE} as normalized_role
      from schedule_slots
      group by venue_id, date, left(start_time, 5), left(end_time, 5), normalized_role
      having count(*) > 1
    ) duplicates
  `);

  const normalizedDuplicateTemplateCount = await countRows(`
    select count(*)::text
    from (
      select
        venue_id,
        day_type,
        left(start_time, 5) as start_time,
        left(end_time, 5) as end_time,
        ${SQL_NORMALIZED_ROLE} as normalized_role
      from venue_shift_templates
      group by venue_id, day_type, left(start_time, 5), left(end_time, 5), normalized_role
      having count(*) > 1
    ) duplicates
  `);

  const normalizedDuplicateSalaryRateCount = await countRows(`
    select count(*)::text
    from (
      select ${SQL_NORMALIZED_ROLE} as normalized_role
      from salary_rate_configs
      group by normalized_role
      having count(*) > 1
    ) duplicates
  `);

  const duplicateVenueRequirementCount = await countRows(`
    select count(*)::text
    from (
      select venue_id, day_of_week, left(start_time::text, 5), left(end_time::text, 5)
      from venue_requirements
      group by venue_id, day_of_week, left(start_time::text, 5), left(end_time::text, 5)
      having count(*) > 1
    ) duplicates
  `);

  const invalidVenueRequirementDayCount = await countRows(`
    select count(*)::text
    from venue_requirements
    where day_of_week < 0 or day_of_week > 6
  `);

  const futureCrossRegionCount = await countRows(`
    select count(*)::text
    from shifts s
    join venues v on v.id = s.venue_id
    join employees e on e.id = s.employee_id
    where s.status = 'active'
      and s.date >= current_date
      and v.region_id is distinct from e.region_id
  `);

  const futureInactiveShiftEmployeeCount = await countRows(`
    select count(*)::text
    from shifts s
    join employees e on e.id = s.employee_id
    where s.status = 'active'
      and s.date >= current_date
      and e.status <> 'active'
  `);

  const roleMismatchFillCount = await countRows(`
    select count(*)::text
    from (
      select s.id
      from shifts s
      where s.status = 'active'
        and s.date >= current_date
        and exists (
          select 1
          from schedule_slots sl
          where sl.venue_id = s.venue_id
            and sl.date = s.date
            and ${slotOverlapConditionSql("s", "sl")}
        )
        and not exists (
          select 1
          from schedule_slots sl
          where sl.venue_id = s.venue_id
            and sl.date = s.date
            and ${slotOverlapConditionSql("s", "sl")}
            and ${normalizedRoleSql("s.role")} = ${normalizedRoleSql("sl.role")}
        )
    ) mismatches
  `);

  const roleVariantGroupCount = await countRows(`
    select count(*)::text
    from (
      select
        venue_id,
        date,
        left(start_time::text, 5) as start_time,
        left(end_time::text, 5) as end_time,
        ${SQL_NORMALIZED_ROLE} as normalized_role
      from shifts
      where status = 'active'
        and date >= current_date
      group by venue_id, date, left(start_time::text, 5), left(end_time::text, 5), normalized_role
      having count(distinct role) > 1
    ) role_variants
  `);

  const duplicateActiveShiftCount = await countRows(`
    select count(*)::text
    from (
      select
        employee_id,
        venue_id,
        date,
        left(start_time::text, 5) as start_time,
        left(end_time::text, 5) as end_time,
        ${SQL_NORMALIZED_ROLE} as normalized_role
      from shifts
      where status = 'active'
        and date >= current_date
      group by employee_id, venue_id, date, left(start_time::text, 5), left(end_time::text, 5), normalized_role
      having count(*) > 1
    ) duplicates
  `);

  const duplicateActiveDispatchShiftCount = await countRows(`
    select count(*)::text
    from (
      select
        coalesce('employee:' || linked_employee_id::text, 'name:' || trim(dispatch_name)) as dispatch_identity,
        venue_id,
        date,
        left(start_time::text, 5) as start_time,
        left(end_time::text, 5) as end_time,
        ${SQL_NORMALIZED_ROLE} as normalized_role
      from dispatch_shifts
      where status <> 'cancelled'
        and date >= current_date
      group by dispatch_identity, venue_id, date, left(start_time::text, 5), left(end_time::text, 5), normalized_role
      having count(*) > 1
    ) duplicates
  `);

  const dispatchRoleMismatchFillCount = await countRows(`
    select count(*)::text
    from (
      select d.id
      from dispatch_shifts d
      where d.status <> 'cancelled'
        and d.venue_id is not null
        and d.date >= current_date
        and exists (
          select 1
          from schedule_slots sl
          where sl.venue_id = d.venue_id
            and sl.date = d.date
            and ${slotOverlapConditionSql("d", "sl")}
        )
        and not exists (
          select 1
          from schedule_slots sl
          where sl.venue_id = d.venue_id
            and sl.date = d.date
            and ${slotOverlapConditionSql("d", "sl")}
            and ${normalizedRoleSql("d.role")} = ${normalizedRoleSql("sl.role")}
        )
    ) mismatches
  `);

  const dispatchLinkedEmployeeNameMismatchCount = await countRows(`
    select count(*)::text
    from dispatch_shifts d
    join employees e on e.id = d.linked_employee_id
    where d.status <> 'cancelled'
      and d.dispatch_name is not null
      and trim(d.dispatch_name) <> trim(e.name)
  `);

  const unlinkedDispatchExactEmployeeNameCount = await countRows(`
    select count(*)::text
    from (
      with unique_active_names as (
        select trim(name) as name, min(id) as employee_id
        from employees
        where status = 'active'
        group by trim(name)
        having count(*) = 1
      )
      select d.id
      from dispatch_shifts d
      join unique_active_names u on u.name = trim(d.dispatch_name)
      where d.status <> 'cancelled'
        and d.linked_employee_id is null
        and d.dispatch_name is not null
    ) unlinked
  `);

  const invalidScheduleRequirementCount = await countRows(`
    select sum(count)::text as count
    from (
      select count(*) from schedule_slots where required_count <= 0
      union all
      select count(*) from venue_shift_templates where required_count <= 0
      union all
      select count(*) from venue_requirements where required_count <= 0
    ) counts
  `);

  const invalidScheduleTimeRangeCount = await countRows(`
    select sum(count)::text as count
    from (
      select count(*) from shifts where left(start_time::text, 5) = left(end_time::text, 5) and role not in ${SQL_NON_WORK_ROLES}
      union all
      select count(*) from dispatch_shifts where left(start_time::text, 5) = left(end_time::text, 5)
      union all
      select count(*) from schedule_slots where left(start_time::text, 5) = left(end_time::text, 5)
      union all
      select count(*) from venue_shift_templates where left(start_time::text, 5) = left(end_time::text, 5)
      union all
      select count(*) from venue_requirements where left(start_time::text, 5) = left(end_time::text, 5)
    ) counts
  `);

  const orphanShiftEmployeeCount = await countRows(`
    select count(*)::text
    from shifts s
    left join employees e on e.id = s.employee_id
    where e.id is null
  `);

  const orphanShiftVenueCount = await countRows(`
    select count(*)::text
    from shifts s
    left join venues v on v.id = s.venue_id
    where v.id is null
  `);

  const orphanSlotVenueCount = await countRows(`
    select count(*)::text
    from schedule_slots sl
    left join venues v on v.id = sl.venue_id
    where v.id is null
  `);

  const orphanTemplateVenueCount = await countRows(`
    select count(*)::text
    from venue_shift_templates t
    left join venues v on v.id = t.venue_id
    where v.id is null
  `);

  const orphanVenueRequirementVenueCount = await countRows(`
    select count(*)::text
    from venue_requirements vr
    left join venues v on v.id = vr.venue_id
    where v.id is null
  `);

  const orphanDispatchVenueCount = await countRows(`
    select count(*)::text
    from dispatch_shifts d
    left join venues v on v.id = d.venue_id
    where d.venue_id is not null
      and v.id is null
  `);

  const orphanDispatchLinkedEmployeeCount = await countRows(`
    select count(*)::text
    from dispatch_shifts d
    left join employees e on e.id = d.linked_employee_id
    where d.linked_employee_id is not null
      and e.id is null
  `);

  const futureInactiveDispatchLinkedEmployeeCount = await countRows(`
    select count(*)::text
    from dispatch_shifts d
    join employees e on e.id = d.linked_employee_id
    where d.linked_employee_id is not null
      and d.status <> 'cancelled'
      and d.date >= current_date
      and e.status <> 'active'
  `);

  const futureDispatchLinkedEmployeeVenueRegionMismatchCount = await countRows(`
    select count(*)::text
    from dispatch_shifts d
    join employees e on e.id = d.linked_employee_id
    join venues v on v.id = d.venue_id
    where d.linked_employee_id is not null
      and d.status <> 'cancelled'
      and d.date >= current_date
      and e.region_id is distinct from v.region_id
  `);

  const orphanClockEmployeeCount = await countRows(`
    select count(*)::text
    from clock_records cr
    left join employees e on e.id = cr.employee_id
    where e.id is null
  `);

  const orphanClockVenueCount = await countRows(`
    select count(*)::text
    from clock_records cr
    left join venues v on v.id = cr.venue_id
    where cr.venue_id is not null
      and v.id is null
  `);

  const orphanClockShiftCount = await countRows(`
    select count(*)::text
    from clock_records cr
    left join shifts s on s.id = cr.shift_id
    where cr.shift_id is not null
      and s.id is null
  `);

  const clockShiftEmployeeMismatchCount = await countRows(`
    select count(*)::text
    from clock_records cr
    join shifts s on s.id = cr.shift_id
    where cr.employee_id <> s.employee_id
  `);

  const clockShiftVenueMismatchCount = await countRows(`
    select count(*)::text
    from clock_records cr
    join shifts s on s.id = cr.shift_id
    where cr.venue_id is not null
      and cr.venue_id <> s.venue_id
  `);

  const orphanVenueRegionCount = await countRows(`
    select count(*)::text
    from venues v
    left join regions r on r.id = v.region_id
    where r.id is null
  `);

  const orphanEmployeeRegionCount = await countRows(`
    select count(*)::text
    from employees e
    left join regions r on r.id = e.region_id
    where r.id is null
  `);

  const orphanDispatchRegionCount = await countRows(`
    select count(*)::text
    from dispatch_shifts d
    left join regions r on r.id = d.region_id
    where r.id is null
  `);

  const dispatchVenueRegionMismatchCount = await countRows(`
    select count(*)::text
    from dispatch_shifts d
    join venues v on v.id = d.venue_id
    where d.region_id <> v.region_id
  `);

  const orphanGuidelineVenueCount = await countRows(`
    select count(*)::text
    from guidelines g
    left join venues v on v.id = g.venue_id
    where g.venue_id is not null
      and v.id is null
  `);

  const orphanGuidelineAckGuidelineCount = await countRows(`
    select count(*)::text
    from guideline_acknowledgments ga
    left join guidelines g on g.id = ga.guideline_id
    where g.id is null
  `);

  const orphanGuidelineAckEmployeeCount = await countRows(`
    select count(*)::text
    from guideline_acknowledgments ga
    left join employees e on e.id = ga.employee_id
    where e.id is null
  `);

  const orphanClockAmendmentEmployeeCount = await countRows(`
    select count(*)::text
    from clock_amendments ca
    left join employees e on e.id = ca.employee_id
    where e.id is null
  `);

  const orphanClockAmendmentVenueCount = await countRows(`
    select count(*)::text
    from clock_amendments ca
    left join venues v on v.id = ca.venue_id
    where ca.venue_id is not null
      and v.id is null
  `);

  const orphanClockAmendmentShiftCount = await countRows(`
    select count(*)::text
    from clock_amendments ca
    left join shifts s on ca.shift_id > 0 and s.id = ca.shift_id
    left join dispatch_shifts d on ca.shift_id < 0 and d.id = abs(ca.shift_id)
    where (ca.shift_id > 0 and s.id is null)
       or (ca.shift_id < 0 and d.id is null)
  `);

  const orphanClockAmendmentClockRecordCount = await countRows(`
    select count(*)::text
    from clock_amendments ca
    left join clock_records cr on cr.id = ca.original_clock_record_id
    where ca.original_clock_record_id is not null
      and cr.id is null
  `);

  const orphanClockAmendmentReviewerCount = await countRows(`
    select count(*)::text
    from clock_amendments ca
    left join employees e on e.id = ca.reviewed_by
    where ca.reviewed_by is not null
      and e.id is null
  `);

  const clockAmendmentShiftEmployeeMismatchCount = await countRows(`
    select count(*)::text
    from clock_amendments ca
    left join shifts s on ca.shift_id > 0 and s.id = ca.shift_id
    left join dispatch_shifts d on ca.shift_id < 0 and d.id = abs(ca.shift_id)
    where (s.id is not null and ca.employee_id <> s.employee_id)
       or (d.id is not null and ca.employee_id <> d.linked_employee_id)
  `);

  const clockAmendmentShiftVenueMismatchCount = await countRows(`
    select count(*)::text
    from clock_amendments ca
    left join shifts s on ca.shift_id > 0 and s.id = ca.shift_id
    left join dispatch_shifts d on ca.shift_id < 0 and d.id = abs(ca.shift_id)
    where ca.venue_id is not null
      and ((s.id is not null and ca.venue_id <> s.venue_id)
        or (d.id is not null and ca.venue_id <> d.venue_id))
  `);

  const orphanOvertimeEmployeeCount = await countRows(`
    select count(*)::text
    from overtime_requests ot
    left join employees e on e.id = ot.employee_id
    where e.id is null
  `);

  const orphanOvertimeClockRecordCount = await countRows(`
    select count(*)::text
    from overtime_requests ot
    left join clock_records cr on cr.id = ot.clock_record_id
    where ot.clock_record_id is not null
      and cr.id is null
  `);

  const orphanOvertimeReviewerCount = await countRows(`
    select count(*)::text
    from overtime_requests ot
    left join employees e on e.id = ot.reviewed_by
    where ot.reviewed_by is not null
      and e.id is null
  `);

  const overtimeClockEmployeeMismatchCount = await countRows(`
    select count(*)::text
    from overtime_requests ot
    join clock_records cr on cr.id = ot.clock_record_id
    where ot.employee_id <> cr.employee_id
  `);

  const orphanLeaveEmployeeCount = await countRows(`
    select count(*)::text
    from leave_requests lr
    left join employees e on e.id = lr.employee_id
    where e.id is null
  `);

  const orphanLeaveReviewerCount = await countRows(`
    select count(*)::text
    from leave_requests lr
    left join employees e on e.id = lr.reviewed_by
    where lr.reviewed_by is not null
      and e.id is null
  `);

  const orphanOutingEmployeeCount = await countRows(`
    select count(*)::text
    from outing_records o
    left join employees e on e.id = o.employee_id
    where e.id is null
  `);

  const orphanAvailabilityEmployeeCount = await countRows(`
    select count(*)::text
    from shift_availabilities a
    left join employees e on e.id = a.employee_id
    where e.id is null
  `);

  const orphanAttendanceUploadCount = await countRows(`
    select count(*)::text
    from attendance_records ar
    left join attendance_uploads au on au.id = ar.upload_id
    where au.id is null
  `);

  const orphanShiftAuditShiftCount = await countRows(`
    select count(*)::text
    from shift_audit_log sal
    left join shifts s on s.id = sal.shift_id
    where s.id is null
  `);

  const orphanDispatchAuditShiftCount = await countRows(`
    select count(*)::text
    from dispatch_shift_audit_log dal
    left join dispatch_shifts d on d.id = dal.dispatch_shift_id
    where d.id is null
  `);

  const orphanMissingClockNotificationEmployeeCount = await countRows(`
    select count(*)::text
    from missing_clock_notifications m
    left join employees e on e.id = m.employee_id
    where e.id is null
  `);

  const orphanMissingClockNotificationShiftCount = await countRows(`
    select count(*)::text
    from missing_clock_notifications m
    left join shifts s on m.shift_id > 0 and s.id = m.shift_id
    left join dispatch_shifts d on m.shift_id < 0 and d.id = abs(m.shift_id)
    where (m.shift_id > 0 and s.id is null)
       or (m.shift_id < 0 and d.id is null)
  `);

  const missingClockNotificationShiftEmployeeMismatchCount = await countRows(`
    select count(*)::text
    from missing_clock_notifications m
    left join shifts s on m.shift_id > 0 and s.id = m.shift_id
    left join dispatch_shifts d on m.shift_id < 0 and d.id = abs(m.shift_id)
    where (s.id is not null and m.employee_id <> s.employee_id)
       or (d.id is not null and m.employee_id <> d.linked_employee_id)
  `);

  const orphanWeeklyPushEmployeeCount = await countRows(`
    select count(*)::text
    from weekly_push_notifications w
    left join employees e on e.id = w.employee_id
    where e.id is null
  `);

  const orphanAnnouncementCreatorCount = await countRows(`
    select count(*)::text
    from announcements a
    left join employees e on e.id = a.created_by
    where a.created_by is not null
      and e.id is null
  `);

  return {
    dirtyRoleCount,
    duplicateSlotCount,
    normalizedDuplicateSlotCount,
    normalizedDuplicateTemplateCount,
    normalizedDuplicateSalaryRateCount,
    duplicateVenueRequirementCount,
    invalidVenueRequirementDayCount,
    futureCrossRegionCount,
    futureInactiveShiftEmployeeCount,
    roleMismatchFillCount,
    roleVariantGroupCount,
    duplicateActiveShiftCount,
    duplicateActiveDispatchShiftCount,
    dispatchRoleMismatchFillCount,
    dispatchLinkedEmployeeNameMismatchCount,
    unlinkedDispatchExactEmployeeNameCount,
    invalidScheduleRequirementCount,
    invalidScheduleTimeRangeCount,
    orphanShiftEmployeeCount,
    orphanShiftVenueCount,
    orphanSlotVenueCount,
    orphanTemplateVenueCount,
    orphanVenueRequirementVenueCount,
    orphanDispatchVenueCount,
    orphanDispatchLinkedEmployeeCount,
    futureInactiveDispatchLinkedEmployeeCount,
    futureDispatchLinkedEmployeeVenueRegionMismatchCount,
    orphanClockEmployeeCount,
    orphanClockVenueCount,
    orphanClockShiftCount,
    clockShiftEmployeeMismatchCount,
    clockShiftVenueMismatchCount,
    orphanVenueRegionCount,
    orphanEmployeeRegionCount,
    orphanDispatchRegionCount,
    dispatchVenueRegionMismatchCount,
    orphanGuidelineVenueCount,
    orphanGuidelineAckGuidelineCount,
    orphanGuidelineAckEmployeeCount,
    orphanClockAmendmentEmployeeCount,
    orphanClockAmendmentVenueCount,
    orphanClockAmendmentShiftCount,
    orphanClockAmendmentClockRecordCount,
    orphanClockAmendmentReviewerCount,
    clockAmendmentShiftEmployeeMismatchCount,
    clockAmendmentShiftVenueMismatchCount,
    orphanOvertimeEmployeeCount,
    orphanOvertimeClockRecordCount,
    orphanOvertimeReviewerCount,
    overtimeClockEmployeeMismatchCount,
    orphanLeaveEmployeeCount,
    orphanLeaveReviewerCount,
    orphanOutingEmployeeCount,
    orphanAvailabilityEmployeeCount,
    orphanAttendanceUploadCount,
    orphanShiftAuditShiftCount,
    orphanDispatchAuditShiftCount,
    orphanMissingClockNotificationEmployeeCount,
    orphanMissingClockNotificationShiftCount,
    missingClockNotificationShiftEmployeeMismatchCount,
    orphanWeeklyPushEmployeeCount,
    orphanAnnouncementCreatorCount,
  };
}

async function main() {
  runSyntheticRegression();
  const audit = await runDatabaseAudit();
  const warnings = await runWarningAudit();
  const failures = Object.entries(audit).filter(([, count]) => count !== 0);
  const details = includeDetails ? await collectDetails(audit) : undefined;
  const warningDetails = includeDetails ? await collectWarningDetails(warnings) : undefined;
  console.log(JSON.stringify({
    synthetic: "ok",
    database: audit,
    warnings,
    ...(includeDetails ? { detailLimit, details, warningDetails } : {}),
  }, null, 2));
  if (failures.length > 0) {
    throw new Error(`Schedule mapping audit failed: ${failures.map(([key, count]) => `${key}=${count}`).join(", ")}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
