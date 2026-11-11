/**
 * Admin auth service.
 *
 * Centralizes the password-check + admin-record lookup so the route
 * handler is left with HTTP / session concerns only. Session writes
 * remain in the route because they touch req.session and need a callback.
 */
import { employeeService } from "../employee/employee.service";
import { httpError } from "../../shared/errors";
import { ADMIN_PAGES, ADMIN_PERMISSION_KEYS, DEFAULT_ADMIN_ROLES, defaultPermissions } from "@shared/admin-permissions";
import { adminRepository } from "./admin.repository";
import { exchangeLoginCode, fetchLoginProfile } from "../../adapters/line";

export interface AdminIdentity {
  id: number;
  name: string;
  role?: string;
  authKind: "personal" | "shared_password";
  permissions: string[];
}

export const adminService = {
  async loginOptions() {
    return { sharedPasswordEnabled: await adminRepository.sharedPasswordEnabled(), lineEnabled: !!(process.env.LINE_CHANNEL_ID && (process.env.LINE_LOGIN_CHANNEL_SECRET || process.env.LINE_CHANNEL_SECRET)) };
  },

  lineAuthorizationUrl(state: string, redirectUri: string): string {
    const clientId = process.env.LINE_CHANNEL_ID;
    if (!clientId || !(process.env.LINE_LOGIN_CHANNEL_SECRET || process.env.LINE_CHANNEL_SECRET)) throw httpError(503, "LINE Login 尚未設定");
    const params = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, state, scope: "profile openid" });
    return `https://access.line.me/oauth2/v2.1/authorize?${params}`;
  },

  async permissionMatrix() {
    const [rows, employees] = await Promise.all([adminRepository.listRolePermissions(), employeeService.getAllEmployees()]);
    const roles = [...new Set([...DEFAULT_ADMIN_ROLES, ...employees.map((e) => e.role), ...rows.map((row) => row.role)])].sort();
    return { pages: ADMIN_PAGES, roles, matrix: Object.fromEntries(roles.map((role) => [role, rows.find((row) => row.role === role)?.permissions ?? defaultPermissions(role)])) };
  },

  async saveRolePermissions(role: string, permissions: unknown) {
    if (!Array.isArray(permissions) || permissions.some((key) => typeof key !== "string" || !ADMIN_PERMISSION_KEYS.includes(key))
      || permissions.some((key) => key.endsWith(":write") && !permissions.includes(key.replace(/:write$/, ":read")))) throw httpError(400, "權限格式錯誤，寫入權限必須同時有讀取權限");
    return adminRepository.saveRolePermissions(role, [...new Set<string>(permissions)]);
  },

  personalLogins: adminRepository.personalLogins,
  recordPersonalLogin: adminRepository.recordPersonalLogin,
  sharedPasswordEnabled: adminRepository.sharedPasswordEnabled,

  async saveSharedPasswordEnabled(enabled: unknown) {
    if (typeof enabled !== "boolean") throw httpError(400, "enabled 必須是布林值");
    return adminRepository.saveSharedPasswordEnabled(enabled);
  },

  async authenticate(password: string | undefined): Promise<AdminIdentity> {
    if (!await adminRepository.sharedPasswordEnabled()) throw httpError(403, "共用密碼登入已停用，請使用個人 LINE 登入");
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
    if (!await adminRepository.sharedPasswordEnabled()) throw httpError(401, "共用密碼登入已停用");
    return { id: -1, name: "共用管理員", authKind: "shared_password", permissions: [...ADMIN_PERMISSION_KEYS] };
  },

  async permissionsForRole(role: string): Promise<string[]> {
    const row = await adminRepository.rolePermissions(role);
    return row ? row.permissions.filter((key) => ADMIN_PERMISSION_KEYS.includes(key)) : defaultPermissions(role);
  },

  async resolveSession(session: { adminId?: number; adminAuthKind?: string; adminLineId?: string }): Promise<AdminIdentity> {
    if (!session.adminId) throw httpError(401, "請先登入管理後台");
    if (session.adminAuthKind !== "personal") return this.resolveAdminIdentity();
    const employee = await employeeService.getEmployee(session.adminId);
    if (!employee || employee.status !== "active" || !session.adminLineId || employee.lineId !== session.adminLineId) throw httpError(401, "個人帳號已停用或 LINE 綁定已變更，請重新登入");
    const matches = (await employeeService.getEmployeesByLineId(session.adminLineId)).filter((row) => row.status === "active");
    if (matches.length !== 1 || matches[0].id !== employee.id) throw httpError(401, "LINE 帳號綁定不唯一，請聯絡管理員");
    const permissions = await this.permissionsForRole(employee.role);
    if (!permissions.some((key) => key.endsWith(":read"))) throw httpError(403, "此角色沒有後台權限");
    return { id: employee.id, name: employee.name, role: employee.role, authKind: "personal", permissions };
  },

  async authenticateLine(code: string, redirectUri: string) {
    if (!code) throw httpError(400, "缺少 LINE 授權碼");
    const clientId = process.env.LINE_CHANNEL_ID;
    const clientSecret = process.env.LINE_LOGIN_CHANNEL_SECRET || process.env.LINE_CHANNEL_SECRET;
    if (!clientId || !clientSecret) throw httpError(503, "LINE Login 尚未設定");
    const response = await exchangeLoginCode({ code, redirectUri, clientId, clientSecret });
    if (!response.ok) throw httpError(401, "LINE 授權失敗");
    const token = await response.json();
    const profileResponse = await fetchLoginProfile(token.access_token);
    if (!profileResponse.ok) throw httpError(401, "無法取得 LINE 個人資料");
    const profile = await profileResponse.json();
    if (typeof profile.userId !== "string" || !profile.userId) throw httpError(401, "無法取得 LINE 個人資料");
    const matches = (await employeeService.getEmployeesByLineId(profile.userId)).filter((row) => row.status === "active");
    if (matches.length !== 1) throw httpError(403, matches.length ? "LINE 帳號綁定不唯一，請聯絡管理員" : "此 LINE 帳號未綁定有效員工");
    const employee = matches[0];
    const permissions = await this.permissionsForRole(employee.role);
    if (!permissions.some((key) => key.endsWith(":read"))) throw httpError(403, "此角色沒有後台權限");
    return { id: employee.id, name: employee.name, role: employee.role, authKind: "personal" as const, permissions, lineId: profile.userId as string };
  },

  isProductionDeployment(): boolean {
    return process.env.REPLIT_DEPLOYMENT === "1";
  },
};
