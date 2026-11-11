/**
 * Leave-request service — submission, listing, admin review, and balance management.
 *
 * 特休 / 特別休假 / annual_leave deduct from the employee's annual leave balance.
 * Other leave types have no balance effect.
 */
import { employeeService } from "../employee/employee.service";
import { LOCK_NS, lockXact, withTx } from "../../infra/db/tx";
import { httpError } from "../../shared/http/response";
import { leaveRepository } from "./leave.repository";
import { z } from "zod";
import { currentAuditActor } from "../../shared/audit/actor";
import { prepareAudit, recordOperation, withAuditFailureSignal } from "../../shared/audit/recorder";

const CERTIFICATE_REQUIRED = new Set(["病假", "生理假"]);
export const ANNUAL_LEAVE_TYPES = new Set(["特休", "特別休假", "annual_leave"]);
const adjustmentSchema = z.object({
  leaveType: z.string().min(1).optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  reason: z.string().nullable().optional(),
  certificateImageUrl: z.string().nullable().optional(),
});

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
      throw httpError(400, "缺少必要欄位");
    }
    const emp = await employeeService.getEmployee(employeeId);
    if (!emp) {
      throw httpError(404, "找不到員工");
    }
    if (CERTIFICATE_REQUIRED.has(leaveType) && !certificateImageUrl) {
      throw httpError(400, `${leaveType}需附上證明文件照片`);
    }

    const hours = calcLeaveHours(startDate, endDate, startTime, endTime);
    const year = new Date(startDate).getFullYear();
    const annual = ANNUAL_LEAVE_TYPES.has(leaveType);

    // The balance check and the three writes stand or fall together, and the check reads under the employee's balance lock.
    return withTx(async (tx) => {
      if (annual) {
        await lockXact(tx, LOCK_NS.leaveBalance, employeeId);
        const balance = await leaveRepository.getLeaveBalance(employeeId, year, tx);
        const remaining = (balance?.totalHours ?? 0) - (balance?.usedHours ?? 0) - (balance?.pendingHours ?? 0);
        if (hours > remaining) throw httpError(400, `特休餘額不足（剩餘 ${Math.max(0, remaining)} 小時，申請 ${hours} 小時）`);
      }

      const request = await leaveRepository.createLeaveRequest({
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
      }, tx);

      if (annual) {
        if (!(await leaveRepository.adjustLeaveBalancePending(employeeId, year, hours, tx))) throw httpError(500, "特休待審時數寫入失敗");
        await leaveRepository.appendLeaveBalanceLog(employeeId, year, 0, `申請特休 ${hours}h（待審）`, request.id, undefined, undefined, tx);
      }

      return request;
    });
  },

  byEmployee: (employeeId: number) => leaveRepository.getLeaveRequestsByEmployee(employeeId),

  async listForAdmin(status?: string) {
    const records = await leaveRepository.getLeaveRequests(status);
    const employees = await employeeService.getAllEmployees();
    const empMap = new Map(employees.map((e) => [e.id, e]));
    return records.map((r) => ({
      ...r,
      employeeName: empMap.get(r.employeeId)?.name || "未知",
      employeeCode: empMap.get(r.employeeId)?.employeeCode || "",
    }));
  },

  async review(id: number, status: string, reviewNote: string | undefined, adminId: number, adminName: string) {
    if (!status || !["approved", "rejected"].includes(status)) {
      throw httpError(400, "status 必須為 approved 或 rejected");
    }
    const request = await leaveRepository.getLeaveRequest(id);
    if (!request) throw httpError(404, "找不到請假申請");

    return withTx(async (tx) => {
      await lockXact(tx, LOCK_NS.leaveBalance, request.employeeId);
      const current = await leaveRepository.getLeaveRequestForUpdate(id, tx);
      if (!current) throw httpError(404, "找不到請假申請");
      const annual = ANNUAL_LEAVE_TYPES.has(current.leaveType);

      const reviewed = await leaveRepository.reviewPendingRequest(id, status, adminId, adminName, reviewNote, tx);
      if (!reviewed) throw httpError(409, "此申請已審核完畢");

      if (annual) {
        const hours = reviewed.hours ?? calcLeaveHours(reviewed.startDate, reviewed.endDate, reviewed.startTime, reviewed.endTime);
        const year = new Date(reviewed.startDate).getFullYear();
        const settle = status === "approved" ? leaveRepository.adjustLeaveBalanceOnApprove : leaveRepository.adjustLeaveBalanceOnReject;
        if (!(await settle(reviewed.employeeId, year, hours, tx))) {
          throw httpError(409, `${year} 年特休待審時數不足 ${hours} 小時，請先核對該員工的特休餘額再審核`);
        }
        if (status === "approved") {
          await leaveRepository.appendLeaveBalanceLog(reviewed.employeeId, year, -hours, `特休核准 ${hours}h`, id, adminId, adminName, tx);
        } else {
          await leaveRepository.appendLeaveBalanceLog(reviewed.employeeId, year, 0, `特休申請拒絕，還原 ${hours}h`, id, adminId, adminName, tx);
        }
      }

      return reviewed;
    });
  },

  async getEmployeeSummary(employeeId: number) {
    const year = getTaipeiYear();
    const balance = await leaveRepository.getLeaveBalance(employeeId, year);
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
    return leaveRepository.getAllLeaveBalances(year);
  },

  async adjustBalance(employeeId: number, year: number, totalHours: number, adminId: number, adminName: string) {
    const emp = await employeeService.getEmployee(employeeId);
    if (!emp) {
      throw httpError(404, "找不到員工");
    }
    if (totalHours < 0) {
      throw httpError(400, "總時數不可為負數");
    }
    return withAuditFailureSignal(() => withTx(async (tx) => {
      await lockXact(tx, LOCK_NS.leaveBalance, employeeId);
      await prepareAudit(tx);
      const before = await leaveRepository.getLeaveBalance(employeeId, year, tx);
      const balance = await leaveRepository.upsertLeaveBalance(employeeId, year, totalHours, tx);
      await leaveRepository.appendLeaveBalanceLog(
        employeeId, year, totalHours,
        `管理員設定年度特休總時數為 ${totalHours}h`,
        undefined, adminId, adminName, tx,
      );
      await recordOperation(tx, { entity: "employee_leave_balances", recordId: balance.id, employeeId, action: "adjust", before, after: balance });
      return balance;
    }));
  },

  async revoke(id: number, reason?: string) {
    const first = await leaveRepository.getLeaveRequest(id);
    if (!first) throw httpError(404, "找不到請假申請");
    return withTx(async (tx) => {
      await lockXact(tx, LOCK_NS.leaveBalance, first.employeeId);
      const before = await leaveRepository.getLeaveRequestForUpdate(id, tx);
      if (!before) throw httpError(404, "找不到請假申請");
      if (before.status === "cancelled") throw httpError(409, "此申請已撤銷");
      if (ANNUAL_LEAVE_TYPES.has(before.leaveType) && ["pending", "approved"].includes(before.status)) {
        const hours = before.hours ?? calcLeaveHours(before.startDate, before.endDate, before.startTime, before.endTime);
        const year = Number(before.startDate.slice(0, 4));
        if (!await leaveRepository.moveLeaveHours(before.employeeId, year, before.status === "pending" ? "pending" : "used", -hours, tx)) throw httpError(409, "特休時數與申請不符，無法撤銷");
        const actor = currentAuditActor();
        await leaveRepository.appendLeaveBalanceLog(before.employeeId, year, before.status === "approved" ? hours : 0, `撤銷特休 ${hours}h`, id, actor.employeeId, actor.name, tx);
      }
      return leaveRepository.changeLeaveRequest(id, { status: "cancelled", reviewNote: reason ?? before.reviewNote }, "revoke", tx);
    });
  },

  async adjustRequest(id: number, payload: unknown) {
    const changes = adjustmentSchema.parse(payload);
    if (!Object.keys(changes).length) throw httpError(400, "沒有要調整的欄位");
    const first = await leaveRepository.getLeaveRequest(id);
    if (!first) throw httpError(404, "找不到請假申請");
    return withTx(async (tx) => {
      await lockXact(tx, LOCK_NS.leaveBalance, first.employeeId);
      const before = await leaveRepository.getLeaveRequestForUpdate(id, tx);
      if (!before) throw httpError(404, "找不到請假申請");
      if (!["pending", "approved"].includes(before.status)) throw httpError(409, "只能調整待審或已核准的請假");
      const after = { ...before, ...changes };
      if (after.endDate < after.startDate) throw httpError(400, "結束日期不可早於開始日期");
      if (CERTIFICATE_REQUIRED.has(after.leaveType) && !after.certificateImageUrl) throw httpError(400, `${after.leaveType}需附上證明文件照片`);
      const hours = calcLeaveHours(after.startDate, after.endDate, after.startTime, after.endTime);
      if (hours <= 0) throw httpError(400, "請假時數必須大於0");
      const bucket = before.status === "approved" ? "used" : "pending";
      const actor = currentAuditActor();
      if (ANNUAL_LEAVE_TYPES.has(before.leaveType)) {
        const oldHours = before.hours ?? calcLeaveHours(before.startDate, before.endDate, before.startTime, before.endTime);
        const year = Number(before.startDate.slice(0, 4));
        if (!await leaveRepository.moveLeaveHours(before.employeeId, year, bucket, -oldHours, tx)) throw httpError(409, "特休時數與申請不符，無法調整");
        await leaveRepository.appendLeaveBalanceLog(before.employeeId, year, bucket === "used" ? oldHours : 0, "調整請假：返還原時數", id, actor.employeeId, actor.name, tx);
      }
      if (ANNUAL_LEAVE_TYPES.has(after.leaveType)) {
        const year = Number(after.startDate.slice(0, 4));
        if (!await leaveRepository.moveLeaveHours(before.employeeId, year, bucket, hours, tx)) throw httpError(400, "特休餘額不足，無法調整");
        await leaveRepository.appendLeaveBalanceLog(before.employeeId, year, bucket === "used" ? -hours : 0, "調整請假：套用新時數", id, actor.employeeId, actor.name, tx);
      }
      return leaveRepository.changeLeaveRequest(id, { ...changes, hours }, "adjust", tx);
    });
  },

  getLeaveRequests: leaveRepository.getLeaveRequests,
  countPendingRequests: leaveRepository.countPendingRequests,
};
