import { and, eq, like, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { manualScheduleCourses, shifts, summerScheduleAssignments } from "@shared/schema";
import { db } from "../../infra/db";
import { concurrently, createEmployee, createRegion, createVenue, resetDatabase, warmPool } from "../../test/itest";
import { summerScheduleService } from "./summerSchedule.service";

/** Week 1 of the 2026 summer runs 07/01–07/05. */
const WEEK = 1;

async function people(n: number) {
  const region = await createRegion();
  const venue = await createVenue({ regionId: region.id });
  const employees = [];
  for (let i = 0; i < n; i += 1) employees.push(await createEmployee({ regionId: region.id }));
  return { region, venue, employees };
}

const entry = (employeeId: number, venueId: number, day: number, start = "09:00", end = "12:00") => ({
  employeeId,
  venueId,
  date: `2026-07-0${day}`,
  startTime: start,
  endTime: end,
  role: "教練",
  notes: "游泳",
});

const draft = (entries: unknown[], over: Record<string, unknown> = {}) => ({
  weekNo: WEEK,
  rawEntries: [{ key: "v-course-1", value: "排了人", employees: [] }],
  assignments: [{ key: "v-course-1" }],
  shifts: entries,
  ...over,
});

const publishedWeek = () =>
  db
    .select()
    .from(shifts)
    .where(and(eq(shifts.status, "active"), like(shifts.notes, "%暑假排班v40%")))
    .orderBy(shifts.id);

const storedDraft = async () => (await db.select().from(summerScheduleAssignments))[0];

/** Make every insert into the table take a while, so two runs that read before writing always overlap. */
async function slowInserts(table: string) {
  await db.execute(sql.raw(`create or replace function itest_slow() returns trigger language plpgsql as $$ begin perform pg_sleep(0.05); return new; end $$`));
  await db.execute(sql.raw(`create trigger itest_slow before insert on ${table} for each row execute function itest_slow()`));
}

async function failWhen(table: string, condition: string) {
  await db.execute(sql.raw(`create or replace function itest_fail() returns trigger language plpgsql as $$ begin raise exception 'itest: forced failure'; end $$`));
  await db.execute(sql.raw(`create trigger itest_fail before insert on ${table} for each row when (${condition}) execute function itest_fail()`));
}

beforeEach(async () => {
  await resetDatabase();
});

afterEach(async () => {
  await db.execute(sql.raw(`drop trigger if exists itest_fail on shifts`));
  await db.execute(sql.raw(`drop trigger if exists itest_fail on manual_schedule_courses`));
  await db.execute(sql.raw(`drop trigger if exists itest_slow on manual_schedule_courses`));
});

describe("summer draft save (T60, #9 server side)", () => {
  it("a save that names the version it read is stored and answers a newer version", async () => {
    const { venue, employees } = await people(1);
    const first = await summerScheduleService.saveScheduleAssignments(draft([entry(employees[0].id, venue.id, 1)]));

    const second = await summerScheduleService.saveScheduleAssignments(
      draft([entry(employees[0].id, venue.id, 2)], { expectedUpdatedAt: first.updatedAt }),
    );

    expect(new Date(second.updatedAt).getTime()).toBeGreaterThan(new Date(first.updatedAt).getTime());
    expect(((await storedDraft()).shiftEntries as any[])[0].date).toBe("2026-07-02");
  });

  it("a save that names an older version gets 409 and the stored draft is unchanged", async () => {
    const { venue, employees } = await people(1);
    const first = await summerScheduleService.saveScheduleAssignments(draft([entry(employees[0].id, venue.id, 1)]));
    const second = await summerScheduleService.saveScheduleAssignments(draft([entry(employees[0].id, venue.id, 2)], { expectedUpdatedAt: first.updatedAt }));

    const error: any = await summerScheduleService
      .saveScheduleAssignments(draft([entry(employees[0].id, venue.id, 3)], { expectedUpdatedAt: first.updatedAt }))
      .catch((e) => e);

    expect(error.status).toBe(409);
    expect(error.extra?.updatedAt).toBe(second.updatedAt);
    const stored = await storedDraft();
    expect([((stored.shiftEntries as any[])[0]).date, stored.updatedAt?.toISOString()]).toEqual(["2026-07-02", second.updatedAt]);
  });

  it("two saves made from the same read at the same moment: one is stored, the other gets 409", async () => {
    const { venue, employees } = await people(1);
    const first = await summerScheduleService.saveScheduleAssignments(draft([entry(employees[0].id, venue.id, 1)]));
    await warmPool(4);

    const results = await concurrently(2, (i) =>
      summerScheduleService.saveScheduleAssignments(draft([entry(employees[0].id, venue.id, 2 + i)], { expectedUpdatedAt: first.updatedAt })),
    );

    expect(results.map((r) => (r.status === "fulfilled" ? 200 : (r.reason as any).status)).sort()).toEqual([200, 409]);
  });

  it("a save that expects no draft yet is refused once a draft exists", async () => {
    const { venue, employees } = await people(1);
    await summerScheduleService.saveScheduleAssignments(draft([entry(employees[0].id, venue.id, 1)]));

    const error: any = await summerScheduleService
      .saveScheduleAssignments(draft([entry(employees[0].id, venue.id, 2)], { expectedUpdatedAt: null }))
      .catch((e) => e);

    expect(error.status).toBe(409);
  });

  it("the stored version name is fixed by the server: a page sending another version still saves the v40 draft", async () => {
    const { venue, employees } = await people(1);

    await summerScheduleService.saveScheduleAssignments(draft([entry(employees[0].id, venue.id, 1)], { version: "v41" }));

    const read = await summerScheduleService.getScheduleAssignments(WEEK);
    expect([read?.version, (read?.shifts as any[])?.length]).toEqual(["v40", 1]);
  });
});

describe("summer manual course create (T61)", () => {
  const course = (venueId: number) => ({ weekNo: WEEK, date: "2026-07-02", venueId, courseName: "測試補習班-游泳", startTime: "16:00", endTime: "17:00" });

  it("one request id sent twice at the same moment stores the course once", async () => {
    const { venue } = await people(0);
    await warmPool(4);

    const results = await concurrently(2, () => summerScheduleService.createManualCourses([course(venue.id)], "req-1"));

    const rows = await db.select().from(manualScheduleCourses);
    expect(rows).toHaveLength(1);
    expect(results.map((r) => (r.status === "fulfilled" ? (r.value as any[]).map((c) => c.id) : r.reason?.message))).toEqual([[rows[0].id], [rows[0].id]]);
  });

  it("a resent course is published as one coach shift, not one per copy", async () => {
    const { venue, employees } = await people(1);
    await summerScheduleService.createManualCourses([{ ...course(venue.id), employeeId: employees[0].id }], "req-1");
    await summerScheduleService.createManualCourses([{ ...course(venue.id), employeeId: employees[0].id }], "req-1");
    await summerScheduleService.saveScheduleAssignments(draft([entry(employees[0].id, venue.id, 1)]));

    await summerScheduleService.publishShifts({ weekNo: WEEK });

    expect((await publishedWeek()).filter((s) => s.notes?.includes("手動課程"))).toHaveLength(1);
  });
});

describe("cram school course import (T64)", () => {
  const rows = (n: number, coach?: string) =>
    Array.from({ length: n }, (_, i) => ({
      cramName: "測試補習班",
      sportType: "",
      date: `2026-07-0${(i % 5) + 1}`,
      startTime: `${String(8 + Math.floor(i / 5)).padStart(2, "0")}:00`,
      endTime: `${String(9 + Math.floor(i / 5)).padStart(2, "0")}:00`,
      registeredCount: 5,
      requiredCoaches: 1,
      coachNames: coach ?? "",
      venueId: 0,
    }));

  it("the same import run twice at the same moment keeps one course per row", async () => {
    const { venue } = await people(0);
    const payload = { rows: rows(20).map((r) => ({ ...r, venueId: venue.id })) };
    await slowInserts("manual_schedule_courses");
    await warmPool(4);

    const results = await concurrently(2, () => summerScheduleService.importCramCourses(payload));

    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(await db.select().from(manualScheduleCourses)).toHaveLength(20);
  });

  it("a second run updates the courses it already imported", async () => {
    const { venue } = await people(0);
    const payload = { rows: rows(5).map((r) => ({ ...r, venueId: venue.id })) };

    await summerScheduleService.importCramCourses(payload);
    const again = await summerScheduleService.importCramCourses({ rows: payload.rows.map((r) => ({ ...r, registeredCount: 9 })) });

    expect([again.insertedCount, again.updatedCount]).toEqual([0, 5]);
    const stored = await db.select().from(manualScheduleCourses);
    expect(stored.map((c) => c.registeredCount)).toEqual([9, 9, 9, 9, 9]);
  });

  it("an update does not overwrite a coach the admin changed", async () => {
    const { venue, employees } = await people(2);
    const [fromSheet, fromAdmin] = employees;
    const payload = { rows: rows(1, fromSheet.name).map((r) => ({ ...r, venueId: venue.id })) };
    await summerScheduleService.importCramCourses(payload);
    const [imported] = await db.select().from(manualScheduleCourses);
    await summerScheduleService.updateManualCourse(imported.id, { employeeId: fromAdmin.id, employeeName: fromAdmin.name });

    await summerScheduleService.importCramCourses(payload);

    const [after] = await db.select().from(manualScheduleCourses);
    expect([after.employeeId, after.employeeName]).toEqual([fromAdmin.id, fromAdmin.name]);
  });

  it("a database failure on one row rolls back the whole run", async () => {
    const { venue } = await people(0);
    const payload = { rows: rows(10).map((r, i) => ({ ...r, venueId: venue.id, cramName: i === 6 ? "BOOM" : r.cramName })) };
    await failWhen("manual_schedule_courses", "new.course_name like 'BOOM%'");

    const error: any = await summerScheduleService.importCramCourses(payload).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(await db.select().from(manualScheduleCourses)).toHaveLength(0);
  });
});

describe("summer publish (T65, #8)", () => {
  async function weekWith(n: number) {
    const { venue, employees } = await people(n);
    const entries = employees.map((e, i) => entry(e.id, venue.id, (i % 5) + 1));
    await summerScheduleService.saveScheduleAssignments(draft(entries));
    return { venue, employees, entries };
  }

  it("publishing the same draft again keeps every shift id", async () => {
    await weekWith(4);
    await summerScheduleService.publishShifts({ weekNo: WEEK });
    const before = (await publishedWeek()).map((s) => s.id);

    const again: any = await summerScheduleService.publishShifts({ weekNo: WEEK });

    expect((await publishedWeek()).map((s) => s.id)).toEqual(before);
    expect([again.success, again.inserted, again.created, again.cancelled, again.unchanged]).toEqual([true, 4, 0, 0, 4]);
  });

  it("changing one entry replaces only that shift", async () => {
    const { venue, employees, entries } = await weekWith(4);
    await summerScheduleService.publishShifts({ weekNo: WEEK });
    const before = await publishedWeek();
    const read = await summerScheduleService.getScheduleAssignments(WEEK);
    const changed = [...entries.slice(0, 3), entry(employees[3].id, venue.id, 4, "13:00", "15:00")];
    await summerScheduleService.saveScheduleAssignments(draft(changed, { expectedUpdatedAt: read!.updatedAt!.toISOString() }));

    await summerScheduleService.publishShifts({ weekNo: WEEK });

    const after = await publishedWeek();
    expect(after.slice(0, 3).map((s) => s.id)).toEqual(before.slice(0, 3).map((s) => s.id));
    expect(after).toHaveLength(4);
    expect([after[3].id === before[3].id, after[3].startTime]).toEqual([false, "13:00:00"]);
    const [old] = await db.select().from(shifts).where(eq(shifts.id, before[3].id));
    expect(old.status).toBe("cancelled");
  });

  it("two publishes at the same moment leave one copy of the week", async () => {
    await weekWith(6);
    await warmPool(4);

    const results = await concurrently(2, () => summerScheduleService.publishShifts({ weekNo: WEEK }));

    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(await publishedWeek()).toHaveLength(6);
  });

  it("when the third new shift fails to insert, the old week stays active and nothing new is left", async () => {
    const { venue, employees, entries } = await weekWith(4);
    await summerScheduleService.publishShifts({ weekNo: WEEK });
    const before = await publishedWeek();
    const boom = await createEmployee({ regionId: employees[0].regionId });
    const read = await summerScheduleService.getScheduleAssignments(WEEK);
    const moved = entries.map((e) => ({ ...e, startTime: "14:00", endTime: "16:00" }));
    moved.splice(2, 0, entry(boom.id, venue.id, 3, "14:00", "16:00"));
    await summerScheduleService.saveScheduleAssignments(draft(moved, { expectedUpdatedAt: read!.updatedAt!.toISOString() }));
    await failWhen("shifts", `new.employee_id = ${boom.id}`);

    const error: any = await summerScheduleService.publishShifts({ weekNo: WEEK }).catch((e) => e);

    expect(error.message).toContain("itest: forced failure");
    expect((await publishedWeek()).map((s) => [s.id, s.startTime])).toEqual(before.map((s) => [s.id, "09:00:00"]));
    expect(await db.select().from(shifts)).toHaveLength(4);
  });

  it("a week with nothing to publish is refused, not reported as success", async () => {
    await people(1);

    const error: any = await summerScheduleService.publishShifts({ weekNo: WEEK }).catch((e) => e);

    expect([error.status, error.extra?.success, error.extra?.inserted]).toEqual([422, false, 0]);
  });

  it("shifts sent in the request body are ignored; the stored draft is what gets published", async () => {
    const { venue, employees } = await weekWith(2);
    const other = entry(employees[0].id, venue.id, 5, "18:00", "20:00");

    await summerScheduleService.publishShifts({ weekNo: WEEK, shifts: [other, other, other] });

    const week = await publishedWeek();
    expect(week.map((s) => s.date)).toEqual(["2026-07-01", "2026-07-02"]);
  });

  it("a draft with an invalid row is refused with 422 and the published week is untouched", async () => {
    const { venue, employees, entries } = await weekWith(2);
    await summerScheduleService.publishShifts({ weekNo: WEEK });
    const before = await publishedWeek();
    const read = await summerScheduleService.getScheduleAssignments(WEEK);
    await summerScheduleService.saveScheduleAssignments(
      draft([...entries, { ...entry(employees[0].id, venue.id, 1), date: "2026-07-09" }], { expectedUpdatedAt: read!.updatedAt!.toISOString() }),
    );

    const error: any = await summerScheduleService.publishShifts({ weekNo: WEEK }).catch((e) => e);

    expect([error.status, error.extra?.errorCode]).toEqual([422, "SUMMER_PUBLISH_INVALID_ROWS"]);
    expect((await publishedWeek()).map((s) => s.id)).toEqual(before.map((s) => s.id));
  });
});
