import { pool } from "../server/infra/db";
import {
  countAssignedToScheduleSlot,
  normalizeCoworkerGroupRole,
  normalizeScheduleRole,
  type ScheduleSlotLike,
  type ShiftLike,
} from "../shared/scheduleMapping";

const dates = ["2026-05-23", "2026-05-24"];
const venueKeyword = process.env.FEEDBACK_VENUE_KEYWORD || "新北";
const employeeNames = (process.env.FEEDBACK_EMPLOYEE_NAMES || "徐立珏,李羿昕,王崧宇")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
const strict = process.argv.includes("--strict");

const expectedByDate: Record<string, string[]> = process.env.FEEDBACK_EXPECTED_BY_DATE
  ? JSON.parse(process.env.FEEDBACK_EXPECTED_BY_DATE)
  : {
      "2026-05-23": ["徐立珏", "李羿昕", "王崧宇"],
      "2026-05-24": ["李羿昕", "王崧宇"],
    };
const expectedRole = normalizeCoworkerGroupRole(process.env.FEEDBACK_EXPECTED_ROLE || "救生");

type VenueRow = { id: number; name: string; short_name: string };
type ShiftRow = {
  id: number;
  source: "regular" | "dispatch";
  date: string;
  employee_id: number | null;
  employee_name: string;
  employee_code: string | null;
  venue_id: number | null;
  venue_name: string | null;
  start_time: string;
  end_time: string;
  role: string;
  status: string;
};
type SlotRow = {
  id: number;
  date: string;
  venue_id: number;
  start_time: string;
  end_time: string;
  role: string;
  required_count: number;
};

function time5(time: string): string {
  return time.slice(0, 5);
}

function groupByRole(rows: ShiftRow[], normalized: boolean) {
  const groups = new Map<string, ShiftRow[]>();
  for (const row of rows) {
    const key = normalized
      ? normalizeCoworkerGroupRole(row.role) || row.role
      : row.role;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return Array.from(groups.entries()).map(([role, members]) => ({
    role,
    count: members.length,
    members: members.map((member) => ({
      source: member.source,
      name: member.employee_name,
      employeeCode: member.employee_code,
      shiftId: member.id,
      time: `${time5(member.start_time)}-${time5(member.end_time)}`,
      rawRole: member.role,
      normalizedRole: normalizeScheduleRole(member.role) || member.role,
    })),
  }));
}

async function main() {
  const venueResult = await pool.query<VenueRow>(
    `
      select id, name, short_name
      from venues
      where name ilike $1 or short_name ilike $1
      order by id
    `,
    [`%${venueKeyword}%`],
  );
  const venues = venueResult.rows;
  const venueIds = venues.map((venue) => venue.id);

  const shiftResult = venueIds.length === 0
    ? { rows: [] as ShiftRow[] }
    : await pool.query<ShiftRow>(
      `
        select
          s.id,
          'regular' as source,
          s.date::text,
          s.employee_id,
          e.name as employee_name,
          e.employee_code,
          s.venue_id,
          v.short_name as venue_name,
          s.start_time::text,
          s.end_time::text,
          s.role,
          s.status
        from shifts s
        join employees e on e.id = s.employee_id
        join venues v on v.id = s.venue_id
        where s.date = any($1::date[])
          and s.venue_id = any($2::int[])
          and e.name = any($3::text[])
          and s.status = 'active'
        order by s.date, s.start_time, e.name
      `,
      [dates, venueIds, employeeNames],
    );

  const dispatchResult = venueIds.length === 0
    ? { rows: [] as ShiftRow[] }
    : await pool.query<ShiftRow>(
      `
        select
          d.id,
          'dispatch' as source,
          d.date::text,
          d.linked_employee_id as employee_id,
          coalesce(e.name, d.dispatch_name) as employee_name,
          e.employee_code,
          d.venue_id,
          v.short_name as venue_name,
          d.start_time::text,
          d.end_time::text,
          d.role,
          d.status
        from dispatch_shifts d
        left join employees e on e.id = d.linked_employee_id
        left join venues v on v.id = d.venue_id
        where d.date = any($1::date[])
          and d.venue_id = any($2::int[])
          and coalesce(e.name, d.dispatch_name) = any($3::text[])
          and d.status <> 'cancelled'
        order by d.date, d.start_time, coalesce(e.name, d.dispatch_name)
      `,
      [dates, venueIds, employeeNames],
    );

  const slotResult = venueIds.length === 0
    ? { rows: [] as SlotRow[] }
    : await pool.query<SlotRow>(
      `
        select id, date::text, venue_id, start_time, end_time, role, required_count
        from schedule_slots
        where date = any($1::date[])
          and venue_id = any($2::int[])
        order by date, start_time, role, id
      `,
      [dates, venueIds],
    );

  const shifts = shiftResult.rows;
  const dispatchShifts = dispatchResult.rows;
  const caseRows = [...shifts, ...dispatchShifts];
  const slots = slotResult.rows;

  const issues: string[] = [];

  const days = dates.map((date) => {
    const dayShifts = shifts.filter((shift) => shift.date === date);
    const dayDispatchShifts = dispatchShifts.filter((shift) => shift.date === date);
    const dayCaseRows = caseRows.filter((shift) => shift.date === date);
    const daySlots = slots.filter((slot) => slot.date === date);
    const expectedEmployees = expectedByDate[date] ?? employeeNames;
    const slotAssignments = daySlots.map((slot) => ({
      slotId: slot.id,
      venueId: slot.venue_id,
      time: `${time5(slot.start_time)}-${time5(slot.end_time)}`,
      role: slot.role,
      normalizedRole: normalizeScheduleRole(slot.role) || slot.role,
      requiredCount: slot.required_count,
      assignedCount: countAssignedToScheduleSlot(
        {
          venueId: slot.venue_id,
          date: slot.date,
          startTime: slot.start_time,
          endTime: slot.end_time,
          role: slot.role,
          requiredCount: slot.required_count,
        } satisfies ScheduleSlotLike,
        dayShifts.map((shift) => ({
          venueId: shift.venue_id,
          date: shift.date,
          startTime: shift.start_time,
          endTime: shift.end_time,
          role: shift.role,
        } satisfies ShiftLike)),
        dayDispatchShifts.map((shift) => ({
          venueId: shift.venue_id,
          date: shift.date,
          startTime: shift.start_time,
          endTime: shift.end_time,
          role: shift.role,
        } satisfies ShiftLike)),
      ),
    }));

    const rawRoleGroups = groupByRole(dayCaseRows, false);
    const normalizedRoleGroups = groupByRole(dayCaseRows, true);
    const missingExpectedEmployees = expectedEmployees.filter(
      (name) => !dayCaseRows.some((shift) => shift.employee_name === name),
    );
    const expectedRoleGroup = normalizedRoleGroups.find((group) => group.role === expectedRole);
    const expectedRoleMembers = expectedRoleGroup?.members.map((member) => member.name).sort((a, b) => a.localeCompare(b, "zh-Hant")) ?? [];
    const expectedSorted = [...expectedEmployees].sort((a, b) => a.localeCompare(b, "zh-Hant"));
    const expectedRoleSlotAssignments = slotAssignments.filter(
      (slot) => normalizeCoworkerGroupRole(slot.role) === expectedRole,
    );
    const duplicateNormalizedSlots = Array.from(
      daySlots.reduce((groups, slot) => {
        const key = [
          slot.venue_id,
          time5(slot.start_time),
          time5(slot.end_time),
          normalizeScheduleRole(slot.role) || slot.role,
        ].join("|");
        groups.set(key, [...(groups.get(key) ?? []), slot.id]);
        return groups;
      }, new Map<string, number[]>()),
    ).filter(([, ids]) => ids.length > 1);
    const bestExpectedRoleAssignedCount = expectedRoleSlotAssignments.reduce(
      (max, slot) => Math.max(max, slot.assignedCount),
      0,
    );

    if (strict) {
      if (missingExpectedEmployees.length > 0) {
        issues.push(`${date}: missing expected employees ${missingExpectedEmployees.join(",")}`);
      }
      if (!expectedRoleGroup) {
        issues.push(`${date}: missing normalized role group ${expectedRole}`);
      } else if (expectedRoleGroup.count !== expectedEmployees.length) {
        issues.push(`${date}: ${expectedRole} group count ${expectedRoleGroup.count}, expected ${expectedEmployees.length}`);
      }
      if (JSON.stringify(expectedRoleMembers) !== JSON.stringify(expectedSorted)) {
        issues.push(`${date}: ${expectedRole} members ${expectedRoleMembers.join(",") || "(none)"}, expected ${expectedSorted.join(",")}`);
      }
      if (duplicateNormalizedSlots.length > 0) {
        issues.push(`${date}: duplicate normalized slots ${duplicateNormalizedSlots.map(([key, ids]) => `${key}=[${ids.join(",")}]`).join(";")}`);
      }
      if (expectedRoleSlotAssignments.length === 0) {
        issues.push(`${date}: missing ${expectedRole} schedule slot`);
      } else if (bestExpectedRoleAssignedCount < expectedEmployees.length) {
        issues.push(`${date}: best ${expectedRole} slot assignedCount ${bestExpectedRoleAssignedCount}, expected at least ${expectedEmployees.length}`);
      }
    }

    return {
      date,
      shiftCount: dayCaseRows.length,
      regularShiftCount: dayShifts.length,
      dispatchShiftCount: dayDispatchShifts.length,
      expectedEmployees,
      expectedRole,
      rawRoleGroups,
      normalizedRoleGroups,
      slotAssignments,
      expectedRoleSlotAssignments,
      bestExpectedRoleAssignedCount,
      missingExpectedEmployees,
    };
  });

  const result = {
    status: caseRows.length === 0 ? "no_case_data" : issues.length > 0 ? "mismatch" : "ok",
    query: { dates, venueKeyword, employeeNames, expectedByDate, expectedRole },
    matchedVenues: venues,
    days,
    issues,
  };

  console.log(JSON.stringify(result, null, 2));

  if (strict && (caseRows.length === 0 || issues.length > 0)) {
    process.exitCode = 2;
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
