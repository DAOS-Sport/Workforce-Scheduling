import { calcShiftHours, sumScheduledHours, getAllPeriodsForMonth } from "@shared/schema";
import { pushToLine } from "../line/linePush.service";
import { db } from "../../infra/db";
import { isNotNull, and, gte, lte } from "drizzle-orm";
import { dispatchShifts as dispatchShiftsTable } from "@shared/schema";
import { sendAnomalyEmail } from "../../shared/email/sendAnomalyEmail";
import { TAIWAN_HOLIDAYS } from "../../core/calendar/taiwanHolidays";
import ExcelJS from "exceljs";

import { LEAVE_TYPES } from "@shared/leave";
import { httpError } from "../../shared/http/response";
import { systemRepository } from "./system.repository";
import { shiftService } from "../shift/shift.service";
import { overtimeService } from "../overtime/overtime.service";
import { employeeService } from "../employee/employee.service";
import { regionService } from "../region/region.service";
import { venueService } from "../venue/venue.service";
import { clockService } from "../clock/clock.service";
import { notificationService } from "../notification/notification.service";
const ATTENDANCE_GRACE_MINUTES = 10;

function parseAttendanceIssueMinutes(reason: string | null | undefined, prefix: string): number | null {
  if (!reason) return null;
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const reHM = new RegExp(`${escapedPrefix}\\s*(\\d+)\\s*小時\\s*(\\d+)\\s*分鐘`);
  const reH = new RegExp(`${escapedPrefix}\\s*(\\d+)\\s*小時`);
  const reM = new RegExp(`${escapedPrefix}\\s*(\\d+)\\s*分鐘`);
  let match = reason.match(reHM);
  if (match) return Number(match[1]) * 60 + Number(match[2]);
  match = reason.match(reH);
  if (match) return Number(match[1]) * 60;
  match = reason.match(reM);
  if (match) return Number(match[1]);
  return reason.includes(prefix) ? ATTENDANCE_GRACE_MINUTES + 1 : null;
}

function hasAttendanceIssueBeyondGrace(
  records: Array<{ failReason?: string | null }>,
  prefix: string,
): boolean {
  return records.some((record) => {
    const minutes = parseAttendanceIssueMinutes(record.failReason, prefix);
    return minutes !== null && minutes > ATTENDANCE_GRACE_MINUTES;
  });
}

export const systemService = {
  async listSalaryRates() {
    return await systemRepository.getSalaryRates();
  },

  async upsertSalaryRate(role: string, ratePerHour: number, label?: string) {
    if (!role || ratePerHour === undefined || ratePerHour === null) throw httpError(400, "需提供 role 和 ratePerHour");
    return await systemRepository.upsertSalaryRate(role, Number(ratePerHour), label);
  },

  async getSystemConfig(key: string) {
    const config = await systemRepository.getSystemConfig(key);
    return config ?? { key, value: null };
  },

  async upsertSystemConfig(key: string, value: any) {
    if (value === undefined || value === null) throw httpError(400, "需提供 value");
    return await systemRepository.upsertSystemConfig(key, String(value));
  },

  async fourWeekCompliance(year: number, month: number, regionCode?: string) {
    if (!year || !month || month < 1 || month > 12) throw httpError(400, "需提供正確的 year 和 month");
    const refConfig = await systemRepository.getSystemConfig("four_week_reference_date");
    const referenceDate = refConfig?.value || "2025-01-06";

    const periods = getAllPeriodsForMonth(year, month, referenceDate);
    const allStart = periods.reduce((min, p) => p.start < min ? p.start : min, periods[0].start);
    const allEnd = periods.reduce((max, p) => p.end > max ? p.end : max, periods[0].end);

    const allShifts = await shiftService.getAllShiftsByDateRange(allStart, allEnd);
    const approvedOT = await overtimeService.getApprovedOvertimeByDateRange(allStart, allEnd);
    const allEmployees = await employeeService.getAllEmployees();
    const allRegions = await regionService.findAll();
    const regionMap = new Map(allRegions.map(r => [r.id, r]));
    const regionFilter = regionCode ? allRegions.find(r => r.code === regionCode) : null;

    const activeEmps = allEmployees.filter(e => {
      if (e.status !== "active") return false;
      if (regionFilter && e.regionId !== regionFilter.id) return false;
      return true;
    });

    const empIdsWithShifts = new Set<number>();
    for (const s of allShifts) if (!LEAVE_TYPES.includes(s.role)) empIdsWithShifts.add(s.employeeId);
    for (const ot of approvedOT) empIdsWithShifts.add(ot.employeeId);

    const periodResults = periods.map(period => {
      const employees = [];
      for (const emp of activeEmps) {
        if (!empIdsWithShifts.has(emp.id)) continue;
        const scheduledHours = sumScheduledHours(allShifts, emp.id, period.start, period.end, LEAVE_TYPES);
        let overtimeHours = 0;
        for (const ot of approvedOT) {
          if (ot.employeeId !== emp.id) continue;
          if (ot.date < period.start || ot.date > period.end) continue;
          overtimeHours += calcShiftHours(ot.startTime, ot.endTime);
        }
        overtimeHours = Math.round(overtimeHours * 10) / 10;
        const combinedTotal = Math.round((scheduledHours + overtimeHours) * 10) / 10;
        const overtimeAbove160 = Math.max(0, Math.round((combinedTotal - 160) * 10) / 10);
        let status: "normal" | "warning" | "over" = "normal";
        if (combinedTotal > 176) status = "over";
        else if (combinedTotal > 160) status = "warning";
        const region = regionMap.get(emp.regionId);
        employees.push({
          employeeId: emp.id, employeeName: emp.name, employeeCode: emp.employeeCode,
          region: region?.name || "未知",
          scheduledHours, overtimeHours, combinedTotal, overtimeAbove160, status,
        });
      }
      employees.sort((a, b) => b.combinedTotal - a.combinedTotal);
      return { periodStart: period.start, periodEnd: period.end, employees };
    });

    return { referenceDate, normalLimit: 160, overtimeLimit: 176, periods: periodResults };
  },

  async salaryReport(year: number, month: number, regionCode?: string) {
    if (!year || !month || month < 1 || month > 12) throw httpError(400, "需提供正確的 year 和 month");

    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    const allShifts = await shiftService.getAllShiftsByDateRange(startDate, endDate);
    const approvedOT = await overtimeService.getApprovedOvertimeByDateRange(startDate, endDate);
    const allEmployees = await employeeService.getAllEmployees();
    const allRegions = await regionService.findAll();
    const regionMap = new Map(allRegions.map(r => [r.id, r]));
    const regionFilter = regionCode ? allRegions.find(r => r.code === regionCode) : null;


    const isHolidayDate = (dateStr: string): boolean => {
      const d = new Date(dateStr + "T00:00:00");
      return d.getDay() === 0 || d.getDay() === 6 || !!TAIWAN_HOLIDAYS[dateStr];
    };
    const rawHours = (start: string, end: string): number => {
      const [sh, sm] = start.split(":").map(Number);
      const [eh, em] = end.split(":").map(Number);
      let mins = (eh * 60 + em) - (sh * 60 + sm);
      if (mins < 0) mins += 24 * 60;
      return Math.round(mins / 60 * 10) / 10;
    };
    const NOON = 12 * 60 + 30;
    const passesNoon = (start: string, end: string): boolean => {
      const [sh, sm] = start.split(":").map(Number);
      const [eh, em] = end.split(":").map(Number);
      const sM = sh * 60 + sm;
      const eM = eh * 60 + em;
      if (eM <= sM) return sM <= NOON || eM >= NOON;
      return sM <= NOON && eM >= NOON;
    };

    const empMap = new Map<number, typeof allEmployees[0]>();
    for (const e of allEmployees) empMap.set(e.id, e);

    const workRolesSet = new Set<string>();
    const leaveSet = new Set<string>(LEAVE_TYPES);

    type EmpStats = {
      id: number; name: string; employeeCode: string; region: string;
      hours: Record<string, number>; leaves: Record<string, number>;
      totalWorkHours: number; totalLeaveDays: number; shiftCount: number;
      overtimeHours: number; breakDeduction: number;
    };
    const stats = new Map<number, EmpStats>();

    for (const s of allShifts) {
      const emp = empMap.get(s.employeeId);
      if (!emp) continue;
      if (!stats.has(s.employeeId)) {
        const region = regionMap.get(emp.regionId);
        stats.set(s.employeeId, {
          id: emp.id, name: emp.name, employeeCode: emp.employeeCode, region: region?.name || "",
          hours: {}, leaves: {}, totalWorkHours: 0, totalLeaveDays: 0, shiftCount: 0,
          overtimeHours: 0, breakDeduction: 0,
        });
      }
      const entry = stats.get(s.employeeId)!;
      entry.shiftCount++;
      if (leaveSet.has(s.role)) {
        entry.leaves[s.role] = (entry.leaves[s.role] || 0) + 1;
        entry.totalLeaveDays++;
      } else {
        const hrs = rawHours(s.startTime, s.endTime);
        entry.hours[s.role] = (entry.hours[s.role] || 0) + hrs;
        entry.totalWorkHours = Math.round((entry.totalWorkHours + hrs) * 10) / 10;
        workRolesSet.add(s.role);
      }
    }

    const empShiftIntervals = new Map<number, Array<{ start: number; end: number; date: string }>>();
    for (const s of allShifts) {
      if (!empMap.has(s.employeeId) || leaveSet.has(s.role)) continue;
      if (!empShiftIntervals.has(s.employeeId)) empShiftIntervals.set(s.employeeId, []);
      const [sh2, sm2] = s.startTime.split(":").map(Number);
      const [eh2, em2] = s.endTime.split(":").map(Number);
      empShiftIntervals.get(s.employeeId)!.push({
        start: sh2 * 60 + sm2, end: eh2 * 60 + em2, date: s.date,
      });
    }

    for (const ot of approvedOT) {
      const emp = empMap.get(ot.employeeId);
      if (!emp) continue;
      if (!stats.has(ot.employeeId)) {
        const region = regionMap.get(emp.regionId);
        stats.set(ot.employeeId, {
          id: emp.id, name: emp.name, employeeCode: emp.employeeCode, region: region?.name || "",
          hours: {}, leaves: {}, totalWorkHours: 0, totalLeaveDays: 0, shiftCount: 0,
          overtimeHours: 0, breakDeduction: 0,
        });
      }
      const entry = stats.get(ot.employeeId)!;
      const [otSh, otSm] = ot.startTime.split(":").map(Number);
      const [otEh, otEm] = ot.endTime.split(":").map(Number);
      let otStartMins = otSh * 60 + otSm;
      let otEndMins = otEh * 60 + otEm;
      if (otEndMins <= otStartMins) otEndMins += 24 * 60;

      const shifts = empShiftIntervals.get(ot.employeeId) || [];
      const sameDayShifts = shifts.filter(si => si.date === ot.date);
      let nonOverlapMins = otEndMins - otStartMins;
      for (const si of sameDayShifts) {
        let siEnd = si.end;
        if (siEnd <= si.start) siEnd += 24 * 60;
        const overlapStart = Math.max(otStartMins, si.start);
        const overlapEnd = Math.min(otEndMins, siEnd);
        if (overlapEnd > overlapStart) nonOverlapMins -= (overlapEnd - overlapStart);
      }
      if (nonOverlapMins > 0) {
        const otHrs = Math.round(nonOverlapMins / 60 * 10) / 10;
        entry.overtimeHours = Math.round((entry.overtimeHours + otHrs) * 10) / 10;
        entry.totalWorkHours = Math.round((entry.totalWorkHours + otHrs) * 10) / 10;
      }
    }

    const linkedDispatch = await db.select().from(dispatchShiftsTable).where(
      and(
        gte(dispatchShiftsTable.date, startDate),
        lte(dispatchShiftsTable.date, endDate),
        isNotNull(dispatchShiftsTable.linkedEmployeeId)
      )
    );
    for (const ds of linkedDispatch) {
      const empId = ds.linkedEmployeeId!;
      const emp = empMap.get(empId);
      if (!emp) continue;
      if (!stats.has(empId)) {
        const region = regionMap.get(emp.regionId);
        stats.set(empId, {
          id: emp.id, name: emp.name, employeeCode: emp.employeeCode, region: region?.name || "",
          hours: {}, leaves: {}, totalWorkHours: 0, totalLeaveDays: 0, shiftCount: 0,
          overtimeHours: 0, breakDeduction: 0,
        });
      }
      const entry = stats.get(empId)!;
      const role = ds.role || "派遣";
      const hrs = rawHours(ds.startTime, ds.endTime);
      entry.hours[role] = Math.round(((entry.hours[role] || 0) + hrs) * 10) / 10;
      entry.totalWorkHours = Math.round((entry.totalWorkHours + hrs) * 10) / 10;
      entry.shiftCount++;
      workRolesSet.add(role);
    }

    for (const s of allShifts) {
      if (!empMap.has(s.employeeId)) continue;
      if (leaveSet.has(s.role)) continue;
      if (!passesNoon(s.startTime, s.endTime)) continue;
      const entry = stats.get(s.employeeId);
      if (!entry) continue;
      const deduction = isHolidayDate(s.date) ? 0.5 : 1;
      entry.totalWorkHours = Math.max(0, Math.round((entry.totalWorkHours - deduction) * 10) / 10);
      entry.breakDeduction = Math.round((entry.breakDeduction + deduction) * 10) / 10;
    }
    for (const ds of linkedDispatch) {
      if (!passesNoon(ds.startTime, ds.endTime)) continue;
      const entry = stats.get(ds.linkedEmployeeId!);
      if (!entry) continue;
      const deduction = isHolidayDate(ds.date) ? 0.5 : 1;
      entry.totalWorkHours = Math.max(0, Math.round((entry.totalWorkHours - deduction) * 10) / 10);
      entry.breakDeduction = Math.round((entry.breakDeduction + deduction) * 10) / 10;
    }

    const allStatsList = Array.from(stats.values());
    const filteredStats = regionFilter
      ? allStatsList.filter(e => {
          const emp = allEmployees.find(a => a.id === e.id);
          return emp && emp.regionId === regionFilter.id;
        })
      : allStatsList;

    const employees = filteredStats.sort((a, b) =>
      a.region.localeCompare(b.region) || a.name.localeCompare(b.name, "zh-Hant")
    );
    const workRoles = Array.from(
      filteredStats.reduce((s, e) => { Object.keys(e.hours).forEach(r => s.add(r)); return s; }, new Set<string>())
    ).sort();
    const leaveTypes = LEAVE_TYPES.filter(l => filteredStats.some(e => e.leaves[l]));
    const hasOvertimeData = filteredStats.some(e => e.overtimeHours > 0);

    return { year, month, workRoles, leaveTypes, employees, hasOvertimeData };
  },

  async salaryReportExcel(year: number, month: number, regionCode?: string): Promise<Buffer> {
    if (!year || !month || month < 1 || month > 12) throw httpError(400, "需提供正確的 year 和 month");

    const report = await this.salaryReport(year, month, regionCode);

    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    const allEmployees = await employeeService.getAllEmployees();
    const allVenues = await venueService.findAll();
    const venueMap = new Map(allVenues.map(v => [v.id, v]));
    const empMap = new Map(allEmployees.map(e => [e.id, e]));

    const linkedDispatch = await db.select().from(dispatchShiftsTable).where(
      and(
        gte(dispatchShiftsTable.date, startDate),
        lte(dispatchShiftsTable.date, endDate),
        isNotNull(dispatchShiftsTable.linkedEmployeeId),
      )
    );

    const rawHoursLocal = (start: string, end: string): number => {
      const [sh, sm] = start.split(":").map(Number);
      const [eh, em] = end.split(":").map(Number);
      let mins = (eh * 60 + em) - (sh * 60 + sm);
      if (mins < 0) mins += 24 * 60;
      return Math.round(mins / 60 * 10) / 10;
    };

    const wb = new ExcelJS.Workbook();
    wb.creator = "三蘆智慧管理系統";
    wb.created = new Date();

    const headerFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
    const headerFont: Partial<ExcelJS.Font> = { color: { argb: "FFFFFFFF" }, bold: true, size: 11 };
    const borderStyle: Partial<ExcelJS.Borders> = {
      top: { style: "thin" }, left: { style: "thin" },
      bottom: { style: "thin" }, right: { style: "thin" },
    };

    const ws1 = wb.addWorksheet("工時彙總");
    const roleHeaders = report.workRoles;
    const leaveHeaders = report.leaveTypes;
    const ws1Headers = ["區域", "員工代號", "姓名", "班次數", ...roleHeaders.map(r => `${r}時數`), ...leaveHeaders.map(l => `${l}(天)`), "加班時數", "休息扣除", "工時合計"];
    const ws1Head = ws1.addRow(ws1Headers);
    ws1Head.eachCell(cell => {
      cell.fill = headerFill; cell.font = headerFont; cell.border = borderStyle;
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });
    ws1.getRow(1).height = 22;
    ws1.columns = ws1Headers.map((h, i) => ({ key: `c${i}`, width: i < 3 ? 14 : 10 }));

    for (const emp of report.employees) {
      const row = [emp.region, emp.employeeCode, emp.name, emp.shiftCount,
        ...roleHeaders.map(r => emp.hours[r] || 0),
        ...leaveHeaders.map(l => emp.leaves[l] || 0),
        emp.overtimeHours, emp.breakDeduction, emp.totalWorkHours];
      const r = ws1.addRow(row);
      r.eachCell(cell => { cell.border = borderStyle; cell.alignment = { horizontal: "center", vertical: "middle" }; });
      r.getCell(3).alignment = { horizontal: "left", vertical: "middle" };
      ws1.getRow(r.number).height = 18;
    }
    ws1.getRow(1).font = headerFont;

    const ws2 = wb.addWorksheet("派遣明細");
    const ws2Headers = ["日期", "姓名", "員工代號", "區域", "場館", "班別", "上班時間", "下班時間", "時數"];
    const ws2Head = ws2.addRow(ws2Headers);
    ws2Head.eachCell(cell => {
      cell.fill = headerFill; cell.font = headerFont; cell.border = borderStyle;
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });
    ws2.getRow(1).height = 22;
    ws2.columns = [
      { key: "date", width: 14 }, { key: "name", width: 12 }, { key: "code", width: 12 },
      { key: "region", width: 10 }, { key: "venue", width: 14 }, { key: "role", width: 10 },
      { key: "start", width: 10 }, { key: "end", width: 10 }, { key: "hours", width: 8 },
    ];

    const sortedDispatch = [...linkedDispatch].sort((a, b) => a.date.localeCompare(b.date));
    for (const ds of sortedDispatch) {
      const emp = empMap.get(ds.linkedEmployeeId!);
      const venue = ds.venueId ? venueMap.get(ds.venueId) : null;
      const allRegions = await regionService.findAll();
      const regionMap2 = new Map(allRegions.map(r => [r.id, r]));
      const region = emp ? regionMap2.get(emp.regionId) : null;
      const hrs = rawHoursLocal(ds.startTime, ds.endTime);
      const r = ws2.addRow([
        ds.date, emp?.name || ds.dispatchName, emp?.employeeCode || "",
        region?.name || "", venue?.shortName || venue?.name || "",
        ds.role, ds.startTime.substring(0, 5), ds.endTime.substring(0, 5), hrs,
      ]);
      r.eachCell(cell => { cell.border = borderStyle; cell.alignment = { horizontal: "center", vertical: "middle" }; });
      r.getCell(2).alignment = { horizontal: "left", vertical: "middle" };
      ws2.getRow(r.number).height = 18;
    }

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  },

  async _buildWeeklyData(weekStart: string) {
    const weekEnd = (() => {
      const d = new Date(weekStart + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + 6);
      return d.toISOString().split("T")[0];
    })();
    const allShifts = await shiftService.getAllShiftsByDateRange(weekStart, weekEnd);
    const clockRecords = await clockService.getClockRecordsByDateRange(weekStart, weekEnd);
    const allEmployees = await employeeService.getAllEmployees();
    const allVenues = await venueService.findAll();
    return { weekEnd, allShifts, clockRecords, allEmployees, allVenues };
  },

  async weeklyAttendance(weekStart: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || isNaN(new Date(weekStart + "T00:00:00Z").getTime())) {
      throw httpError(400, "weekStart 格式不正確 (YYYY-MM-DD)");
    }
    const { weekEnd, allShifts, clockRecords, allEmployees, allVenues } = await this._buildWeeklyData(weekStart);
    const empMap = new Map(allEmployees.map(e => [e.id, e]));
    const venueMap = new Map(allVenues.map(v => [v.id, v]));

    const employeeIds = new Set(allShifts.map(s => s.employeeId));
    const dates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + i);
      dates.push(d.toISOString().split("T")[0]);
    }
    const clockByEmpDate = new Map<string, typeof clockRecords>();
    for (const cr of clockRecords) {
      const crDate = new Date(cr.clockTime!).toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
      const key = `${cr.employeeId}-${crDate}`;
      if (!clockByEmpDate.has(key)) clockByEmpDate.set(key, []);
      clockByEmpDate.get(key)!.push(cr);
    }

    const result = Array.from(employeeIds).map(empId => {
      const emp = empMap.get(empId);
      if (!emp || emp.status === "inactive") return null;
      const days = dates.map(date => {
        const dayShifts = allShifts.filter(s => s.employeeId === empId && s.date === date);
        const dayClock = clockByEmpDate.get(`${empId}-${date}`) || [];
        const clockIns = dayClock.filter(c => c.clockType === "in");
        const clockOuts = dayClock.filter(c => c.clockType === "out");
        if (dayShifts.length === 0) return { date, status: "no_shift" as const, shifts: [], clockIns: [], clockOuts: [] };
        const isLeave = dayShifts.every(s => LEAVE_TYPES.includes(s.role));
        if (isLeave) return {
          date, status: "leave" as const, leaveType: dayShifts[0].role,
          shifts: dayShifts.map(s => ({ startTime: s.startTime, endTime: s.endTime, role: s.role, venueId: s.venueId, venueName: venueMap.get(s.venueId)?.shortName || "未知" })),
          clockIns: [], clockOuts: [],
        };
        const shiftData = dayShifts.map(s => ({
          startTime: s.startTime, endTime: s.endTime, role: s.role,
          venueId: s.venueId, venueName: venueMap.get(s.venueId)?.shortName || "未知",
        }));
        const clockInData = clockIns.map(c => ({
          time: new Date(c.clockTime!).toLocaleTimeString("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit" }),
          status: c.status, venue: c.matchedVenueName || "", failReason: c.failReason || "",
        }));
        const clockOutData = clockOuts.map(c => ({
          time: new Date(c.clockTime!).toLocaleTimeString("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit" }),
          status: c.status, venue: c.matchedVenueName || "",
        }));
        const hasSuccessClockIn = clockIns.some(c => c.status === "success" || c.status === "warning");
        const hasLateReason = hasAttendanceIssueBeyondGrace(clockIns, "遲到");
        const hasEarlyLeave = hasAttendanceIssueBeyondGrace(clockOuts, "早退");
        let status: "on_time" | "late" | "early_leave" | "missing_clock" | "anomaly" = "on_time";
        if (!hasSuccessClockIn && clockIns.length === 0) status = "missing_clock";
        else if (hasLateReason) status = "late";
        else if (hasEarlyLeave) status = "early_leave";
        else if (clockIns.some(c => c.status === "fail")) status = "anomaly";
        return { date, status, shifts: shiftData, clockIns: clockInData, clockOuts: clockOutData };
      });
      return { id: empId, name: emp.name, employeeCode: emp.employeeCode, lineId: emp.lineId, regionId: emp.regionId, days };
    }).filter(Boolean);

    return { weekStart, weekEnd, dates, employees: result };
  },

  async notifyWeeklyAttendance(weekStart: string) {
    if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || isNaN(new Date(weekStart + "T00:00:00Z").getTime())) {
      throw httpError(400, "缺少或格式不正確的 weekStart (YYYY-MM-DD)");
    }
    const { weekEnd, allShifts, clockRecords, allEmployees, allVenues } = await this._buildWeeklyData(weekStart);
    const empMap = new Map(allEmployees.map(e => [e.id, e]));
    const venueMap = new Map(allVenues.map(v => [v.id, v]));

    const employeeIds = new Set(allShifts.map(s => s.employeeId));
    const dates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + i);
      dates.push(d.toISOString().split("T")[0]);
    }
    const clockByEmpDate = new Map<string, typeof clockRecords>();
    for (const cr of clockRecords) {
      const crDate = new Date(cr.clockTime!).toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
      const key = `${cr.employeeId}-${crDate}`;
      if (!clockByEmpDate.has(key)) clockByEmpDate.set(key, []);
      clockByEmpDate.get(key)!.push(cr);
    }

    const dayNames = ["日", "一", "二", "三", "四", "五", "六"];
    const wsDate = new Date(weekStart + "T00:00:00Z");
    const weDate = new Date(weekEnd + "T00:00:00Z");
    const displayRange = `${wsDate.getUTCMonth() + 1}/${wsDate.getUTCDate()} ~ ${weDate.getUTCMonth() + 1}/${weDate.getUTCDate()}`;

    let lineSent = 0;
    let lineSkipped = 0;
    const summaryRows: string[] = [];

    for (const empId of employeeIds) {
      const emp = empMap.get(empId);
      if (!emp || emp.status === "inactive") continue;
      const dayResults: { date: string; status: string; detail: string }[] = [];
      let hasAnomaly = false;
      for (const date of dates) {
        const dayShifts = allShifts.filter(s => s.employeeId === empId && s.date === date);
        const dayClock = clockByEmpDate.get(`${empId}-${date}`) || [];
        const clockIns = dayClock.filter(c => c.clockType === "in");
        if (dayShifts.length === 0) { dayResults.push({ date, status: "➖", detail: "無班" }); continue; }
        const isLeave = dayShifts.every(s => LEAVE_TYPES.includes(s.role));
        if (isLeave) { dayResults.push({ date, status: "🟡", detail: dayShifts[0].role }); continue; }
        const venue = venueMap.get(dayShifts[0].venueId);
        const vName = venue?.shortName || "未知";
        const shiftTime = `${dayShifts[0].startTime.substring(0, 5)}-${dayShifts[0].endTime.substring(0, 5)}`;
        const hasSuccessIn = clockIns.some(c => c.status === "success" || c.status === "warning");
        if (!hasSuccessIn) {
          dayResults.push({ date, status: "🔴", detail: `${vName} ${shiftTime} 未打卡` });
          hasAnomaly = true;
        } else if (hasAttendanceIssueBeyondGrace(clockIns, "遲到")) {
          dayResults.push({ date, status: "⚠️", detail: `${vName} ${shiftTime} 遲到` });
          hasAnomaly = true;
        } else {
          dayResults.push({ date, status: "✅", detail: `${vName} ${shiftTime}` });
        }
      }
      const summaryLine = dayResults.map(d => d.status).join(" ");
      summaryRows.push(`${emp.name}(${emp.employeeCode}): ${summaryLine}${hasAnomaly ? " ⚠" : ""}`);
      if (emp.lineId) {
        const lines: string[] = [];
        lines.push(`📊 上週打卡狀況報告`); lines.push(`📅 ${displayRange}`); lines.push("");
        for (const dr of dayResults) {
          const dd = new Date(dr.date + "T00:00:00Z");
          const dayLabel = `${dd.getUTCMonth() + 1}/${dd.getUTCDate()}(${dayNames[dd.getUTCDay()]})`;
          lines.push(`${dr.status} ${dayLabel} ${dr.detail}`);
        }
        lines.push("");
        lines.push(hasAnomaly ? "如有上述異常狀況，請盡速向主管回報說明，謝謝 🙏" : "本週出勤正常，辛苦了 👍");
        const ok = await pushToLine(emp.lineId, lines.join("\n").trim());
        if (ok) lineSent++; else lineSkipped++;
      } else {
        lineSkipped++;
      }
    }

    let emailSent = false;
    try {
      const recipients = await notificationService.findAll();
      const targets = recipients.filter(r => r.enabled && r.notifyNewReport);
      if (targets.length > 0) {
        const tableRows = summaryRows.map(row => `<tr><td style="padding: 6px 12px; border: 1px solid #e5e7eb; font-size: 13px; white-space: nowrap;">${row}</td></tr>`).join("");
        const emailHtml = `
          <h2>📊 週報打卡狀況 — ${displayRange}</h2>
          <p>以下為上週所有排班人員的打卡狀況摘要：</p>
          <p style="font-size: 12px; color: #6b7280;">✅準時 ⚠️遲到 🔴未打卡 🟡休假 ➖無班</p>
          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tbody>${tableRows}</tbody>
          </table>
          <p>共 ${employeeIds.size} 位員工，LINE 推播 ${lineSent} 位，跳過 ${lineSkipped} 位。</p>
        `;
        await sendAnomalyEmail(
          targets.map(r => r.email),
          `📊 週報打卡狀況 — ${displayRange}（${employeeIds.size} 位員工）`,
          emailHtml
        );
        emailSent = true;
      }
    } catch (e: any) {
      console.error("[週報] Email 發送失敗:", e);
    }

    return {
      success: true, lineSent, lineSkipped, emailSent,
      totalEmployees: employeeIds.size,
      message: `已發送 LINE 推播 ${lineSent} 位，${emailSent ? "管理員 Email 已發送" : "Email 未發送"}`,
    };
  },

  clearOldMissingClockNotifications: systemRepository.clearOldMissingClockNotifications,
  clearOldWeeklyPushNotifications: systemRepository.clearOldWeeklyPushNotifications,
  createMissingClockNotification: systemRepository.createMissingClockNotification,
  createWeeklyPushNotification: systemRepository.createWeeklyPushNotification,
  findSystemConfig: systemRepository.getSystemConfig,
  getMissingClockNotificationsForDate: systemRepository.getMissingClockNotificationsForDate,
  hasWeeklyPushNotification: systemRepository.hasWeeklyPushNotification,
};
