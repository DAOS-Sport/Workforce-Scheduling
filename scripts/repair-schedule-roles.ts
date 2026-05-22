import assert from "node:assert/strict";
import { pool } from "../server/infra/db";
import { normalizeScheduleRole } from "../shared/scheduleMapping";

type RoleTable = {
  name: string;
  label: string;
};

type TemplateRow = {
  id: number;
  venue_id: number;
  day_type: string;
  shift_label: string;
  start_time: string;
  end_time: string;
  role: string;
  required_count: number;
};
type ScheduleSlotRow = {
  id: number;
  venue_id: number;
  date: string;
  start_time: string;
  end_time: string;
  role: string;
  required_count: number;
};
type VenueRequirementRow = {
  id: number;
  venue_id: number;
  day_of_week: number;
  start_time: string;
  end_time: string;
  required_count: number;
};
type ShiftRow = {
  id: number;
  employee_id: number;
  venue_id: number;
  date: string;
  start_time: string;
  end_time: string;
  role: string;
};
type DispatchShiftRow = {
  id: number;
  linked_employee_id: number | null;
  dispatch_name: string;
  venue_id: number | null;
  date: string;
  start_time: string;
  end_time: string;
  role: string;
};
type SalaryRateRow = {
  id: number;
  role: string;
  rate_per_hour: number;
  label: string | null;
  updated_at: Date | null;
};
type OrphanClockRecord = {
  id: number;
  employee_id: number;
  venue_id: number | null;
  shift_id: number | null;
  clock_type: string;
  status: string;
  clock_time: Date | null;
};
type OrphanGuidelineAck = {
  id: number;
  guideline_id: number;
  employee_id: number;
  acknowledged_at: Date | null;
  title: string | null;
};
type OrphanClockAmendmentReviewer = {
  id: number;
  employee_id: number;
  shift_id: number | null;
  venue_id: number | null;
  reviewed_by: number;
  reviewed_by_name: string | null;
  reviewed_at: Date | null;
  status: string;
};
type DispatchVenueRegionMismatch = {
  id: number;
  date: string;
  dispatch_name: string;
  venue_id: number;
  dispatch_region_id: number;
  venue_region_id: number;
};
type UnlinkedDispatchExactEmployee = {
  id: number;
  dispatch_name: string;
  employee_id: number;
  employee_name: string;
  date: string;
};
type IdRow = { id: number };
type ClockVenueMismatch = { id: number; shift_venue_id: number };
type ClockAmendmentVenueMismatch = { id: number; assignment_venue_id: number };

const ROLE_TABLES: RoleTable[] = [
  { name: "shifts", label: "一般班次" },
  { name: "schedule_slots", label: "需求 slot" },
  { name: "dispatch_shifts", label: "派遣班次" },
  { name: "venue_shift_templates", label: "場館班別範本" },
  { name: "salary_rate_configs", label: "薪資角色費率" },
];

const apply = process.argv.includes("--apply");

async function loadRows(table: string): Promise<Array<{ id: number; role: string }>> {
  const result = await pool.query<{ id: number; role: string }>(
    `select id, role from ${table} where role is not null order by id`,
  );
  return result.rows;
}

async function loadTemplateRows(): Promise<TemplateRow[]> {
  const result = await pool.query<TemplateRow>(`
    select id, venue_id, day_type, shift_label, start_time, end_time, role, required_count
    from venue_shift_templates
    order by id
  `);
  return result.rows;
}

async function loadScheduleSlotRows(): Promise<ScheduleSlotRow[]> {
  const result = await pool.query<ScheduleSlotRow>(`
    select id, venue_id, date::text, start_time, end_time, role, required_count
    from schedule_slots
    order by id
  `);
  return result.rows;
}

async function loadVenueRequirementRows(): Promise<VenueRequirementRow[]> {
  const result = await pool.query<VenueRequirementRow>(`
    select id, venue_id, day_of_week, start_time::text, end_time::text, required_count
    from venue_requirements
    order by id
  `);
  return result.rows;
}

async function loadFutureActiveShiftRows(): Promise<ShiftRow[]> {
  const result = await pool.query<ShiftRow>(`
    select id, employee_id, venue_id, date::text, start_time::text, end_time::text, role
    from shifts
    where status = 'active'
      and date >= current_date
    order by id
  `);
  return result.rows;
}

async function loadFutureActiveDispatchShiftRows(): Promise<DispatchShiftRow[]> {
  const result = await pool.query<DispatchShiftRow>(`
    select id, linked_employee_id, dispatch_name, venue_id, date::text, start_time::text, end_time::text, role
    from dispatch_shifts
    where status <> 'cancelled'
      and date >= current_date
    order by id
  `);
  return result.rows;
}

async function loadSalaryRateRows(): Promise<SalaryRateRow[]> {
  const result = await pool.query<SalaryRateRow>(`
    select id, role, rate_per_hour, label, updated_at
    from salary_rate_configs
    order by id
  `);
  return result.rows;
}

async function loadOrphanClockRecords(): Promise<OrphanClockRecord[]> {
  const result = await pool.query<OrphanClockRecord>(`
    select cr.id, cr.employee_id, cr.venue_id, cr.shift_id, cr.clock_type, cr.status, cr.clock_time
    from clock_records cr
    left join employees e on e.id = cr.employee_id
    where e.id is null
    order by cr.id
  `);
  return result.rows;
}

async function loadOrphanGuidelineAcks(): Promise<OrphanGuidelineAck[]> {
  const result = await pool.query<OrphanGuidelineAck>(`
    select ga.id, ga.guideline_id, ga.employee_id, ga.acknowledged_at, g.title
    from guideline_acknowledgments ga
    left join guidelines g on g.id = ga.guideline_id
    left join employees e on e.id = ga.employee_id
    where e.id is null
    order by ga.id
  `);
  return result.rows;
}

async function loadOrphanClockAmendmentReviewers(): Promise<OrphanClockAmendmentReviewer[]> {
  const result = await pool.query<OrphanClockAmendmentReviewer>(`
    select ca.id, ca.employee_id, ca.shift_id, ca.venue_id, ca.reviewed_by, ca.reviewed_by_name, ca.reviewed_at, ca.status
    from clock_amendments ca
    left join employees e on e.id = ca.reviewed_by
    where ca.reviewed_by is not null
      and e.id is null
    order by ca.id
  `);
  return result.rows;
}

async function loadDispatchVenueRegionMismatches(): Promise<DispatchVenueRegionMismatch[]> {
  const result = await pool.query<DispatchVenueRegionMismatch>(`
    select
      d.id,
      d.date::text,
      d.dispatch_name,
      d.venue_id,
      d.region_id as dispatch_region_id,
      v.region_id as venue_region_id
    from dispatch_shifts d
    join venues v on v.id = d.venue_id
    where d.region_id <> v.region_id
    order by d.id
  `);
  return result.rows;
}

async function loadIdRows(sql: string): Promise<IdRow[]> {
  const result = await pool.query<IdRow>(sql);
  return result.rows;
}

async function loadClockVenueMismatches(): Promise<ClockVenueMismatch[]> {
  const result = await pool.query<ClockVenueMismatch>(`
    select cr.id, s.venue_id as shift_venue_id
    from clock_records cr
    join shifts s on s.id = cr.shift_id
    where cr.venue_id is not null
      and cr.venue_id <> s.venue_id
    order by cr.id
  `);
  return result.rows;
}

async function loadClockAmendmentVenueMismatches(): Promise<ClockAmendmentVenueMismatch[]> {
  const result = await pool.query<ClockAmendmentVenueMismatch>(`
    select ca.id, coalesce(s.venue_id, d.venue_id) as assignment_venue_id
    from clock_amendments ca
    left join shifts s on ca.shift_id > 0 and s.id = ca.shift_id
    left join dispatch_shifts d on ca.shift_id < 0 and d.id = abs(ca.shift_id)
    where ca.venue_id is not null
      and ((s.id is not null and ca.venue_id <> s.venue_id)
        or (d.id is not null and ca.venue_id <> d.venue_id))
    order by ca.id
  `);
  return result.rows;
}

function templateKey(row: TemplateRow): string {
  return [
    row.venue_id,
    row.day_type.toLowerCase(),
    row.start_time.slice(0, 5),
    row.end_time.slice(0, 5),
    normalizeScheduleRole(row.role) || row.role,
  ].join("|");
}

function scheduleSlotKey(row: ScheduleSlotRow): string {
  return [
    row.venue_id,
    row.date,
    row.start_time.slice(0, 5),
    row.end_time.slice(0, 5),
    normalizeScheduleRole(row.role) || row.role,
  ].join("|");
}

function venueRequirementKey(row: VenueRequirementRow): string {
  return [
    row.venue_id,
    row.day_of_week,
    row.start_time.slice(0, 5),
    row.end_time.slice(0, 5),
  ].join("|");
}

function shiftKey(row: ShiftRow): string {
  return [
    row.employee_id,
    row.venue_id,
    row.date,
    row.start_time.slice(0, 5),
    row.end_time.slice(0, 5),
    normalizeScheduleRole(row.role) || row.role,
  ].join("|");
}

function dispatchShiftKey(row: DispatchShiftRow): string {
  return [
    row.linked_employee_id == null ? `name:${row.dispatch_name.trim()}` : `employee:${row.linked_employee_id}`,
    row.venue_id ?? "null",
    row.date,
    row.start_time.slice(0, 5),
    row.end_time.slice(0, 5),
    normalizeScheduleRole(row.role) || row.role,
  ].join("|");
}

function salaryRateKey(row: SalaryRateRow): string {
  return normalizeScheduleRole(row.role) || row.role;
}

function findDuplicateTemplates(rows: TemplateRow[]) {
  const groups = new Map<string, TemplateRow[]>();
  for (const row of rows) {
    const key = templateKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return Array.from(groups.entries())
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => {
      const sorted = [...group].sort((a, b) =>
        b.required_count - a.required_count || a.id - b.id
      );
      const keep = sorted[0];
      const remove = sorted.slice(1);
      return { key, keep, remove };
    });
}

function findDuplicateScheduleSlots(rows: ScheduleSlotRow[]) {
  const groups = new Map<string, ScheduleSlotRow[]>();
  for (const row of rows) {
    const key = scheduleSlotKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return Array.from(groups.entries())
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => {
      const sorted = [...group].sort((a, b) => a.id - b.id);
      const keep = sorted[0];
      const remove = sorted.slice(1);
      const requiredCount = group.reduce((sum, row) => sum + row.required_count, 0);
      const normalizedRole = normalizeScheduleRole(keep.role) || keep.role;
      return { key, keep, remove, requiredCount, normalizedRole };
    });
}

function findDuplicateVenueRequirements(rows: VenueRequirementRow[]) {
  const groups = new Map<string, VenueRequirementRow[]>();
  for (const row of rows) {
    const key = venueRequirementKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return Array.from(groups.entries())
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => {
      const sorted = [...group].sort((a, b) => a.id - b.id);
      const keep = sorted[0];
      const remove = sorted.slice(1);
      const requiredCount = group.reduce((sum, row) => sum + row.required_count, 0);
      return { key, keep, remove, requiredCount };
    });
}

function findDuplicateActiveShifts(rows: ShiftRow[]) {
  const groups = new Map<string, ShiftRow[]>();
  for (const row of rows) {
    const key = shiftKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return Array.from(groups.entries())
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => {
      const sorted = [...group].sort((a, b) => a.id - b.id);
      return { key, keep: sorted[0], cancel: sorted.slice(1) };
    });
}

function findDuplicateActiveDispatchShifts(rows: DispatchShiftRow[]) {
  const groups = new Map<string, DispatchShiftRow[]>();
  for (const row of rows) {
    const key = dispatchShiftKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return Array.from(groups.entries())
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => {
      const sorted = [...group].sort((a, b) => a.id - b.id);
      return { key, keep: sorted[0], cancel: sorted.slice(1) };
    });
}

function findDuplicateSalaryRates(rows: SalaryRateRow[]) {
  const groups = new Map<string, SalaryRateRow[]>();
  for (const row of rows) {
    const key = salaryRateKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return Array.from(groups.entries())
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => {
      const sorted = [...group].sort((a, b) => {
        const bTime = b.updated_at?.getTime() ?? 0;
        const aTime = a.updated_at?.getTime() ?? 0;
        return bTime - aTime || a.id - b.id;
      });
      return { key, keep: sorted[0], remove: sorted.slice(1), normalizedRole: key };
    });
}

function runSyntheticRegression() {
  const duplicateSlots = findDuplicateScheduleSlots([
    {
      id: 10,
      venue_id: 2,
      date: "2026-05-23",
      start_time: "05:30",
      end_time: "14:00",
      role: "救生",
      required_count: 1,
    },
    {
      id: 11,
      venue_id: 2,
      date: "2026-05-23",
      start_time: "05:30:00",
      end_time: "14:00:00",
      role: " 救 生 ",
      required_count: 2,
    },
    {
      id: 12,
      venue_id: 2,
      date: "2026-05-23",
      start_time: "05:30",
      end_time: "14:00",
      role: "櫃台",
      required_count: 1,
    },
  ]);

  assert.equal(duplicateSlots.length, 1);
  assert.equal(duplicateSlots[0].key, "2|2026-05-23|05:30|14:00|救生");
  assert.equal(duplicateSlots[0].keep.id, 10);
  assert.deepEqual(duplicateSlots[0].remove.map((row) => row.id), [11]);
  assert.equal(duplicateSlots[0].requiredCount, 3);
  assert.equal(duplicateSlots[0].normalizedRole, "救生");

  const duplicateRequirements = findDuplicateVenueRequirements([
    {
      id: 15,
      venue_id: 2,
      day_of_week: 6,
      start_time: "05:30:00",
      end_time: "14:00:00",
      required_count: 1,
    },
    {
      id: 16,
      venue_id: 2,
      day_of_week: 6,
      start_time: "05:30",
      end_time: "14:00",
      required_count: 2,
    },
  ]);
  assert.equal(duplicateRequirements.length, 1);
  assert.equal(duplicateRequirements[0].key, "2|6|05:30|14:00");
  assert.equal(duplicateRequirements[0].keep.id, 15);
  assert.deepEqual(duplicateRequirements[0].remove.map((row) => row.id), [16]);
  assert.equal(duplicateRequirements[0].requiredCount, 3);

  const duplicateShifts = findDuplicateActiveShifts([
    {
      id: 20,
      employee_id: 101,
      venue_id: 2,
      date: "2026-05-24",
      start_time: "05:30:00",
      end_time: "14:00:00",
      role: "救生",
    },
    {
      id: 21,
      employee_id: 101,
      venue_id: 2,
      date: "2026-05-24",
      start_time: "05:30",
      end_time: "14:00",
      role: " 救 生 ",
    },
    {
      id: 22,
      employee_id: 102,
      venue_id: 2,
      date: "2026-05-24",
      start_time: "05:30",
      end_time: "14:00",
      role: "救生",
    },
  ]);
  assert.equal(duplicateShifts.length, 1);
  assert.equal(duplicateShifts[0].key, "101|2|2026-05-24|05:30|14:00|救生");
  assert.equal(duplicateShifts[0].keep.id, 20);
  assert.deepEqual(duplicateShifts[0].cancel.map((row) => row.id), [21]);

  const duplicateDispatchShifts = findDuplicateActiveDispatchShifts([
    {
      id: 30,
      linked_employee_id: 101,
      dispatch_name: "李羿昕",
      venue_id: 2,
      date: "2026-05-24",
      start_time: "05:30:00",
      end_time: "14:00:00",
      role: "lifeguard",
    },
    {
      id: 31,
      linked_employee_id: 101,
      dispatch_name: "李羿昕",
      venue_id: 2,
      date: "2026-05-24",
      start_time: "05:30",
      end_time: "14:00",
      role: "救 生",
    },
  ]);
  assert.equal(duplicateDispatchShifts.length, 1);
  assert.equal(duplicateDispatchShifts[0].key, "employee:101|2|2026-05-24|05:30|14:00|救生");
  assert.equal(duplicateDispatchShifts[0].keep.id, 30);
  assert.deepEqual(duplicateDispatchShifts[0].cancel.map((row) => row.id), [31]);

  const duplicateSalaryRates = findDuplicateSalaryRates([
    {
      id: 40,
      role: "櫃台",
      rate_per_hour: 150,
      label: null,
      updated_at: new Date("2026-01-01T00:00:00Z"),
    },
    {
      id: 41,
      role: "櫃檯",
      rate_per_hour: 180,
      label: null,
      updated_at: new Date("2026-02-01T00:00:00Z"),
    },
  ]);
  assert.equal(duplicateSalaryRates.length, 1);
  assert.equal(duplicateSalaryRates[0].key, "櫃檯");
  assert.equal(duplicateSalaryRates[0].keep.id, 41);
  assert.deepEqual(duplicateSalaryRates[0].remove.map((row) => row.id), [40]);
}

async function main() {
  runSyntheticRegression();
  const changes: Array<{ table: RoleTable; rows: Array<{ id: number; before: string; after: string }> }> = [];

  for (const table of ROLE_TABLES) {
    const rows = await loadRows(table.name);
    const dirty = rows
      .map((row) => ({ id: row.id, before: row.role, after: normalizeScheduleRole(row.role) || row.role }))
      .filter((row) => row.before !== row.after);
    changes.push({ table, rows: dirty });
  }
  const duplicateScheduleSlots = findDuplicateScheduleSlots(await loadScheduleSlotRows());
  const duplicateVenueRequirements = findDuplicateVenueRequirements(await loadVenueRequirementRows());
  const duplicateActiveShifts = findDuplicateActiveShifts(await loadFutureActiveShiftRows());
  const duplicateActiveDispatchShifts = findDuplicateActiveDispatchShifts(await loadFutureActiveDispatchShiftRows());
  const duplicateTemplates = findDuplicateTemplates(await loadTemplateRows());
  const duplicateSalaryRates = findDuplicateSalaryRates(await loadSalaryRateRows());
  const orphanClockRecords = await loadOrphanClockRecords();
  const orphanGuidelineAcks = await loadOrphanGuidelineAcks();
  const orphanClockAmendmentReviewers = await loadOrphanClockAmendmentReviewers();
  const dispatchVenueRegionMismatches = await loadDispatchVenueRegionMismatches();
  const unlinkedDispatchExactEmployees = (await pool.query<UnlinkedDispatchExactEmployee>(`
    with unique_active_names as (
      select trim(name) as name, min(id) as employee_id, min(name) as employee_name
      from employees
      where status = 'active'
      group by trim(name)
      having count(*) = 1
    )
    select d.id, d.dispatch_name, u.employee_id, u.employee_name, d.date::text
    from dispatch_shifts d
    join unique_active_names u on u.name = trim(d.dispatch_name)
    where d.status <> 'cancelled'
      and d.linked_employee_id is null
      and d.dispatch_name is not null
    order by d.date, d.id
  `)).rows;
  const orphanDispatchVenues = await loadIdRows(`
    select d.id
    from dispatch_shifts d
    left join venues v on v.id = d.venue_id
    where d.venue_id is not null
      and v.id is null
    order by d.id
  `);
  const orphanVenueRequirementVenues = await loadIdRows(`
    select vr.id
    from venue_requirements vr
    left join venues v on v.id = vr.venue_id
    where v.id is null
    order by vr.id
  `);
  const invalidVenueRequirementDays = await loadIdRows(`
    select vr.id
    from venue_requirements vr
    where vr.day_of_week < 0 or vr.day_of_week > 6
    order by vr.id
  `);
  const orphanDispatchLinkedEmployees = await loadIdRows(`
    select d.id
    from dispatch_shifts d
    left join employees e on e.id = d.linked_employee_id
    where d.linked_employee_id is not null
      and e.id is null
    order by d.id
  `);
  const orphanClockVenues = await loadIdRows(`
    select cr.id
    from clock_records cr
    left join venues v on v.id = cr.venue_id
    where cr.venue_id is not null
      and v.id is null
    order by cr.id
  `);
  const orphanClockShifts = await loadIdRows(`
    select cr.id
    from clock_records cr
    left join shifts s on s.id = cr.shift_id
    where cr.shift_id is not null
      and s.id is null
    order by cr.id
  `);
  const clockShiftEmployeeMismatches = await loadIdRows(`
    select cr.id
    from clock_records cr
    join shifts s on s.id = cr.shift_id
    where cr.employee_id <> s.employee_id
    order by cr.id
  `);
  const clockVenueMismatches = await loadClockVenueMismatches();
  const orphanClockAmendmentShifts = await loadIdRows(`
    select ca.id
    from clock_amendments ca
    left join shifts s on ca.shift_id > 0 and s.id = ca.shift_id
    left join dispatch_shifts d on ca.shift_id < 0 and d.id = abs(ca.shift_id)
    where (ca.shift_id > 0 and s.id is null)
       or (ca.shift_id < 0 and d.id is null)
    order by ca.id
  `);
  const clockAmendmentShiftEmployeeMismatches = await loadIdRows(`
    select ca.id
    from clock_amendments ca
    left join shifts s on ca.shift_id > 0 and s.id = ca.shift_id
    left join dispatch_shifts d on ca.shift_id < 0 and d.id = abs(ca.shift_id)
    where (s.id is not null and ca.employee_id <> s.employee_id)
       or (d.id is not null and ca.employee_id <> d.linked_employee_id)
    order by ca.id
  `);
  const clockAmendmentVenueMismatches = await loadClockAmendmentVenueMismatches();
  const orphanGuidelineVenues = await loadIdRows(`
    select g.id
    from guidelines g
    left join venues v on v.id = g.venue_id
    where g.venue_id is not null
      and v.id is null
    order by g.id
  `);
  const orphanOvertimeClockRecords = await loadIdRows(`
    select ot.id
    from overtime_requests ot
    left join clock_records cr on cr.id = ot.clock_record_id
    where ot.clock_record_id is not null
      and cr.id is null
    order by ot.id
  `);
  const orphanOvertimeReviewers = await loadIdRows(`
    select ot.id
    from overtime_requests ot
    left join employees e on e.id = ot.reviewed_by
    where ot.reviewed_by is not null
      and e.id is null
    order by ot.id
  `);
  const orphanLeaveReviewers = await loadIdRows(`
    select lr.id
    from leave_requests lr
    left join employees e on e.id = lr.reviewed_by
    where lr.reviewed_by is not null
      and e.id is null
    order by lr.id
  `);
  const orphanAnnouncementCreators = await loadIdRows(`
    select a.id
    from announcements a
    left join employees e on e.id = a.created_by
    where a.created_by is not null
      and e.id is null
    order by a.id
  `);

  const summary = changes.map(({ table, rows }) => ({
    table: table.name,
    label: table.label,
    count: rows.length,
    sample: rows.slice(0, 10),
  }));
  const duplicateTemplateSummary = duplicateTemplates.map((group) => ({
    key: group.key,
    keep: group.keep,
    remove: group.remove,
  }));
  const duplicateScheduleSlotSummary = duplicateScheduleSlots.map((group) => ({
    key: group.key,
    keep: group.keep,
    remove: group.remove,
    requiredCount: group.requiredCount,
    normalizedRole: group.normalizedRole,
  }));
  const duplicateVenueRequirementSummary = duplicateVenueRequirements.map((group) => ({
    key: group.key,
    keep: group.keep,
    remove: group.remove,
    requiredCount: group.requiredCount,
  }));
  const duplicateActiveShiftSummary = duplicateActiveShifts.map((group) => ({
    key: group.key,
    keep: group.keep,
    cancel: group.cancel,
  }));
  const duplicateActiveDispatchShiftSummary = duplicateActiveDispatchShifts.map((group) => ({
    key: group.key,
    keep: group.keep,
    cancel: group.cancel,
  }));
  const duplicateSalaryRateSummary = duplicateSalaryRates.map((group) => ({
    key: group.key,
    keep: group.keep,
    remove: group.remove,
    normalizedRole: group.normalizedRole,
  }));
  const orphanClockRecordSummary = orphanClockRecords.slice(0, 20);
  const orphanGuidelineAckSummary = orphanGuidelineAcks.slice(0, 20);
  const orphanClockAmendmentReviewerSummary = orphanClockAmendmentReviewers.slice(0, 20);
  const dispatchVenueRegionMismatchSummary = dispatchVenueRegionMismatches.slice(0, 20);
  const nullableReferenceRepairSummary = {
    orphanDispatchVenues: orphanDispatchVenues.slice(0, 20),
    unlinkedDispatchExactEmployees: unlinkedDispatchExactEmployees.slice(0, 20),
    orphanVenueRequirementVenues: orphanVenueRequirementVenues.slice(0, 20),
    invalidVenueRequirementDays: invalidVenueRequirementDays.slice(0, 20),
    orphanDispatchLinkedEmployees: orphanDispatchLinkedEmployees.slice(0, 20),
    orphanClockVenues: orphanClockVenues.slice(0, 20),
    orphanClockShifts: orphanClockShifts.slice(0, 20),
    clockShiftEmployeeMismatches: clockShiftEmployeeMismatches.slice(0, 20),
    clockVenueMismatches: clockVenueMismatches.slice(0, 20),
    orphanClockAmendmentShifts: orphanClockAmendmentShifts.slice(0, 20),
    clockAmendmentShiftEmployeeMismatches: clockAmendmentShiftEmployeeMismatches.slice(0, 20),
    clockAmendmentVenueMismatches: clockAmendmentVenueMismatches.slice(0, 20),
    orphanGuidelineVenues: orphanGuidelineVenues.slice(0, 20),
    orphanOvertimeClockRecords: orphanOvertimeClockRecords.slice(0, 20),
    orphanOvertimeReviewers: orphanOvertimeReviewers.slice(0, 20),
    orphanLeaveReviewers: orphanLeaveReviewers.slice(0, 20),
    orphanAnnouncementCreators: orphanAnnouncementCreators.slice(0, 20),
  };

  if (!apply) {
    console.log(JSON.stringify({
      mode: "dry-run",
      summary,
      duplicateActiveShiftSummary,
      duplicateActiveDispatchShiftSummary,
      duplicateScheduleSlotSummary,
      duplicateVenueRequirementSummary,
      duplicateTemplateSummary,
      duplicateSalaryRateSummary,
      dispatchVenueRegionMismatchSummary,
      nullableReferenceRepairSummary,
      orphanClockRecordSummary,
      orphanGuidelineAckSummary,
      orphanClockAmendmentReviewerSummary,
    }, null, 2));
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const group of duplicateSalaryRates) {
      await client.query(
        "update salary_rate_configs set role = $1 where id = $2",
        [group.normalizedRole, group.keep.id],
      );
      for (const row of group.remove) {
        await client.query("delete from salary_rate_configs where id = $1", [row.id]);
      }
    }
    for (const { table, rows } of changes) {
      for (const row of rows) {
        await client.query(`update ${table.name} set role = $1 where id = $2`, [row.after, row.id]);
      }
    }
    for (const group of duplicateScheduleSlots) {
      await client.query(
        "update schedule_slots set role = $1, required_count = $2 where id = $3",
        [group.normalizedRole, group.requiredCount, group.keep.id],
      );
      for (const row of group.remove) {
        await client.query("delete from schedule_slots where id = $1", [row.id]);
      }
    }
    for (const group of duplicateVenueRequirements) {
      await client.query(
        "update venue_requirements set required_count = $1 where id = $2",
        [group.requiredCount, group.keep.id],
      );
      for (const row of group.remove) {
        await client.query("delete from venue_requirements where id = $1", [row.id]);
      }
    }
    for (const group of duplicateActiveShifts) {
      for (const row of group.cancel) {
        await client.query(
          "update shifts set status = 'cancelled', cancelled_at = now(), cancelled_by = 'repair-schedule-roles', cancel_reason = 'duplicate active shift mapping repair' where id = $1",
          [row.id],
        );
      }
    }
    for (const group of duplicateActiveDispatchShifts) {
      for (const row of group.cancel) {
        await client.query(
          "update dispatch_shifts set status = 'cancelled', cancelled_at = now(), cancelled_by = 'repair-schedule-roles', cancel_reason = 'duplicate active dispatch mapping repair' where id = $1",
          [row.id],
        );
      }
    }
    for (const group of duplicateTemplates) {
      for (const row of group.remove) {
        await client.query("delete from venue_shift_templates where id = $1", [row.id]);
      }
    }
    for (const row of dispatchVenueRegionMismatches) {
      await client.query("update dispatch_shifts set region_id = $1 where id = $2", [row.venue_region_id, row.id]);
    }
    for (const row of orphanDispatchVenues) {
      await client.query("update dispatch_shifts set venue_id = null where id = $1", [row.id]);
    }
    for (const row of orphanVenueRequirementVenues) {
      await client.query("delete from venue_requirements where id = $1", [row.id]);
    }
    for (const row of invalidVenueRequirementDays) {
      await client.query("delete from venue_requirements where id = $1", [row.id]);
    }
    for (const row of orphanDispatchLinkedEmployees) {
      await client.query("update dispatch_shifts set linked_employee_id = null where id = $1", [row.id]);
    }
    for (const row of unlinkedDispatchExactEmployees) {
      await client.query("update dispatch_shifts set linked_employee_id = $1 where id = $2", [row.employee_id, row.id]);
    }
    for (const row of orphanClockVenues) {
      await client.query("update clock_records set venue_id = null where id = $1", [row.id]);
    }
    for (const row of orphanClockShifts) {
      await client.query("update clock_records set shift_id = null where id = $1", [row.id]);
    }
    for (const row of clockShiftEmployeeMismatches) {
      await client.query("update clock_records set shift_id = null where id = $1", [row.id]);
    }
    for (const row of clockVenueMismatches) {
      await client.query("update clock_records set venue_id = $1 where id = $2", [row.shift_venue_id, row.id]);
    }
    for (const row of orphanClockAmendmentShifts) {
      await client.query("update clock_amendments set shift_id = null where id = $1", [row.id]);
    }
    for (const row of clockAmendmentShiftEmployeeMismatches) {
      await client.query("update clock_amendments set shift_id = null where id = $1", [row.id]);
    }
    for (const row of clockAmendmentVenueMismatches) {
      await client.query("update clock_amendments set venue_id = $1 where id = $2", [row.assignment_venue_id, row.id]);
    }
    for (const row of orphanGuidelineVenues) {
      await client.query("update guidelines set venue_id = null where id = $1", [row.id]);
    }
    for (const row of orphanOvertimeClockRecords) {
      await client.query("update overtime_requests set clock_record_id = null where id = $1", [row.id]);
    }
    for (const row of orphanOvertimeReviewers) {
      await client.query("update overtime_requests set reviewed_by = null where id = $1", [row.id]);
    }
    for (const row of orphanLeaveReviewers) {
      await client.query("update leave_requests set reviewed_by = null where id = $1", [row.id]);
    }
    for (const row of orphanAnnouncementCreators) {
      await client.query("update announcements set created_by = null where id = $1", [row.id]);
    }
    for (const row of orphanClockRecords) {
      await client.query("delete from clock_records where id = $1", [row.id]);
    }
    for (const row of orphanGuidelineAcks) {
      await client.query("delete from guideline_acknowledgments where id = $1", [row.id]);
    }
    for (const row of orphanClockAmendmentReviewers) {
      await client.query("update clock_amendments set reviewed_by = null where id = $1", [row.id]);
    }
    await client.query("commit");
    console.log(JSON.stringify({
      mode: "apply",
      summary,
      duplicateActiveShiftSummary,
      duplicateActiveDispatchShiftSummary,
      duplicateScheduleSlotSummary,
      duplicateVenueRequirementSummary,
      duplicateTemplateSummary,
      duplicateSalaryRateSummary,
      dispatchVenueRegionMismatchSummary,
      nullableReferenceRepairSummary,
      orphanClockRecordSummary,
      orphanGuidelineAckSummary,
      orphanClockAmendmentReviewerSummary,
    }, null, 2));
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
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
