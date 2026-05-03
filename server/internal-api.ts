/**
 * Task #72 重構 C: This root file is now a thin re-export shim.
 *
 * The full implementation moved to `server/modules/internal/internal.routes.ts`.
 * Existing imports (`server/routes.ts`) keep working unchanged.
 */
export { registerInternalApi } from "./modules/internal/internal.routes";
