/**
 * Leave-request service — submission, listing, admin review, and balance management.
 *
 * 特休 / 特別休假 / annual_leave deduct from the employee's annual leave balance.
 * Other leave types have no balance effect.
 */
import { storage } from "../../storage";

const CERTIFICATE_REQUIRED = new Set(["病假", "生理假"]);
export const ANNUAL_LEAVE_TYPES = new Set(["特休", "特別休假", "annual_leave"]);

function getTaipeiYear(): number {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" })).getFullYear();
}

export function calcLeaveHours(
  startDate: string,
  endDate: string,
  startTime?: string | null,
  endTime?: string | null,
): number {
  if (startTime && endTime && startDate === endDate) {
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    const h = Math.max(0, (eh * 60 + em - (sh * 60 + sm)) / 60);
    return Math.round(h * 100) / 100;
  }
  const days = Math.max(1, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1);
  return days * 8;
}

export interface SubmitLeavePayload {
  employeeId: number;
  leaveType: string;
  startDate: string;
  endDate: string;
  startTime?: string | null;
  endTime?: string | null;
  hours?: number | null;
  reason?: string | null;
  certificateImageUrl?: string | null;
}

export const leaveService = {
  async submit(payload: SubmitLeavePayload) {
    const { employeeId, leaveType, startDate, endDate, startTime, endTime, reason, certificateImageUrl } = payload;
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

    const hours = calcLeaveHours(startDate, endDate, startTime, endTime);
    const year = new Date(startDate).getFullYear();

    if (ANNUAL_LEAVE_TYPES.has(leaveType)) {
      const balance = await storage.getLeaveBalance(employeeId, year);
      const total = balance?.totalHours ?? 0;
      const used = balance?.usedHours ?? 0;
      const pending = balance?.pendingHours ?? 0;
      const remaining = Math.max(0, total - used - pending);
      if (hours > remaining) {
        const err: any = new Error(`特休餘額不足（剩餘 ${remaining} 小時，申請 ${hours} 小時）`);
        err.status = 400;
        throw err;
      }
    }

    const request = await storage.createLeaveRequest({
      employeeId,
      leaveType,
      startDate,
      endDate,
      startTime: startTime || null,
      endTime: endTime || null,
      hours,
      reason: reason || null,
      certificateImageUrl: certificateImageUrl || null,
      status: "pending",
      reviewedBy: null,
      reviewedByName: null,
      reviewNote: null,
    });

    if (ANNUAL_LEAVE_TYPES.has(leaveType)) {
      await storage.adjustLeaveBalancePending(employeeId, year, hours);
      await storage.appendLeaveBalanceLog(employeeId, year, 0, `申請特休 ${hours}h（待審）`, request.id);
    }

    return request;
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

    const result = await storage.updateLeaveRequestStatus(id, status, adminId, adminName, reviewNote);

    if (ANNUAL_LEAVE_TYPES.has(request.leaveType)) {
      const hours = request.hours ?? calcLeaveHours(request.startDate, request.endDate, request.startTime, request.endTime);
      const year = new Date(request.startDate).getFullYear();
      if (status === "approved") {
        await storage.adjustLeaveBalanceOnApprove(request.employeeId, year, hours);
        await storage.appendLeaveBalanceLog(request.employeeId, year, -hours, `特休核准 ${hours}h`, id, adminId, adminName);
      } else {
        await storage.adjustLeaveBalanceOnReject(request.employeeId, year, hours);
        await storage.appendLeaveBalanceLog(request.employeeId, year, 0, `特休申請拒絕，還原 ${hours}h`, id, adminId, adminName);
      }
    }

    return result;
  },

  async getEmployeeSummary(employeeId: number) {
    const year = getTaipeiYear();
    const balance = await storage.getLeaveBalance(employeeId, year);
    const total = balance?.totalHours ?? 0;
    const used = balance?.usedHours ?? 0;
    const pending = balance?.pendingHours ?? 0;
    return {
      year,
      totalHours: total,
      usedHours: used,
      pendingHours: pending,
      remainingHours: Math.max(0, total - used - pending),
    };
  },

  async getBalanceOverview(year: number) {
    return storage.getAllLeaveBalances(year);
  },

  async adjustBalance(employeeId: number, year: number, totalHours: number, adminId: number, adminName: string) {
    const emp = await storage.getEmployee(employeeId);
    if (!emp) {
      const err: any = new Error("找不到員工");
      err.status = 404;
      throw err;
    }
    if (totalHours < 0) {
      const err: any = new Error("總時數不可為負數");
      err.status = 400;
      throw err;
    }
    const balance = await storage.upsertLeaveBalance(employeeId, year, totalHours);
    await storage.appendLeaveBalanceLog(
      employeeId, year, totalHours,
      `管理員設定年度特休總時數為 ${totalHours}h`,
      undefined, adminId, adminName,
    );
    return balance;
  },
};
