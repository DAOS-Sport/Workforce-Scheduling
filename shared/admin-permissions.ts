import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const adminRolePermissions = pgTable("admin_role_permissions", {
  role: text("role").primaryKey(),
  permissions: jsonb("permissions").$type<string[]>().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const ADMIN_PAGES = [
  { key: "dashboard", path: "/", label: "排班總覽" },
  { key: "schedule", path: "/schedule", label: "排班編輯" },
  { key: "availability", path: "/availability", label: "排班意願" },
  { key: "employees", path: "/employees", label: "員工管理" },
  { key: "venues", path: "/venues", label: "場館管理" },
  { key: "summer", path: "/admin/summer-schedule-v40.html", label: "暑假排班表" },
  { key: "attendance", path: "/attendance", label: "考勤稽核" },
  { key: "clock-records", path: "/clock-records", label: "GPS 打卡" },
  { key: "anomaly-reports", path: "/anomaly-reports", label: "打卡異常" },
  { key: "weekly-attendance", path: "/weekly-attendance", label: "週報打卡" },
  { key: "salary-report", path: "/salary-report", label: "工時總表" },
  { key: "leave-requests", path: "/leave-requests", label: "請假管理" },
  { key: "guidelines", path: "/guidelines", label: "守則與公告" },
  { key: "guideline-acks", path: "/guideline-acks", label: "守則簽署紀錄" },
  { key: "reports", path: "/reports", label: "報表匯出" },
  { key: "sop", path: "/sop", label: "系統 SOP 說明" },
  { key: "it-monitor", path: "/it-monitor", label: "IT 監控" },
  { key: "permissions", path: "/permissions", label: "角色權限管理" },
  { key: "audit", path: "/audit", label: "操作紀錄" },
] as const;

export type AdminResource = typeof ADMIN_PAGES[number]["key"];
export const ADMIN_PERMISSION_KEYS = ADMIN_PAGES.flatMap(({ key }) => [`${key}:read`, `${key}:write`]);
export const DEFAULT_ADMIN_ROLES = ["主管職", "行政專員", "資訊工程師"];

export function defaultPermissions(role: string): string[] {
  return DEFAULT_ADMIN_ROLES.includes(role) ? [...ADMIN_PERMISSION_KEYS] : [];
}

export function canReadPage(permissions: readonly string[], path: string): boolean {
  const page = ADMIN_PAGES.find((p) => p.path === path || (path === "/announcements" && p.key === "guidelines"));
  return !!page && permissions.includes(`${page.key}:read`);
}

export function hasPermission(permissions: readonly string[], resource: string, action: "read" | "write"): boolean {
  return permissions.includes(`${resource}:read`) && (action === "read" || permissions.includes(`${resource}:write`));
}

/** Matches authorization to both Express route variants and decoded static asset paths. */
export function canonicalAdminPath(path: string): string {
  if (/%(?:2f|5c)/i.test(path)) throw new Error("路徑編碼錯誤");
  let decoded: string;
  try { decoded = decodeURIComponent(path); } catch { throw new Error("路徑編碼錯誤"); }
  if (decoded.includes("%") || decoded.includes("\\") || /[\u0000-\u001f\u007f]/.test(decoded)) throw new Error("路徑編碼錯誤");
  const segments: string[] = [];
  for (const part of decoded.split("/")) {
    if (!part || part === ".") continue;
    segments.push(part.toLowerCase());
  }
  return "/" + segments.join("/");
}
