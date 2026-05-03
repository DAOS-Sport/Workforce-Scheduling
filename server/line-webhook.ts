/**
 * Task #72 重構 C: This root file is now a thin re-export shim.
 *
 * The actual implementation lives in `server/modules/line/`:
 *   - lineSignature.ts        — isValidLineUserId, verifyLineSignature, verifyForwardedRequest
 *   - lineHelpers.ts          — Taiwan time helpers, LEAVE_TYPES
 *   - lineClock.service.ts    — processClockIn, formatClockInMessage, venue cache
 *   - linePush.service.ts     — pushToLine, weekly/daily reminders, missing-clock-in checks
 *   - lineWebhook.service.ts  — handleLineWebhook (follow / text / location events)
 *
 * Re-exports below preserve every existing public name so all current
 * importers (bootstrap/scheduler.ts, modules/line/*, modules/sync/*,
 * modules/portal/*, modules/venue/*, modules/system/*, server/ragic.ts)
 * keep working without touching their import paths. New code SHOULD import
 * from the module files directly; this shim may be removed later.
 */

export {
  isValidLineUserId,
  verifyLineSignature,
  verifyForwardedRequest,
} from "./modules/line/lineSignature";

export {
  invalidateVenueCache,
  processClockIn,
  formatClockInMessage,
  type NearbyVenue,
  type ClockInResult,
} from "./modules/line/lineClock.service";

export {
  pushToLine,
  pushPendingGuidelinesIfAny,
  sendShiftReminders,
  resetMissingClockInTracker,
  checkMissingClockIn,
  sendWeeklySchedulePush,
  sendWeeklyLateReport,
} from "./modules/line/linePush.service";

export { handleLineWebhook } from "./modules/line/lineWebhook.service";
