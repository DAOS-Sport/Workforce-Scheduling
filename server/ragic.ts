/**
 * Task #72 重構 C: This root file is now a thin re-export shim.
 *
 * The actual implementation lives in `server/modules/ragic/`:
 *   - ragicClient.ts   — HTTP transport (fetchAllRagicRecords + retry)
 *   - ragic.service.ts — employee + venue sync business logic
 *
 * Re-exports below preserve every existing public name so all current
 * importers (bootstrap/scheduler.ts, modules/sync/sync.service.ts) keep
 * working unchanged. New code SHOULD import from the module files
 * directly; this shim may be removed later.
 */
export { syncFromRagic, syncVenuesFromRagic } from "./modules/ragic/ragic.service";
