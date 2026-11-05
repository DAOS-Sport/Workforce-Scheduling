import { randomUUID } from "crypto";
import { fetchAllRagicRecords } from "../../adapters/ragic";
import { SnapshotRejected, assertSnapshotComplete, planEmployeeSync } from "../../core/ragic/employeeSync";
import { VENUE_DATA } from "../../core/ragic/venueData";
import { LOCK_NS, withSessionLock, withTx } from "../../infra/db/tx";
import { trackJob, type JobTrigger } from "../../shared/health/healthState";
import { httpError } from "../../shared/http/response";
import { log } from "../../shared/log";
import { dispatchService } from "../dispatch/dispatch.service";
import { employeeService } from "../employee/employee.service";
import { isValidLineUserId } from "../line/lineSignature";
import { regionService } from "../region/region.service";
import { venueService } from "../venue/venue.service";
import { ragicRepository, type SyncEventSource } from "./ragic.repository";

// Task #50 NOTE: This module currently only syncs employees + venues.
// If shift sync is ever added here, all writes MUST:
//   1. Pass actor='system:ragic-sync' to the shift create/update/delete writes
//   2. Pass force=false (or omit) so active shifts are never silently overwritten
// The shift repository guard will throw on (non-admin actor + active shift + !force).

export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  deactivated: number;
  errors: string[];
  skipReasons: Record<string, number>;
  totalFetched: number;
}

export type RagicSyncOutcome = { busy: true } | { busy: false; result: SyncResult };

/** Employee sync and venue sync each take their own key under the Ragic lock namespace. */
const EMPLOYEE_SYNC_KEY = 0;
const VENUE_SYNC_KEY = 1;

const DONE_EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const summarize = (r: SyncResult) => ({ created: r.created, updated: r.updated, deactivated: r.deactivated, skipped: r.skipped, errors: r.errors.length });

/**
 * Fetches one Ragic snapshot and applies it to the employees in a single transaction: a write that fails rolls back the
 * whole round. The fetch happens before the transaction opens. Callers hold the Ragic sync lock (see runRagicSync).
 */
export async function syncFromRagic(dryRun = false): Promise<SyncResult> {
  const apiKey = process.env.RAGIC_API_KEY;
  if (!apiKey) throw new Error("RAGIC_API_KEY not configured");

  const records = await fetchAllRagicRecords(apiKey);
  console.log(`[ragic] 共拉取 ${Object.keys(records).length} 筆原始記錄，開始處理...`);

  const regions = await regionService.findAll();
  const regionIdByCode = new Map(regions.map((r) => [r.code, r.id]));

  const plan = await withTx(async (tx) => {
    const locals = await employeeService.getAllEmployees(tx);
    const observed = await ragicRepository.getObservedStatuses(tx);
    const next = planEmployeeSync({ records, locals, regionIdByCode, observed, isValidLineId: isValidLineUserId });
    try {
      assertSnapshotComplete(next);
    } catch (err) {
      if (err instanceof SnapshotRejected) throw httpError(409, err.message);
      throw err;
    }
    if (dryRun) return next;
    for (const op of next.ops) {
      if (op.kind === "create") await employeeService.createEmployee(op.data, tx);
      else await employeeService.updateFromRagic(op.id, op.data, tx);
    }
    await ragicRepository.saveObservedStatuses(next.observed, tx);
    return next;
  });

  // The admin form links dispatch shifts to a new employee by name; a synced employee gets the same link.
  if (!dryRun && plan.created > 0) {
    dispatchService.reconcileDispatchLinks().catch((err: any) => log(`Ragic 同步後派遣連結失敗: ${err?.message ?? err}`, "ragic"));
  }

  const result: SyncResult = {
    created: plan.created,
    updated: plan.updated,
    skipped: plan.skipped,
    deactivated: plan.deactivated,
    errors: plan.errors,
    skipReasons: plan.skipReasons,
    totalFetched: plan.totalFetched,
  };
  console.log(`[ragic] ${dryRun ? "[預覽] " : ""}同步完成 — 新增:${result.created} 更新:${result.updated} 略過:${result.skipped} 停用:${result.deactivated} 錯誤:${result.errors.length}`);
  if (Object.keys(result.skipReasons).length > 0) {
    console.log(`[ragic] 略過原因:`, result.skipReasons);
  }
  return result;
}

const errorText = (err: unknown) => String((err as any)?.message ?? err).slice(0, 300);

/**
 * The one way in for the webhook's replay, the 03:00 run and both manual URLs. One employee sync runs at a time, holding
 * the lock from the fetch to the commit, so an older snapshot can never be written over a newer one. A caller that finds
 * the lock taken leaves a pending request behind and gets `{ busy: true }`; whoever holds the lock replays it afterwards.
 */
export async function runRagicSync(trigger: JobTrigger): Promise<RagicSyncOutcome> {
  try {
    const locked = await withSessionLock(LOCK_NS.ragicSync, EMPLOYEE_SYNC_KEY, async () => {
      const claimed = await ragicRepository.claimOpenEvents();
      try {
        const result = await trackJob("ragic.sync", trigger, () => syncFromRagic(false), summarize);
        await ragicRepository.finishEvents(claimed, null);
        await ragicRepository.purgeEventsDoneBefore(new Date(Date.now() - DONE_EVENT_RETENTION_MS));
        return result;
      } catch (err) {
        await ragicRepository.finishEvents(claimed, errorText(err)).catch(() => undefined);
        throw err;
      }
    });
    if (!locked.acquired) {
      if (trigger !== "webhook") await ragicRepository.recordEvent(randomUUID(), trigger as SyncEventSource);
      return { busy: true };
    }
    return { busy: false, result: locked.value };
  } finally {
    // Requests that arrived while this sync was fetching are not covered by it.
    if (await ragicRepository.hasPendingEvents().catch(() => false)) scheduleDrain();
  }
}

let drainTimer: NodeJS.Timeout | undefined;
const debounceMs = () => Number(process.env.RAGIC_WEBHOOK_DEBOUNCE_MS ?? 30_000);

/** Run the sync for whatever requests are waiting, once, after the debounce window; deliveries inside it share that one run. */
function scheduleDrain(): void {
  if (drainTimer) return;
  drainTimer = setTimeout(() => {
    drainTimer = undefined;
    drainRagicEvents().catch((err) => log(`Ragic 補跑失敗: ${errorText(err)}`, "ragic"));
  }, debounceMs());
  drainTimer.unref?.();
}

export function cancelScheduledDrain(): void {
  if (drainTimer) clearTimeout(drainTimer);
  drainTimer = undefined;
}

/** Sync now if a webhook delivery, or a run that found the lock taken, is waiting for one. The 5-minute cron calls this too. */
export async function drainRagicEvents(): Promise<RagicSyncOutcome | { idle: true }> {
  if (!(await ragicRepository.hasPendingEvents())) return { idle: true };
  return runRagicSync("webhook");
}

/** Store a webhook delivery, then let the debounced run pick it up. Ragic gets its answer without waiting for the sync. */
export async function acceptWebhook(eventId?: string): Promise<{ eventId: string; duplicate: boolean }> {
  const id = eventId || randomUUID();
  const fresh = await ragicRepository.recordEvent(id, "webhook");
  if (fresh) scheduleDrain();
  return { eventId: id, duplicate: !fresh };
}

export interface VenueSyncResult {
  created: number;
  existing: number;
  skipped: number;
  errors: string[];
  updated: number;
}

export type VenueSyncOutcome = { busy: true } | { busy: false; result: VenueSyncResult };

/** Venue sync under its own lock key, so two of them never create the same venue twice. */
export async function runVenueSync(): Promise<VenueSyncOutcome> {
  const locked = await withSessionLock(LOCK_NS.ragicSync, VENUE_SYNC_KEY, () =>
    trackJob("ragic.venue-sync", "manual", () => syncVenuesFromRagic(), (r) => ({ created: r.created, existing: r.existing, skipped: r.skipped, errors: r.errors.length })),
  );
  return locked.acquired ? { busy: false, result: locked.value } : { busy: true };
}

export async function syncVenuesFromRagic(): Promise<VenueSyncResult> {
  const apiKey = process.env.RAGIC_API_KEY;
  if (!apiKey) throw new Error("RAGIC_API_KEY not configured");

  const result: VenueSyncResult = { created: 0, existing: 0, skipped: 0, errors: [], updated: 0 };

  const data = await fetchAllRagicRecords(apiKey);
  console.log(`[ragic-venue] 共拉取 ${Object.keys(data).length} 筆原始記錄`);

  const regions = await regionService.findAll();
  const regionMap = new Map(regions.map((r) => [r.code, r.id]));

  const allVenues = await Promise.all(regions.map((r) => venueService.getVenuesByRegion(r.id)));
  const existingVenueNames = new Set(allVenues.flat().map((v) => v.name.replace(/館$/, "")));

  const deptMap = new Map<string, string>();
  for (const record of Object.values(data)) {
    const rawDept = (record as any)["部門"];
    const depts = Array.isArray(rawDept) ? rawDept : [String(rawDept || "")];
    const rawOpType = (record as any)["1002826"];
    const opType = Array.isArray(rawOpType) ? (rawOpType[0] || "").trim() : String(rawOpType || "").trim();
    depts.forEach((d: string) => {
      const dt = d.trim();
      if (dt && opType && !deptMap.has(dt)) deptMap.set(dt, opType);
      if (dt && !deptMap.has(dt)) deptMap.set(dt, "");
    });
  }

  for (const [dept, ragicOpType] of Array.from(deptMap.entries())) {
    const venueName = dept.startsWith("勞務-") ? dept.replace("勞務-", "") : dept;

    if (existingVenueNames.has(venueName) || existingVenueNames.has(venueName.replace(/館$/, ""))) {
      result.existing++;
      continue;
    }

    const venueInfo = VENUE_DATA[venueName];
    if (!venueInfo) {
      result.errors.push(`${dept}: 無對應資料，跳過新增`);
      result.skipped++;
      continue;
    }

    const regionId = regionMap.get(venueInfo.region);
    if (!regionId) {
      result.errors.push(`${dept}: 區域代碼「${venueInfo.region}」不存在`);
      result.skipped++;
      continue;
    }

    try {
      const opType = ragicOpType || venueInfo.operationType;
      // Coordinates and radius go in now: the boot seed no longer fills them in for a venue that already exists.
      await venueService.create({
        name: venueName,
        shortName: venueName,
        regionId,
        address: venueInfo.address,
        latitude: venueInfo.lat,
        longitude: venueInfo.lng,
        radius: 200,
        taxId: venueInfo.taxId,
        isInternal: venueInfo.isInternal,
        operationType: opType || null,
      });
      result.created++;
    } catch (err: any) {
      result.errors.push(`${dept}: ${err.message}`);
    }
  }

  console.log(`[ragic-venue] 場館同步完成 — 新增:${result.created} 已存在:${result.existing} 略過:${result.skipped} 錯誤:${result.errors.length}`);
  return result;
}
