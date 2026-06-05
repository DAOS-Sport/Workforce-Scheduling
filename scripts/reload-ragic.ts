/**
 * One-off: re-load the Ragic employee table into the current (default) DB.
 * Safe upsert — creates new, updates existing, deactivates inactive; no deletes.
 * Run: npx tsx scripts/reload-ragic.ts
 */
import { syncFromRagic } from "../server/modules/ragic/ragic.service";
import { storage } from "../server/storage";

async function main() {
  console.log("[reload-ragic] starting Ragic employee sync into the default DB…");
  const res = await syncFromRagic();
  console.log("[reload-ragic] RESULT:", JSON.stringify(res, null, 2));

  const all = await storage.getAllEmployees();
  const matches = all.filter((e) => (e.name || "").includes("佳琪"));
  console.log(
    "[reload-ragic] 佳琪 matches:",
    JSON.stringify(
      matches.map((e) => ({
        id: e.id, name: e.name, code: e.employeeCode, status: e.status,
        regionId: e.regionId, employmentType: e.employmentType, lineId: e.lineId ? "bound" : "unbound",
      })),
      null,
      2,
    ),
  );
  console.log(`[reload-ragic] total employees now: ${all.length}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error("[reload-ragic] FAILED:", e); process.exit(1); });
