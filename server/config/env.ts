/**
 * server/config/env.ts
 *
 * Centralised environment-variable registry.
 *
 * Rules:
 *  - REQUIRED vars throw if missing (they make no sense without a value).
 *  - OPTIONAL vars log a warning if absent but never throw; callers must
 *    handle the undefined/empty-string case themselves.
 *  - All values are read once at module load time (process start) so
 *    the rest of the app gets typed, named constants instead of bare
 *    process.env strings scattered everywhere.
 */

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`[env] Required environment variable ${key} is not set`);
  return val;
}

function optionalEnv(key: string, fallback = ""): string {
  const val = process.env[key];
  if (!val && !fallback) {
    console.warn(`[env] Optional environment variable ${key} is not set`);
  }
  return val || fallback;
}

// ── Required ────────────────────────────────────────────────────────────────
export const DATABASE_URL = requireEnv("DATABASE_URL");

// ── Optional — authentication / session ─────────────────────────────────────
export const SESSION_SECRET = optionalEnv("SESSION_SECRET");
export const ADMIN_PASSWORD = optionalEnv("ADMIN_PASSWORD");

// ── Optional — LINE ──────────────────────────────────────────────────────────
export const LINE_CHANNEL_ACCESS_TOKEN = optionalEnv("LINE_CHANNEL_ACCESS_TOKEN");
export const LINE_CHANNEL_SECRET = optionalEnv("LINE_CHANNEL_SECRET");
export const VITE_LIFF_ID = optionalEnv("VITE_LIFF_ID");

// ── Optional — email ─────────────────────────────────────────────────────────
export const GMAIL_USER = optionalEnv(
  "GMAIL_USER",
  "daos.ragic.system@gmail.com",
);
export const GMAIL_APP_PASSWORD = optionalEnv("GMAIL_APP_PASSWORD");

// ── Optional — Ragic ─────────────────────────────────────────────────────────
export const RAGIC_API_KEY = optionalEnv("RAGIC_API_KEY");

// ── Optional — internal token ────────────────────────────────────────────────
export const INTERNAL_API_TOKEN = optionalEnv("INTERNAL_API_TOKEN");

// ── Deployment flag ──────────────────────────────────────────────────────────
/** True only in Replit production deployments. Controls cron job activation. */
export const IS_PRODUCTION = process.env.REPLIT_DEPLOYMENT === "1";
