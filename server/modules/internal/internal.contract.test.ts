/**
 * Contract tests for the Smart Schedule → 駿斯 CMS internal export API.
 *
 * Locks in the 2026-06 on-shift-gating rules the CMS depends on:
 *   1. 00:00 防呆 — an unset / equal / empty start-end pair must NOT become a
 *      fake shift; it must surface with hasValidTime=false and must not be
 *      classified into early/late.
 *   2. role grouping — the SHIFT's functional role (s.role) drives grouping,
 *      not the employee's default title.
 *   3. leave-role shifts are emitted with a 請假(...) status so the CMS discards
 *      them from on-shift gating.
 *   4. employee.employeeNumber is populated for gating.
 */
import { describe, it, expect, vi } from "vitest";
vi.mock("../../infra/db", () => ({ db: {}, pool: {} }));
import {
  buildShiftTime,
  deriveShiftLabel,
  mapRegularShift,
  type EnrichmentBundle,
} from "./internal.service";
import type { Shift, Employee, Venue, Region } from "@shared/schema";

const DATE = "2026-06-05";

describe("buildShiftTime — 00:00 防呆 / valid-time contract", () => {
  it("emits ordered ISO timestamps with tz for a normal day shift", () => {
    const r = buildShiftTime(DATE, "08:00:00", "16:00:00");
    expect(r.startAt).toBe("2026-06-05T08:00:00+08:00");
    expect(r.endAt).toBe("2026-06-05T16:00:00+08:00");
    expect(r.hasValidTime).toBe(true);
  });

  it("flags 00:00–00:00 as invalid and does NOT roll to a fake 24h shift", () => {
    const r = buildShiftTime(DATE, "00:00:00", "00:00:00");
    expect(r.hasValidTime).toBe(false);
    // equal endpoints on the SAME day → CMS reads startAt === endAt → invalid
    expect(r.startAt).toBe(r.endAt);
    expect(r.endAt).toBe("2026-06-05T00:00:00+08:00");
  });

  it("flags an equal non-midnight pair (08:00=08:00) as invalid", () => {
    const r = buildShiftTime(DATE, "08:00", "08:00");
    expect(r.hasValidTime).toBe(false);
    expect(r.startAt).toBe(r.endAt);
  });

  it("flags an empty pair as invalid with null endpoints", () => {
    const r = buildShiftTime(DATE, "", "");
    expect(r.hasValidTime).toBe(false);
    expect(r.startAt).toBeNull();
    expect(r.endAt).toBeNull();
  });

  it("flags a one-sided (missing end) pair as invalid", () => {
    const r = buildShiftTime(DATE, "09:00:00", "");
    expect(r.hasValidTime).toBe(false);
    expect(r.startAt).toBe("2026-06-05T09:00:00+08:00");
    expect(r.endAt).toBeNull();
  });

  it("rolls a genuine overnight shift (22:00→06:00) to the next day and stays valid", () => {
    const r = buildShiftTime(DATE, "22:00:00", "06:00:00");
    expect(r.startAt).toBe("2026-06-05T22:00:00+08:00");
    expect(r.endAt).toBe("2026-06-06T06:00:00+08:00");
    expect(r.hasValidTime).toBe(true);
  });

  it("treats 16:00→00:00 as a real shift ending at next-day midnight", () => {
    const r = buildShiftTime(DATE, "16:00:00", "00:00:00");
    expect(r.endAt).toBe("2026-06-06T00:00:00+08:00");
    expect(r.hasValidTime).toBe(true);
  });

  it("treats 24:00 end as next-day midnight (full-day, valid)", () => {
    const r = buildShiftTime(DATE, "00:00:00", "24:00:00");
    expect(r.endAt).toBe("2026-06-06T00:00:00+08:00");
    expect(r.hasValidTime).toBe(true);
  });
});

describe("deriveShiftLabel", () => {
  it("prefers the leave type when present", () => {
    expect(deriveShiftLabel("custom", "00:00:00", "00:00:00", "特休")).toBe("特休");
  });
  it("maps period to a Chinese label", () => {
    expect(deriveShiftLabel("early", "08:00:00", "16:00:00", null)).toBe("早班");
    expect(deriveShiftLabel("late", "16:00:00", "22:00:00", null)).toBe("晚班");
  });
  it("falls back to an HH:MM range for custom", () => {
    expect(deriveShiftLabel("custom", "08:30:00", "17:30:00", null)).toBe("08:30-17:30");
  });
});

// --- minimal enrichment bundle helpers for mapRegularShift ----------------

function makeBundle(opts: {
  employee?: Partial<Employee>;
  venue?: Partial<Venue>;
  region?: Partial<Region>;
}): EnrichmentBundle {
  const region = { id: 1, code: "A", name: "三蘆戰區", ...opts.region } as Region;
  const venue = {
    id: 10,
    name: "新北高中館",
    shortName: "新北高中",
    regionId: 1,
    ...opts.venue,
  } as Venue;
  const employee = {
    id: 100,
    name: "王小明",
    employeeCode: "A001",
    regionId: 1,
    role: "pt",
    status: "active",
    department: null,
    ...opts.employee,
  } as Employee;
  return {
    regions: [region],
    regionById: new Map([[region.id, region]]),
    regionByCode: new Map([[region.code, region]]),
    venues: [venue],
    venueById: new Map([[venue.id, venue]]),
    employees: [employee],
    employeeById: new Map([[employee.id, employee]]),
  };
}

function makeShift(over: Partial<Shift>): Shift {
  return {
    id: 12345,
    employeeId: 100,
    venueId: 10,
    date: DATE,
    startTime: "08:00:00",
    endTime: "16:00:00",
    role: "櫃台",
    isDispatch: false,
    dispatchCompany: null,
    dispatchName: null,
    dispatchPhone: null,
    certificateImageUrl: null,
    notes: null,
    status: "active",
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    ...over,
  } as Shift;
}

describe("mapRegularShift — CMS contract fields", () => {
  it("groups by the SHIFT's role (櫃台), not the employee's title (pt)", () => {
    const b = makeBundle({ employee: { role: "pt" } });
    const out = mapRegularShift(makeShift({ role: "櫃台" }), b);
    expect(out.role).toBe("櫃台");
  });

  it("preserves 守望 verbatim for the CMS (the spec groups 救生 / 守望 separately — NO 守望→救生 collapse here)", () => {
    const out = mapRegularShift(makeShift({ role: "守望" }), makeBundle({}));
    expect(out.role).toBe("守望");
  });

  it("populates employee.employeeNumber for on-shift gating", () => {
    const b = makeBundle({ employee: { employeeCode: "A001" } });
    const out = mapRegularShift(makeShift({}), b);
    expect(out.employee?.employeeNumber).toBe("A001");
    expect(out.employee?.name).toBe("王小明");
  });

  it("emits valid startAt/endAt + hasValidTime + label for a normal shift", () => {
    const out = mapRegularShift(makeShift({ startTime: "08:00:00", endTime: "16:00:00" }), makeBundle({}));
    expect(out.shift.hasValidTime).toBe(true);
    expect(out.shift.startAt).toBe("2026-06-05T08:00:00+08:00");
    expect(out.shift.endAt).toBe("2026-06-05T16:00:00+08:00");
    expect(out.assignment.status).toBe("scheduled");
    expect(out.shift.label).toBe("早班");
  });

  it("marks a 00:00–00:00 shift invalid and keeps it out of early/late", () => {
    const out = mapRegularShift(makeShift({ startTime: "00:00:00", endTime: "00:00:00" }), makeBundle({}));
    expect(out.shift.hasValidTime).toBe(false);
    expect(out.period).toBe("custom");
    expect(out.shift.period).toBe("custom");
  });

  it("flags a leave-role shift with a 請假(...) status so the CMS discards it", () => {
    const out = mapRegularShift(makeShift({ role: "特休", startTime: "00:00:00", endTime: "00:00:00" }), makeBundle({}));
    expect(out.assignment.status).toContain("請假");
    expect(out.assignment.leaveType).toBe("特休");
    expect(out.shift.hasValidTime).toBe(false);
  });
});
