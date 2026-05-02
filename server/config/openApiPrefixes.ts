/**
 * 公開（不需 admin cookie）的 API 路徑前綴白名單。
 *
 * 這些前綴會繞過 requireAdmin middleware：
 *  - /api/admin/        → 登入相關（自己有保護）
 *  - /api/portal/       → 員工 LIFF portal（cookie 走 employee session 或 LIFF token）
 *  - /api/liff/         → LIFF 登入回呼
 *  - /api/line/         → LINE webhook（X-Line-Signature 驗證）
 *  - /api/internal/     → server-to-server（X-Internal-Token 驗證）
 *  - /api/anomaly-report 員工通報入口（公開表單）
 *  - /api/announcements/active → 員工 portal 顯示公告
 */
export const OPEN_API_PREFIXES = [
  "/api/admin/",
  "/api/portal/",
  "/api/liff/",
  "/api/line/",
  "/api/internal/",
  "/api/anomaly-report",
  "/api/announcements/active",
] as const;
