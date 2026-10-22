import { httpError } from "../../shared/http/response";
import { clockRepository } from "./clock.repository";
import { employeeService } from "../employee/employee.service";
import { venueService } from "../venue/venue.service";
import { shiftService } from "../shift/shift.service";
import { dispatchService } from "../dispatch/dispatch.service";
import { overtimeService } from "../overtime/overtime.service";

const LEAVE_ROLES = ["休假", "特休", "病假", "事假", "公假", "喪假", "育嬰", "留職停薪"];

/**
 * 判斷 shifts 表的班次是否需要打卡：教練、暑假課程、手動課程不用，其他都要。
 * 派遣班存在 dispatch_shifts，不經過這裡；全月異常報表不讀派遣班，只有個人月出勤會列出來。
 */
function isAttendanceRequired(shift: { role?: string | null; notes?: string | null }): boolean {
  const role = String(shift.role || "").trim();
  const notes = String(shift.notes || "").trim();
  if (role === "教練") return false;
  if (role.toLowerCase().includes("coach")) return false;
  if (notes.includes("暑假課程") || notes.includes("手動課程")) return false;
  return true;
}

const toTaiwanDate = (iso: string | Date | null): string => {
  if (!iso) return "unknown";
  const d = new Date(typeof iso === "string" ? iso : iso.toISOString());
  const tw = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  return `${tw.getFullYear()}-${String(tw.getMonth() + 1).padStart(2, "0")}-${String(tw.getDate()).padStart(2, "0")}`;
};
const toTaiwanHHMM = (iso: string | Date | null): string | null => {
  if (!iso) return null;
  const d = new Date(typeof iso === "string" ? iso : iso.toISOString());
  const tw = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  return `${String(tw.getHours()).padStart(2, "0")}:${String(tw.getMinutes()).padStart(2, "0")}`;
};

export const clockService = {
  async listRecords(opts: { startDate?: string; endDate?: string; employeeId?: number }) {
    const { startDate, endDate, employeeId } = opts;
    if (!startDate || !endDate) throw httpError(400, "startDate and endDate required");
    const records = employeeId
      ? await clockRepository.getClockRecordsByEmployee(Number(employeeId), startDate, endDate)
      : await clockRepository.getClockRecordsByDateRange(startDate, endDate);

    const employeeIds = [...new Set(records.map((r) => r.employeeId))];
    const employeeMap = new Map<number, any>();
    for (const id of employeeIds) {
      const emp = await employeeService.getEmployee(id);
      if (emp) employeeMap.set(id, emp);
    }
    return records.map((r) => ({
      ...r,
      employeeName: employeeMap.get(r.employeeId)?.name || "未知",
      employeeCode: employeeMap.get(r.employeeId)?.employeeCode || "",
    }));
  },

  async listClockReports(opts: {
    startDate?: string; endDate?: string; employeeName?: string; employeeCode?: string;
    status?: string; clockType?: string; venueId?: string;
  }) {
    const { startDate, endDate, employeeName, employeeCode, status, clockType, venueId } = opts;
    if (!startDate || !endDate) throw httpError(400, "請提供 startDate 和 endDate");
    if (String(startDate) > String(endDate)) throw httpError(400, "startDate 不可晚於 endDate");

    const [allRecords, allEmployees, allVenues] = await Promise.all([
      clockRepository.getClockRecordsByDateRange(String(startDate), String(endDate)),
      employeeService.getAllEmployees(),
      venueService.findAll(),
    ]);
    const employeeMap = new Map<number, { name: string; employeeCode: string }>();
    for (const emp of allEmployees) employeeMap.set(emp.id, { name: emp.name, employeeCode: emp.employeeCode });
    const venueMap = new Map<number, string>();
    for (const v of allVenues) venueMap.set(v.id, v.name);

    let enriched = allRecords.map((r) => ({
      ...r,
      employeeName: employeeMap.get(r.employeeId)?.name || "未知",
      employeeCode: employeeMap.get(r.employeeId)?.employeeCode || "",
      venueName: r.venueId ? (venueMap.get(r.venueId) || r.matchedVenueName || "") : (r.matchedVenueName || ""),
    }));
    if (status && String(status) !== "") enriched = enriched.filter((r) => r.status === String(status));
    if (clockType && String(clockType) !== "") enriched = enriched.filter((r) => r.clockType === String(clockType));
    if (venueId && String(venueId) !== "") {
      const vid = Number(venueId);
      enriched = enriched.filter((r) => r.venueId === vid);
    }
    if (employeeCode && String(employeeCode).trim() !== "") {
      const codeQ = String(employeeCode).trim().toLowerCase();
      enriched = enriched.filter((r) => r.employeeCode.toLowerCase().includes(codeQ));
    }
    if (employeeName && String(employeeName).trim() !== "") {
      const nameQ = String(employeeName).trim().toLowerCase();
      enriched = enriched.filter((r) => r.employeeName.toLowerCase().includes(nameQ));
    }
    return enriched;
  },

  async listAnomaliesReport(yearMonth: string) {
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) throw httpError(400, "yearMonth 格式應為 YYYY-MM");
    const [yr, mo] = yearMonth.split("-").map(Number);
    const monthStart = `${yearMonth}-01`;
    const lastDay = new Date(yr, mo, 0).getDate();
    const monthEnd = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;

    const [allShifts, clockRecords, allAmendments, allEmployees, allVenues] = await Promise.all([
      shiftService.getAllShiftsByDateRange(monthStart, monthEnd),
      clockRepository.getClockRecordsByDateRange(monthStart, monthEnd),
      clockRepository.getClockAmendments(),
      employeeService.getAllEmployees(),
      venueService.findAll(),
    ]);
    const workShifts = allShifts.filter(s => !LEAVE_ROLES.includes(s.role) && isAttendanceRequired(s));
    const employeeMap = new Map(allEmployees.map(e => [e.id, e]));
    const venueMap = new Map(allVenues.map(v => [v.id, v]));

    const parseLateMinutes = (failReason: string | null, prefix: string): number | null => {
      if (!failReason) return null;
      const reHM = new RegExp(`^${prefix}\\s*(\\d+)\\s*小時\\s*(\\d+)\\s*分鐘`);
      const reH = new RegExp(`^${prefix}\\s*(\\d+)\\s*小時`);
      const reM = new RegExp(`^${prefix}\\s*(\\d+)\\s*分鐘`);
      let m = failReason.match(reHM);
      if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
      m = failReason.match(reH);
      if (m) return parseInt(m[1]) * 60;
      m = failReason.match(reM);
      if (m) return parseInt(m[1]);
      return null;
    };

    const clockMap = new Map<string, typeof clockRecords>();
    for (const cr of clockRecords) {
      const date = toTaiwanDate(cr.clockTime);
      const key = `${cr.employeeId}:${date}:${cr.clockType}`;
      if (!clockMap.has(key)) clockMap.set(key, []);
      clockMap.get(key)!.push(cr);
    }
    const amendmentMap = new Map<string, typeof allAmendments>();
    for (const a of allAmendments) {
      const date = toTaiwanDate(a.requestedTime);
      const key = `${a.employeeId}:${date}:${a.clockType}`;
      if (!amendmentMap.has(key)) amendmentMap.set(key, []);
      amendmentMap.get(key)!.push(a);
    }
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const getBestAmendment = (list: typeof allAmendments) =>
      list.find(a => a.status === "approved")
      || list.find(a => a.status === "pending")
      || list.find(a => a.status === "rejected")
      || null;

    const anomalies: any[] = [];
    for (const shift of workShifts) {
      const employee = employeeMap.get(shift.employeeId);
      if (!employee || employee.status !== "active") continue;
      const venue = venueMap.get(shift.venueId);
      const shiftDate = String(shift.date);
      const baseInfo = {
        employeeId: shift.employeeId, employeeName: employee.name, employeeCode: employee.employeeCode,
        date: shiftDate, shiftStart: shift.startTime, shiftEnd: shift.endTime,
        venueName: venue?.shortName || "",
      };

      const inRecords = (clockMap.get(`${shift.employeeId}:${shiftDate}:in`) || []).filter(r => r.status === "success" || r.status === "warning");
      const outRecords = (clockMap.get(`${shift.employeeId}:${shiftDate}:out`) || []).filter(r => r.status === "success" || r.status === "warning");
      const inAmendments = amendmentMap.get(`${shift.employeeId}:${shiftDate}:in`) || [];
      const outAmendments = amendmentMap.get(`${shift.employeeId}:${shiftDate}:out`) || [];
      const bestIn = getBestAmendment(inAmendments);
      const bestOut = getBestAmendment(outAmendments);

      if (inRecords.length === 0) {
        anomalies.push({
          ...baseInfo, anomalyType: "缺打卡上班", anomalyMinutes: null, clockTime: null,
          amendmentStatus: bestIn?.status || null,
          amendmentTime: bestIn ? toTaiwanHHMM(bestIn.requestedTime) : null,
          isResolved: bestIn?.status === "approved",
        });
      } else {
        const earliest = inRecords.sort((a, b) => new Date(a.clockTime ?? 0).getTime() - new Date(b.clockTime ?? 0).getTime())[0];
        const lateMin = parseLateMinutes(earliest.failReason, "遲到");
        const effectiveIn: any = (earliest as any).amendedTime ?? earliest.clockTime;
        const linkedAmend = (earliest as any).amendmentId
          ? allAmendments.find(a => a.id === (earliest as any).amendmentId) || null
          : null;
        if (lateMin !== null && lateMin > 0) {
          anomalies.push({
            ...baseInfo, anomalyType: "遲到", anomalyMinutes: lateMin,
            clockTime: toTaiwanHHMM(effectiveIn),
            amendmentStatus: linkedAmend?.status || bestIn?.status || null,
            amendmentTime: (earliest as any).amendedTime
              ? toTaiwanHHMM((earliest as any).amendedTime)
              : (bestIn ? toTaiwanHHMM(bestIn.requestedTime) : null),
            isResolved: !!(earliest as any).amendedTime || bestIn?.status === "approved",
          });
        }
      }

      if (shiftDate < todayStr) {
        if (outRecords.length === 0) {
          anomalies.push({
            ...baseInfo, anomalyType: "缺打卡下班", anomalyMinutes: null, clockTime: null,
            amendmentStatus: bestOut?.status || null,
            amendmentTime: bestOut ? toTaiwanHHMM(bestOut.requestedTime) : null,
            isResolved: bestOut?.status === "approved",
          });
        } else {
          const latest = outRecords.sort((a, b) => new Date(b.clockTime ?? 0).getTime() - new Date(a.clockTime ?? 0).getTime())[0];
          const earlyMin = parseLateMinutes(latest.failReason, "早退");
          const effectiveOut: any = (latest as any).amendedTime ?? latest.clockTime;
          const linkedAmendOut = (latest as any).amendmentId
            ? allAmendments.find(a => a.id === (latest as any).amendmentId) || null
            : null;
          if (earlyMin !== null && earlyMin > 0) {
            anomalies.push({
              ...baseInfo, anomalyType: "早退", anomalyMinutes: earlyMin,
              clockTime: toTaiwanHHMM(effectiveOut),
              amendmentStatus: linkedAmendOut?.status || bestOut?.status || null,
              amendmentTime: (latest as any).amendedTime
                ? toTaiwanHHMM((latest as any).amendedTime)
                : (bestOut ? toTaiwanHHMM(bestOut.requestedTime) : null),
              isResolved: !!(latest as any).amendedTime || bestOut?.status === "approved",
            });
          }
        }
      }
    }
    anomalies.sort((a, b) => a.date.localeCompare(b.date) || a.employeeCode.localeCompare(b.employeeCode));
    return anomalies;
  },

  async createAmendment(payload: any) {
    const { employeeId, clockType, requestedTime, reason, venueId, shiftId, isSystemIssue, evidenceImageUrl, originalClockRecordId } = payload || {};
    if (!employeeId || !clockType || !requestedTime || !reason) throw httpError(400, "缺少必要欄位");
    const emp = await employeeService.getEmployee(employeeId);
    if (!emp) throw httpError(404, "找不到員工");

    if (!isSystemIssue) {
      const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const monthStart = new Date(`${yearMonth}-01T00:00:00+08:00`);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const monthEnd = new Date(`${yearMonth}-${String(lastDay).padStart(2, "0")}T23:59:59+08:00`);
      const allAmendments = await clockRepository.getClockAmendmentsByEmployee(employeeId);
      const monthlyCount = allAmendments.filter(a => {
        const created = a.createdAt ? new Date(a.createdAt) : null;
        return created && created >= monthStart && created <= monthEnd
          && a.status !== "rejected" && !a.isSystemIssue;
      }).length;
      if (monthlyCount >= 3) throw httpError(400, "本月補打卡申請已達上限（3次），如有特殊情況請標記「系統問題」或聯繫主管。");
    }

    const toTaipeiDate = (d: Date) => {
      const tw = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
      return `${tw.getFullYear()}-${String(tw.getMonth() + 1).padStart(2, "0")}-${String(tw.getDate()).padStart(2, "0")}`;
    };
    const allAmendmentsForDupe = await clockRepository.getClockAmendmentsByEmployee(employeeId);
    const requestedDate = toTaipeiDate(new Date(requestedTime));
    const hasDuplicate = allAmendmentsForDupe.some(a => {
      if (a.status === "rejected") return false;
      if (originalClockRecordId && a.originalClockRecordId === originalClockRecordId) return true;
      if (!originalClockRecordId && !a.originalClockRecordId) {
        const aDate = toTaipeiDate(a.requestedTime instanceof Date ? a.requestedTime : new Date(a.requestedTime as string));
        return aDate === requestedDate && a.clockType === clockType;
      }
      return false;
    });
    if (hasDuplicate) throw httpError(400, "該日期同類型已有待審核或已批准的補卡申請，無法重複送出。");

    return await clockRepository.createClockAmendment({
      employeeId, clockType, requestedTime: new Date(requestedTime), reason,
      isSystemIssue: !!isSystemIssue, evidenceImageUrl: evidenceImageUrl || null,
      venueId: venueId || null, shiftId: shiftId || null, status: "pending",
      reviewedBy: null, reviewNote: null,
      originalClockRecordId: originalClockRecordId || null,
    });
  },

  async listAmendmentsByEmployee(employeeId: number) {
    return await clockRepository.getClockAmendmentsByEmployee(employeeId);
  },

  async listEligibleDates(employeeId: number, yearMonth: string) {
    if (!employeeId || !/^\d{4}-\d{2}$/.test(yearMonth)) throw httpError(400, "參數格式錯誤");
    const [yr, mo] = yearMonth.split("-").map(Number);
    const monthStart = `${yearMonth}-01`;
    const lastDay = new Date(yr, mo, 0).getDate();
    const monthEnd = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;
    const monthStartExt = monthStart;
    const monthEndExt = monthEnd;

    const [empShifts, empDispatchShifts, empClockRecords, allAmendments, allVenues] = await Promise.all([
      shiftService.getShiftsByEmployeeAndDateRange(employeeId, monthStart, monthEnd),
      dispatchService.getDispatchShiftsByLinkedEmployee(employeeId, monthStartExt, monthEndExt),
      clockRepository.getClockRecordsByEmployee(employeeId, monthStart, monthEnd),
      clockRepository.getClockAmendmentsByEmployee(employeeId),
      venueService.findAll(),
    ]);

    const workShifts = empShifts.filter(s => !LEAVE_ROLES.includes(s.role) && isAttendanceRequired(s));
    const venueMap = new Map(allVenues.map(v => [v.id, v]));

    const clockMap = new Map<string, typeof empClockRecords>();
    for (const cr of empClockRecords) {
      const date = toTaiwanDate(cr.clockTime);
      const key = `${date}:${cr.clockType}`;
      if (!clockMap.has(key)) clockMap.set(key, []);
      clockMap.get(key)!.push(cr);
    }
    const amendmentMap = new Map<string, typeof allAmendments>();
    for (const a of allAmendments) {
      const date = toTaiwanDate(a.requestedTime);
      const key = `${date}:${a.clockType}`;
      if (!amendmentMap.has(key)) amendmentMap.set(key, []);
      amendmentMap.get(key)!.push(a);
    }
    const amendmentByOriginal = new Map<number, typeof allAmendments[0]>();
    for (const a of allAmendments) {
      if (a.originalClockRecordId && (a.status === "pending" || a.status === "approved")) {
        const prev = amendmentByOriginal.get(a.originalClockRecordId);
        if (!prev || a.status === "approved") amendmentByOriginal.set(a.originalClockRecordId, a);
      }
    }

    const parseLateMin = (failReason: string | null, prefix: string): number | null => {
      if (!failReason) return null;
      const reHM = new RegExp(`${prefix}\\s*(\\d+)\\s*小時\\s*(\\d+)\\s*分鐘`);
      const reH = new RegExp(`${prefix}\\s*(\\d+)\\s*小時`);
      const reM = new RegExp(`${prefix}\\s*(\\d+)\\s*分鐘`);
      let m = failReason.match(reHM);
      if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
      m = failReason.match(reH);
      if (m) return parseInt(m[1]) * 60;
      m = failReason.match(reM);
      if (m) return parseInt(m[1]);
      return null;
    };

    type ShiftLike = { id: number; date: string; startTime: string; endTime: string; venueId: number | null; isDispatch: boolean };
    const allShifts: ShiftLike[] = [
      ...workShifts.map(s => ({ id: s.id, date: String(s.date), startTime: s.startTime, endTime: s.endTime, venueId: s.venueId, isDispatch: false })),
      ...empDispatchShifts.map(s => ({ id: s.id, date: String(s.date), startTime: s.startTime, endTime: s.endTime, venueId: null as number | null, isDispatch: true })),
    ];

    type Eligible = {
      date: string; missingClockType: "in" | "out"; shiftStartTime: string; shiftEndTime: string;
      venueName: string; shiftId: number; isDispatch: boolean;
      anomalyType: "missing" | "late" | "early" | "warning" | "early_arrival" | "late_departure";
      originalClockRecordId: number | null; originalClockTime: string | null; anomalyMinutes: number | null;
      hasExistingAmendment: boolean; amendmentStatus: string | null; isResolved: boolean;
    };
    const eligible: Eligible[] = [];

    const classify = (shift: ShiftLike, direction: "in" | "out", records: typeof empClockRecords): Eligible | null => {
      const venue = shift.venueId ? venueMap.get(shift.venueId) : null;
      const venueName = shift.isDispatch ? "派遣" : (venue?.shortName || "");
      const validRecs = records.filter(r => r.status === "success" || r.status === "warning");
      const sortedRecs = [...validRecs].sort((a, b) =>
        new Date(a.clockTime ?? 0).getTime() - new Date(b.clockTime ?? 0).getTime()
      );
      const pick = direction === "in" ? sortedRecs[0] : sortedRecs[sortedRecs.length - 1];
      const base = {
        date: shift.date, missingClockType: direction,
        shiftStartTime: shift.startTime, shiftEndTime: shift.endTime,
        venueName, shiftId: shift.id, isDispatch: shift.isDispatch,
      };
      if (!pick) {
        const best = (amendmentMap.get(`${shift.date}:${direction}`) || [])
          .filter(a => !a.originalClockRecordId)
          .sort((a, b) => (a.status === "approved" ? -1 : b.status === "approved" ? 1 : 0))[0];
        return {
          ...base, anomalyType: "missing", originalClockRecordId: null, originalClockTime: null,
          anomalyMinutes: null, hasExistingAmendment: !!best,
          amendmentStatus: best?.status || null, isResolved: best?.status === "approved",
        };
      }
      const linkedAmend = amendmentByOriginal.get(pick.id);
      const isResolved = linkedAmend?.status === "approved";
      const baseWithLink = {
        originalClockRecordId: pick.id,
        originalClockTime: pick.clockTime ? new Date(pick.clockTime).toISOString() : null,
        hasExistingAmendment: !!linkedAmend,
        amendmentStatus: linkedAmend?.status || null,
        isResolved,
      };
      if (pick.status === "warning") return { ...base, ...baseWithLink, anomalyType: "warning", anomalyMinutes: null };
      if (direction === "in") {
        const lateMin = parseLateMin(pick.failReason, "遲到");
        const earlyArr = parseLateMin(pick.failReason, "提早");
        if (lateMin && lateMin > 0) return { ...base, ...baseWithLink, anomalyType: "late", anomalyMinutes: lateMin };
        if (earlyArr && earlyArr > 0) return { ...base, ...baseWithLink, anomalyType: "early_arrival", anomalyMinutes: earlyArr };
      } else {
        const earlyMin = parseLateMin(pick.failReason, "早退");
        const lateDep = parseLateMin(pick.failReason, "晚下班");
        if (earlyMin && earlyMin > 0) return { ...base, ...baseWithLink, anomalyType: "early", anomalyMinutes: earlyMin };
        if (lateDep && lateDep > 0) return { ...base, ...baseWithLink, anomalyType: "late_departure", anomalyMinutes: lateDep };
      }
      return null;
    };

    const shiftDates = new Set(allShifts.map(s => s.date));
    for (const shift of allShifts) {
      const inRecs = clockMap.get(`${shift.date}:in`) || [];
      const outRecs = clockMap.get(`${shift.date}:out`) || [];
      const inE = classify(shift, "in", inRecs);
      if (inE) eligible.push(inE);
      const outE = classify(shift, "out", outRecs);
      if (outE) eligible.push(outE);
    }

    for (const cr of empClockRecords) {
      const date = toTaiwanDate(cr.clockTime);
      if (shiftDates.has(date)) continue;
      if (cr.status !== "warning" && cr.status !== "success") continue;
      const linkedAmend = amendmentByOriginal.get(cr.id);
      const tw = new Date(new Date(cr.clockTime!).toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
      const hh = `${String(tw.getHours()).padStart(2, "0")}:${String(tw.getMinutes()).padStart(2, "0")}`;
      eligible.push({
        date, missingClockType: cr.clockType as "in" | "out",
        shiftStartTime: hh, shiftEndTime: hh,
        venueName: cr.matchedVenueName || "—", shiftId: 0, isDispatch: false,
        anomalyType: "warning", originalClockRecordId: cr.id,
        originalClockTime: cr.clockTime ? new Date(cr.clockTime).toISOString() : null,
        anomalyMinutes: null, hasExistingAmendment: !!linkedAmend,
        amendmentStatus: linkedAmend?.status || null,
        isResolved: linkedAmend?.status === "approved",
      });
    }

    eligible.sort((a, b) => a.date.localeCompare(b.date) || a.missingClockType.localeCompare(b.missingClockType));
    return eligible;
  },

  async listAmendments(status: string | undefined) {
    const records = await clockRepository.getClockAmendments(status);
    const employeeIds = [...new Set(records.map(r => r.employeeId))];
    const employeeMap = new Map<number, any>();
    for (const id of employeeIds) {
      const emp = await employeeService.getEmployee(id);
      if (emp) employeeMap.set(id, emp);
    }
    return records.map(r => ({
      ...r,
      employeeName: employeeMap.get(r.employeeId)?.name || "未知",
      employeeCode: employeeMap.get(r.employeeId)?.employeeCode || "",
    }));
  },

  async approveAmendment(id: number, status: string, reviewNote: string | undefined, adminId: number, adminName: string) {
    if (!status || !["approved", "rejected"].includes(status)) {
      throw httpError(400, "status 必須為 approved 或 rejected");
    }
    const amendment = await clockRepository.getClockAmendment(id);
    if (!amendment) throw httpError(404, "找不到補打卡申請");
    if (amendment.status !== "pending") throw httpError(400, "此申請已審核完畢");

    const updated = await clockRepository.updateClockAmendmentStatus(id, status, adminId, adminName, reviewNote);
    if (status === "approved" && updated) {
      try {
        if (updated.originalClockRecordId) {
          const original = await clockRepository.getClockRecord(updated.originalClockRecordId);
          if (!original) throw new Error("找不到原始打卡紀錄");
          const amendedTime = updated.requestedTime instanceof Date
            ? updated.requestedTime
            : new Date(updated.requestedTime as any);
          let newFailReason: string | null = "已補正";
          try {
            if (original.shiftId) {
              const shift = await shiftService.getShift(original.shiftId);
              if (shift) {
                const tw = new Date(amendedTime.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
                const minutes = tw.getHours() * 60 + tw.getMinutes();
                const [sh, sm] = shift.startTime.split(":").map(Number);
                const [eh, em] = shift.endTime.split(":").map(Number);
                const startMin = sh * 60 + sm;
                const endMin = eh * 60 + em;
                if (updated.clockType === "in") {
                  if (minutes > startMin) {
                    const diff = minutes - startMin;
                    newFailReason = diff >= 60 ? `遲到 ${Math.floor(diff/60)} 小時 ${diff%60} 分鐘（補正）` : `遲到 ${diff} 分鐘（補正）`;
                  } else {
                    newFailReason = "已補正";
                  }
                } else {
                  if (minutes < endMin) {
                    const diff = endMin - minutes;
                    newFailReason = diff >= 60 ? `早退 ${Math.floor(diff/60)} 小時 ${diff%60} 分鐘（補正）` : `早退 ${diff} 分鐘（補正）`;
                  } else {
                    newFailReason = "已補正";
                  }
                }
              }
            }
          } catch {}
          await clockRepository.applyClockRecordAmendment(updated.originalClockRecordId, amendedTime, updated.id, newFailReason);
        } else {
          await clockRepository.createClockRecord({
            employeeId: updated.employeeId, venueId: updated.venueId, shiftId: updated.shiftId,
            clockType: updated.clockType, latitude: 0, longitude: 0, distance: 0,
            status: "success", failReason: "補打卡", matchedVenueName: null,
            clockTime: updated.requestedTime,
            // 標記此筆為補打卡產生 → 出勤紀錄才能顯示「補打卡通過」。
            amendmentId: updated.id,
          });
        }
      } catch (recordErr: any) {
        await clockRepository.updateClockAmendmentStatus(id, "pending", 0, "系統", "系統錯誤：打卡紀錄建立失敗，請重新審核");
        throw httpError(500, "打卡紀錄建立失敗: " + recordErr.message);
      }
    }
    return updated;
  },

  async updateRecordReason(id: number, earlyArrivalReason: string | undefined, lateDepartureReason: string | undefined) {
    if (!earlyArrivalReason && !lateDepartureReason) throw httpError(400, "請提供原因");
    const updated = await clockRepository.updateClockRecordReason(id, earlyArrivalReason, lateDepartureReason);
    if (!updated) throw httpError(404, "找不到打卡紀錄");

    let overtimeRequest = null;
    if (lateDepartureReason === "加班") {
      const clockRecord = await clockRepository.getClockRecord(id);
      if (clockRecord && clockRecord.shiftId && clockRecord.clockTime) {
        const twCheckDate = new Date(clockRecord.clockTime.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
        const twCheckDateStr = `${twCheckDate.getFullYear()}-${String(twCheckDate.getMonth() + 1).padStart(2, "0")}-${String(twCheckDate.getDate()).padStart(2, "0")}`;
        const existingOT = await overtimeService.getOvertimeRequestsByEmployeeAndDate(clockRecord.employeeId, twCheckDateStr);
        const alreadyHasClockTriggered = existingOT.some(
          ot => ot.source === "clock_triggered" && ot.clockRecordId === clockRecord.id
        );
        if (!alreadyHasClockTriggered) {
          const twDate = new Date(clockRecord.clockTime.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
          const twDateStr = `${twDate.getFullYear()}-${String(twDate.getMonth() + 1).padStart(2, "0")}-${String(twDate.getDate()).padStart(2, "0")}`;
          const allShifts = await shiftService.getAllShiftsByDateRange(twDateStr, twDateStr);
          const shift = allShifts.find(s => s.id === clockRecord.shiftId);
          if (shift) {
            const clockHH = String(twDate.getHours()).padStart(2, "0");
            const clockMM = String(twDate.getMinutes()).padStart(2, "0");
            const actualClockOut = `${clockHH}:${clockMM}`;
            const [seH, seM] = shift.endTime.split(":").map(Number);
            const shiftEndMins = seH * 60 + seM;
            const clockOutMins = parseInt(clockHH) * 60 + parseInt(clockMM);
            if (clockOutMins > shiftEndMins) {
              overtimeRequest = await overtimeService.createOvertimeRequest({
                employeeId: clockRecord.employeeId, date: shift.date,
                startTime: shift.endTime, endTime: actualClockOut,
                reason: "加班（打卡自動產生）", status: "pending",
                source: "clock_triggered", clockRecordId: clockRecord.id,
                reviewedBy: null, reviewedByName: null, reviewNote: null,
              });
            }
          }
        }
      }
    }
    return { ...updated, overtimeRequest };
  },

  createClockRecord: clockRepository.createClockRecord,
  getClockAmendments: clockRepository.getClockAmendments,
  getClockRecord: clockRepository.getClockRecord,
  getClockRecordsByDateRange: clockRepository.getClockRecordsByDateRange,
  getClockRecordsByEmployee: clockRepository.getClockRecordsByEmployee,
  countPendingAmendments: clockRepository.countPendingAmendments,
};
