/**
 * Overtime-request service — submission, listing, admin review.
 *
 * Owns the cross-table enrichment (employee name/code + linked clock time)
 * so the admin route handler does not have to know about clock_records.
 */
import { storage } from "../../storage";

export interface SubmitOvertimePayload {
  employeeId: number;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
  evidenceImageUrl?: string | null;
}

export const overtimeService = {
  async submit(payload: SubmitOvertimePayload) {
    const { employeeId, date, startTime, endTime, reason, evidenceImageUrl } = payload;
    if (!employeeId || !date || !startTime || !endTime || !reason) {
      const err: any = new Error("缺少必要欄位");
      err.status = 400;
      throw err;
    }
    const emp = await storage.getEmployee(employeeId);
    if (!emp) {
      const err: any = new Error("找不到員工");
      err.status = 404;
      throw err;
    }
    return storage.createOvertimeRequest({
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
    });
  },

  byEmployee: (employeeId: number) => storage.getOvertimeRequestsByEmployee(employeeId),

  async listForAdmin(status?: string) {
    const records = await storage.getOvertimeRequests(status);

    const employeeIds = [...new Set(records.map((r) => r.employeeId))];
    const employeeMap = new Map<number, any>();
    for (const id of employeeIds) {
      const emp = await storage.getEmployee(id);
      if (emp) employeeMap.set(id, emp);
    }

    const clockRecordIds = records.filter((r) => r.clockRecordId).map((r) => r.clockRecordId!);
    const clockRecordMap = new Map<number, any>();
    for (const crId of clockRecordIds) {
      const cr = await storage.getClockRecord(crId);
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
      const err: any = new Error("status 必須為 approved 或 rejected");
      err.status = 400;
      throw err;
    }
    const request = await storage.getOvertimeRequest(id);
    if (!request) {
      const err: any = new Error("找不到加班申請");
      err.status = 404;
      throw err;
    }
    if (request.status !== "pending") {
      const err: any = new Error("此申請已審核完畢");
      err.status = 400;
      throw err;
    }
    return storage.updateOvertimeRequestStatus(id, status, adminId, adminName, reviewNote);
  },
};
