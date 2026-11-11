import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { PushDeliveryOutcome } from "../../adapters/line";
import { pushDedupRepository, type PushKey } from "./pushDedup.repository";

/** sent: LINE accepted; failed: LINE refused; unknown: acceptance or persistence is uncertain. */
export type PushOutcome = "sent" | "failed" | "unknown" | "skipped";

export interface PushResult {
  outcome: PushOutcome;
  /** Advances only after a rejected attempt; 0 when skipped. */
  attempt: number;
  /** This caller took over an existing slot, including stale pending. */
  reclaimed: boolean;
}

export type PushSlot = Omit<PushKey, "refId"> & { refId?: string };

function retryKeyFor(key: PushKey, attempt: number): string {
  const bytes = createHash("sha1").update(JSON.stringify([key.scope, key.period, key.employeeId, key.refId, attempt])).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Claim immediately before sending. Retries of an uncertain attempt always reuse its LINE retry key. */
export async function pushOnce(
  slot: PushSlot,
  send: (retryKey: string) => Promise<PushDeliveryOutcome>,
  options: { reclaimPending?: boolean } = {},
): Promise<PushResult> {
  const key: PushKey = { ...slot, refId: slot.refId ?? "" };
  const claim = await pushDedupRepository.claim(key, undefined, options.reclaimPending ?? true);
  if (claim === null) return { outcome: "skipped", attempt: 0, reclaimed: false };
  const retryKey = retryKeyFor(key, claim.attempt);

  let delivered: PushDeliveryOutcome = "unknown";
  const sendBackoff = [1_000, 3_000];
  for (let retry = 0; retry <= sendBackoff.length; retry++) {
    if (retry > 0) await delay(sendBackoff[retry - 1]);
    try {
      delivered = await send(retryKey);
    } catch (err) {
      console.error("[push] Send result unknown:", err);
      delivered = "unknown";
    }
    if (delivered !== "unknown") break;
  }
  if (delivered === "unknown") return { outcome: "unknown", ...claim };

  const outcome = delivered === "accepted" ? "sent" : "failed";
  const finishBackoff = [250, 750];
  for (let retry = 0; retry <= finishBackoff.length; retry++) {
    if (retry > 0) await delay(finishBackoff[retry - 1]);
    try {
      await pushDedupRepository.finish(key, outcome);
      return { outcome, ...claim };
    } catch (err) {
      console.error("[push] Could not record delivery result:", err);
    }
  }
  return { outcome: "unknown", ...claim };
}

const KEEP_PUSH_RECORDS_DAYS = 35;

/** Drop slots older than the longest period any job dedups over (a week), with room to spare. */
export function prunePushRecords(now = new Date()): Promise<void> {
  return pushDedupRepository.deleteOlderThan(new Date(now.getTime() - KEEP_PUSH_RECORDS_DAYS * 24 * 3600 * 1000));
}
