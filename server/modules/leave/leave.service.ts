/**
 * Leave-request service — submission, listing, admin review.
 *
 * Validation rules (required fields, certificate-required leave types) and
 * the per-request enrichment (employee name/code) live here so callers
 * — portal HTTP, admin HTTP, future cron — share one source of truth.
 */
import { storage } from "../../storage";

const CERTIFICATE_REQUIRED = new Set(["病假", "生理假"]);

export interface SubmitLeavePayload {
  employeeId: number;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason?: string | null;
  certificateImageUrl?: string | null;
}

export const leaveService = {
  async submit(payload: SubmitLeavePayload) {
    const { employeeId, leaveType, startDate, endDate, reason, certificateImageUrl } = payload;
    if (!employeeId || !leaveType || !startDate || !endDate) {
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
    if (CERTIFICATE_REQUIRED.has(leaveType) && !certificateImageUrl) {
      const err: any = new Error(`${leaveType}需附上證明文件照片`);
      err.status = 400;
      throw err;
    }
    return storage.createLeaveRequest({
      employeeId,
      leaveType,
      startDate,
      endDate,
      reason: reason || null,
      certificateImageUrl: certificateImageUrl || null,
      status: "pending",
      reviewedBy: null,
      reviewedByName: null,
      reviewNote: null,
    });
  },

  byEmployee: (employeeId: number) => storage.getLeaveRequestsByEmployee(employeeId),

  async listForAdmin(status?: string) {
    const records = await storage.getLeaveRequests(status);
    const employees = await storage.getAllEmployees();
    const empMap = new Map(employees.map((e) => [e.id, e]));
    return records.map((r) => ({
      ...r,
      employeeName: empMap.get(r.employeeId)?.name || "未知",
      employeeCode: empMap.get(r.employeeId)?.employeeCode || "",
    }));
  },

  async review(id: number, status: string, reviewNote: string | undefined, adminId: number, adminName: string) {
    if (!status || !["approved", "rejected"].includes(status)) {
      const err: any = new Error("status 必須為 approved 或 rejected");
      err.status = 400;
      throw err;
    }
    const request = await storage.getLeaveRequest(id);
    if (!request) {
      const err: any = new Error("找不到請假申請");
      err.status = 404;
      throw err;
    }
    if (request.status !== "pending") {
      const err: any = new Error("此申請已審核完畢");
      err.status = 400;
      throw err;
    }
    return storage.updateLeaveRequestStatus(id, status, adminId, adminName, reviewNote);
  },
};
