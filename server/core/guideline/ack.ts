import { taipeiClock } from "../time/taipei";

/**
 * Whether an acknowledgment still counts: it was given this month (Taipei) and the guideline has not been edited since.
 * A guideline that changed after it was acknowledged has to be acknowledged again.
 */
export function ackIsCurrent(ackedAt: Date | null, guidelineUpdatedAt: Date | null, now: Date): boolean {
  if (!ackedAt) return false;
  if (taipeiClock(ackedAt).date.slice(0, 7) !== taipeiClock(now).date.slice(0, 7)) return false;
  return !guidelineUpdatedAt || guidelineUpdatedAt.getTime() <= ackedAt.getTime();
}
