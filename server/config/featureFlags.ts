/**
 * server/config/featureFlags.ts
 *
 * Runtime feature flags for the 駿斯排班系統.
 *
 * Flags default to true (all features on). Set the corresponding env var to
 * "false" to disable a feature without redeploying code.
 *
 * Example .env:
 *   FEATURE_RAGIC_SYNC=false
 */

function flag(envKey: string, defaultOn = true): boolean {
  const val = process.env[envKey];
  if (val === undefined) return defaultOn;
  return val.toLowerCase() !== "false" && val !== "0";
}

export const featureFlags = {
  /** Ragic sync cron job (daily). */
  ragicSync: flag("FEATURE_RAGIC_SYNC"),

  /** Weekly shift reminder push to employees via LINE. */
  weeklyShiftReminder: flag("FEATURE_WEEKLY_SHIFT_REMINDER"),

  /** Daily shift reminder push to employees. */
  dailyShiftReminder: flag("FEATURE_DAILY_SHIFT_REMINDER"),

  /** Missing clock-in detection cron. */
  missingClockCheck: flag("FEATURE_MISSING_CLOCK_CHECK"),

  /** Weekly late-arrival report push. */
  weeklyLateReport: flag("FEATURE_WEEKLY_LATE_REPORT"),

  /** Outing (外出簽到) feature in the employee portal. */
  outingSignIn: flag("FEATURE_OUTING_SIGN_IN"),
} as const;

export type FeatureFlags = typeof featureFlags;
