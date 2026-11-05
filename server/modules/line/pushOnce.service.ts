import { pushDedupRepository, type PushKey } from "./pushDedup.repository";

/**
 * sent: LINE took it. failed: LINE refused it, the next round pushes it again. unknown: the push or the
 * record of its result threw, so it may have gone out and is not pushed again. skipped: someone else holds it or it was sent.
 */
export type PushOutcome = "sent" | "failed" | "unknown" | "skipped";

export interface PushResult {
  outcome: PushOutcome;
  /** 1 for the first push of this key, 2 for the first retry, and so on. 0 when skipped. */
  attempt: number;
}

export type PushSlot = Omit<PushKey, "refId"> & { refId?: string };

/**
 * Claim the slot, push, then record how it went. The claim is a single statement, so of any number of instances
 * running the same job only one pushes a given slot, and only a `failed` slot is ever pushed again.
 * Claim after every decision to skip, right before the push, so a skipped employee is not locked out.
 */
export async function pushOnce(slot: PushSlot, send: () => Promise<boolean>): Promise<PushResult> {
  const key: PushKey = { ...slot, refId: slot.refId ?? "" };
  const attempt = await pushDedupRepository.claim(key);
  if (attempt === null) return { outcome: "skipped", attempt: 0 };

  let delivered: boolean;
  try {
    delivered = await send();
  } catch (err) {
    console.error(`[push] ${key.scope} ${key.period} employee ${key.employeeId}: push threw, left pending and not retried:`, err);
    return { outcome: "unknown", attempt };
  }

  try {
    await pushDedupRepository.finish(key, delivered ? "sent" : "failed");
  } catch (err) {
    console.error(`[push] ${key.scope} ${key.period} employee ${key.employeeId}: could not record the result, left pending and not retried:`, err);
    return { outcome: "unknown", attempt };
  }
  return { outcome: delivered ? "sent" : "failed", attempt };
}

const KEEP_PUSH_RECORDS_DAYS = 35;

/** Drop slots older than the longest period any job dedups over (a week), with room to spare. */
export function prunePushRecords(now = new Date()): Promise<void> {
  return pushDedupRepository.deleteOlderThan(new Date(now.getTime() - KEEP_PUSH_RECORDS_DAYS * 24 * 3600 * 1000));
}
