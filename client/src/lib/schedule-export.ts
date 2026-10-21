import type { Shift, Venue, Region, DispatchShift, VenueShiftTemplate } from "@shared/schema";
import type { ScheduleEmployee } from "@shared/schedule-history";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const hhmm = (time: string) => time.substring(0, 5);

export interface ScheduleExportInput {
  shifts: Shift[];
  // The employees whose rows are currently shown on the schedule.
  employees: ScheduleEmployee[];
  dispatchShifts: DispatchShift[];
  venues: Map<number, Venue>;
  regions: Region[];
  templates: VenueShiftTemplate[];
  leaveTypes: readonly string[];
  startDate: string;
  endDate: string;
}

export interface ScheduleExportRow {
  "日期": string;
  "星期": string;
  "區域": string;
  "場館": string;
  "姓名": string;
  "員工編號": string;
  "身分": string;
  "職務": string;
  "班別": string;
  "開始": string;
  "結束": string;
  "派遣": string;
  "備註": string;
}

// One row per shift: an employee with two shifts on the same day gets two rows.
export function buildScheduleExportRows(input: ScheduleExportInput): ScheduleExportRow[] {
  const { shifts, employees, dispatchShifts, venues, regions, templates, leaveTypes, startDate, endDate } = input;
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const regionName = new Map(regions.map((r) => [r.id, r.name]));
  const inRange = (date: string) => date >= startDate && date <= endDate;

  // A shift only stores its times, so the label comes from the venue's templates when exactly one label fits.
  const labelsByKey = new Map<string, Set<string>>();
  for (const t of templates) {
    const key = `${t.venueId}|${hhmm(t.startTime)}|${hhmm(t.endTime)}`;
    if (!labelsByKey.has(key)) labelsByKey.set(key, new Set());
    labelsByKey.get(key)!.add(t.shiftLabel);
  }
  const shiftLabel = (venueId: number | null, start: string, end: string) => {
    const labels = labelsByKey.get(`${venueId}|${hhmm(start)}|${hhmm(end)}`);
    return labels && labels.size === 1 ? [...labels][0] : "";
  };

  const place = (venueId: number | null, fallbackRegionId?: number) => {
    const venue = venueId == null ? undefined : venues.get(venueId);
    const regionId = venue?.regionId ?? fallbackRegionId;
    return { "區域": (regionId != null && regionName.get(regionId)) || "", "場館": venue?.shortName || "" };
  };
  const weekday = (date: string) => WEEKDAYS[new Date(`${date}T00:00:00`).getDay()];

  const rows: ScheduleExportRow[] = [];
  for (const s of shifts) {
    const employee = employeeById.get(s.employeeId);
    if (!employee || !inRange(s.date)) continue;
    const isLeave = leaveTypes.includes(s.role);
    rows.push({
      "日期": s.date,
      "星期": weekday(s.date),
      ...place(s.venueId),
      "姓名": employee.name,
      "員工編號": employee.employeeCode,
      "身分": employee.status === "active" ? "在職" : "離職",
      "職務": s.role || employee.role,
      "班別": isLeave ? "" : shiftLabel(s.venueId, s.startTime, s.endTime),
      "開始": isLeave ? "" : hhmm(s.startTime),
      "結束": isLeave ? "" : hhmm(s.endTime),
      "派遣": s.isDispatch ? "是" : "",
      "備註": s.notes || "",
    });
  }
  for (const d of dispatchShifts) {
    if (d.status !== "active" || !inRange(d.date)) continue;
    rows.push({
      "日期": d.date,
      "星期": weekday(d.date),
      ...place(d.venueId, d.regionId),
      "姓名": d.dispatchName,
      "員工編號": "",
      "身分": "派遣人員",
      "職務": d.role,
      "班別": shiftLabel(d.venueId, d.startTime, d.endTime),
      "開始": hhmm(d.startTime),
      "結束": hhmm(d.endTime),
      "派遣": "是",
      "備註": [d.dispatchCompany, d.notes].filter(Boolean).join("／"),
    });
  }

  return rows.sort((a, b) =>
    a["日期"].localeCompare(b["日期"]) || a["開始"].localeCompare(b["開始"]) || a["場館"].localeCompare(b["場館"]) || a["姓名"].localeCompare(b["姓名"]),
  );
}
