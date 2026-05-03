/**
 * server/config/env.ts
 *
 * Centralised environment-variable registry.
 *
 * Rules:
 *  - All vars are WARN-ONLY here: missing values log a warning but never
 *    throw. This keeps startup errors predictable and lets lower-level
 *    modules (e.g. server/infra/db) enforce their own hard requirements.
 *  - All values are read once at module load time so the rest of the app
 *    gets typed, named constants instead of bare process.env strings
 *    scattered everywhere.
 */

function warnEnv(key: string, fallback = ""): string {
  const val = process.env[key];
  if (!val && !fallback) {
    console.warn(`[env] Environment variable ${key} is not set`);
  }
  return val || fallback;
}

// ── Database ─────────────────────────────────────────────────────────────────
// Note: server/infra/db/index.ts performs the hard throw if DATABASE_URL is
// absent so the DB connection fails fast at boot, not silently at query time.
export const DATABASE_URL = warnEnv("DATABASE_URL");

// ── Authentication / session ─────────────────────────────────────────────────
export const SESSION_SECRET = warnEnv("SESSION_SECRET");
export const ADMIN_PASSWORD = warnEnv("ADMIN_PASSWORD");

// ── LINE ─────────────────────────────────────────────────────────────────────
export const LINE_CHANNEL_ACCESS_TOKEN = warnEnv("LINE_CHANNEL_ACCESS_TOKEN");
export const LINE_CHANNEL_SECRET = warnEnv("LINE_CHANNEL_SECRET");
export const VITE_LIFF_ID = warnEnv("VITE_LIFF_ID");

// ── Email ────────────────────────────────────────────────────────────────────
export const GMAIL_USER = warnEnv(
  "GMAIL_USER",
  "daos.ragic.system@gmail.com",
);
export const GMAIL_APP_PASSWORD = warnEnv("GMAIL_APP_PASSWORD");

// ── Ragic ────────────────────────────────────────────────────────────────────
export const RAGIC_API_KEY = warnEnv("RAGIC_API_KEY");

// ── Internal token ───────────────────────────────────────────────────────────
export const INTERNAL_API_TOKEN = warnEnv("INTERNAL_API_TOKEN");

// ── Deployment flag ──────────────────────────────────────────────────────────
/** True only in Replit production deployments. Controls cron job activation. */
export const IS_PRODUCTION = process.env.REPLIT_DEPLOYMENT === "1";
