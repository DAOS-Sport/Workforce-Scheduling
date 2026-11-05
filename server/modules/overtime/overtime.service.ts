/**
 * Overtime-request service — submission, listing, admin review.
 *
 * Owns the cross-table enrichment (employee name/code + linked clock time)
 * so the admin route handler does not have to know about clock_records.
 */
import { employeeService } from "../employee/employee.service";
import { overtimeRepository } from "./overtime.repository";
import { clockService } from "../clock/clock.service";
import { oncePerRequestKey, requestKeyOf } from "../../infra/db/idempotency";
import { withTx } from "../../infra/db/tx";
import { httpError } from "../../shared/http/response";

export interface SubmitOvertimePayload {
  employeeId: number;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
  evidenceImageUrl?: string | null;
  /** The form's id for this submission; sending it again returns the first request instead of filing a second. */
  requestId?: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Same rule as the employee form: HH:MM, and the end later than the start on the same day. */
function checkTimes(date: string, startTime: string, endTime: string): void {
  const day = new Date(`${date}T00:00:00Z`);
  const isCalendarDate = DATE.test(date) && !Number.isNaN(day.getTime()) && day.toISOString().startsWith(date);
  if (!isCalendarDate) throw httpError(400, "日期格式須為 YYYY-MM-DD");
  if (!HHMM.test(startTime) || !HHMM.test(endTime)) throw httpError(400, "時間格式須為 HH:MM");
  if (endTime <= startTime) throw httpError(400, "結束時間必須晚於開始時間");
}

export const overtimeService = {
  async submit(payload: SubmitOvertimePayload) {
    const { employeeId, date, startTime, endTime, reason, evidenceImageUrl } = payload;
    if (!employeeId || !date || !startTime || !endTime || !reason) {
      throw httpError(400, "缺少必要欄位");
    }
    checkTimes(String(date), String(startTime), String(endTime));
    const emp = await employeeService.getEmployee(employeeId);
    if (!emp) {
      throw httpError(404, "找不到員工");
    }
    const requestKey = requestKeyOf(payload.requestId);
    return withTx(async (tx) => {
      const { value } = await oncePerRequestKey(tx, `overtime-request:${employeeId}`, requestKey, () =>
        overtimeRepository.createOvertimeRequest({
          employeeId,
          date,
          startTime,
          endTime,
          reason,
          evidenceImageUrl: evidenceImageUrl || null,
          status: "pending",
          reviewedBy: null,
          reviewedByName: null,
          reviewNote: null,
        }, tx),
      );
      return value;
    });
  },

  byEmployee: (employeeId: number) => overtimeRepository.getOvertimeRequestsByEmployee(employeeId),

  async listForAdmin(status?: string) {
    const records = await overtimeRepository.getOvertimeRequests(status);

    const employeeIds = [...new Set(records.map((r) => r.employeeId))];
    const employeeMap = new Map<number, any>();
    for (const id of employeeIds) {
      const emp = await employeeService.getEmployee(id);
      if (emp) employeeMap.set(id, emp);
    }

    const clockRecordIds = records.filter((r) => r.clockRecordId).map((r) => r.clockRecordId!);
    const clockRecordMap = new Map<number, any>();
    for (const crId of clockRecordIds) {
      const cr = await clockService.getClockRecord(crId);
      if (cr) clockRecordMap.set(crId, cr);
    }

    return records.map((r) => ({
      ...r,
      employeeName: employeeMap.get(r.employeeId)?.name || "未知",
      employeeCode: employeeMap.get(r.employeeId)?.employeeCode || "",
      linkedClockTime:
        r.clockRecordId && clockRecordMap.has(r.clockRecordId)
          ? clockRecordMap.get(r.clockRecordId).clockTime
          : null,
    }));
  },

  async review(id: number, status: string, reviewNote: string | undefined, adminId: number, adminName: string) {
    if (!status || !["approved", "rejected"].includes(status)) {
      throw httpError(400, "status 必須為 approved 或 rejected");
    }
    const reviewed = await overtimeRepository.reviewPendingRequest(id, status, adminId, adminName, reviewNote);
    if (reviewed) return reviewed;
    if (!(await overtimeRepository.getOvertimeRequest(id))) throw httpError(404, "找不到加班申請");
    throw httpError(409, "此申請已審核完畢");
  },

  createOvertimeRequest: overtimeRepository.createOvertimeRequest,
  getApprovedOvertimeByDateRange: overtimeRepository.getApprovedOvertimeByDateRange,
  getOvertimeRequests: overtimeRepository.getOvertimeRequests,
  getOvertimeRequestsByEmployeeAndDate: overtimeRepository.getOvertimeRequestsByEmployeeAndDate,
  countPendingRequests: overtimeRepository.countPendingRequests,
};
