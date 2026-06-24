/**
 * 公開（不需 admin cookie）的 API 路徑前綴白名單。
 *
 * 這些前綴會繞過 requireAdmin middleware：
 *  - /api/portal/       → 員工 LIFF portal（cookie 走 employee session 或 LIFF token）
 *  - /api/liff/         → LIFF 登入回呼
 *  - /api/line/         → LINE webhook（X-Line-Signature 驗證）
 *  - /api/ragic/webhook/ → Ragic webhook（RAGIC_WEBHOOK_SECRET 驗證）
 *  - /api/internal/     → server-to-server（X-Internal-Token 驗證）
 *  - /api/anomaly-report 員工通報入口（公開表單）
 *  - /api/announcements/active → 員工 portal 顯示公告
 *
 * 注意：
 *  - 不要把 /api/admin/ 放進來。
 *  - /api/admin/login、/api/admin/me、/api/admin/logout 已經在 gateAdminApi 前面註冊，所以仍可正常使用。
 *  - 其他 /api/admin/* 必須受到後台登入保護。
 */
export const OPEN_API_PREFIXES = [
  "/api/portal/",
  "/api/liff/",
  "/api/line/",
  "/api/ragic/webhook/",
  "/api/internal/",
  "/api/anomaly-report",
  "/api/announcements/active",
] as const;
