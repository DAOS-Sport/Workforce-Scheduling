/**
 * Admin auth service.
 *
 * Centralizes the password-check + admin-record lookup so the route
 * handler is left with HTTP / session concerns only. Session writes
 * remain in the route because they touch req.session and need a callback.
 */
import { employeeService } from "../employee/employee.service";
import { httpError } from "../../shared/errors";

export interface AdminIdentity {
  id: number;
  name: string;
}

export const adminService = {
  async authenticate(password: string | undefined): Promise<AdminIdentity> {
    if (!password) {
      throw httpError(400, "請輸入密碼");
    }
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
    if (!ADMIN_PASSWORD) {
      throw httpError(500, "伺服器未設定管理員密碼");
    }
    if (password !== ADMIN_PASSWORD) {
      throw httpError(401, "密碼錯誤");
    }
    return this.resolveAdminIdentity();
  },

  async resolveAdminIdentity(): Promise<AdminIdentity> {
    const allEmployees = await employeeService.getAllEmployees();
    const admin = allEmployees.find((e) => e.isAdmin);
    return { id: admin?.id || 1, name: admin?.name || "管理員" };
  },

  isProductionDeployment(): boolean {
    return process.env.REPLIT_DEPLOYMENT === "1";
  },
};
