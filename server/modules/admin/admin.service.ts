/**
 * Admin auth service.
 *
 * Centralizes the password-check + admin-record lookup so the route
 * handler is left with HTTP / session concerns only. Session writes
 * remain in the route because they touch req.session and need a callback.
 */
import { storage } from "../../storage";

export interface AdminIdentity {
  id: number;
  name: string;
}

export const adminService = {
  async authenticate(password: string | undefined): Promise<AdminIdentity> {
    if (!password) {
      const err: any = new Error("請輸入密碼");
      err.status = 400;
      throw err;
    }
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
    if (!ADMIN_PASSWORD) {
      const err: any = new Error("伺服器未設定管理員密碼");
      err.status = 500;
      throw err;
    }
    if (password !== ADMIN_PASSWORD) {
      const err: any = new Error("密碼錯誤");
      err.status = 401;
      throw err;
    }
    return this.resolveAdminIdentity();
  },

  async resolveAdminIdentity(): Promise<AdminIdentity> {
    const allEmployees = await storage.getAllEmployees();
    const admin = allEmployees.find((e) => e.isAdmin);
    return { id: admin?.id || 1, name: admin?.name || "管理員" };
  },

  isProductionDeployment(): boolean {
    return process.env.REPLIT_DEPLOYMENT === "1";
  },
};
