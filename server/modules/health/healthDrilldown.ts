import type { Express } from "express";
import { FLOW_DEFINITIONS, pipelineForJob, pipelineForPath } from "../../core/health/flowRules";
import type { HealthSignals } from "../../core/health/report";
import type { HealthReport, Pipeline } from "../../core/health/types";
import { routeTemplate } from "./healthErrors";

type Evidence = NonNullable<Pipeline["evidence"]>[number];
const requestId = (value: string | null): string | null => value && /^[A-Za-z0-9-]{1,64}$/.test(value) ? value : null;

function publicOrigin(): string | undefined {
  try {
    const url = new URL(process.env.HEALTH_PUBLIC_URL ?? "");
    return url.protocol === "https:" && !url.username && !url.password ? url.origin : undefined;
  } catch { return undefined; }
}

/** Optional diagnostics never affect the lamp rules or expose raw error/log messages. */
export async function attachPipelineDrilldown(report: HealthReport, signals: HealthSignals, app?: Express): Promise<HealthReport> {
  const origin = publicOrigin();
  const entries = new Map<string, Evidence[]>();
  const affected = new Set(report.pipelines.filter(p => p.level !== "green").map(p => p.id));
  const add = (id: string, entry: Evidence) => {
    if (affected.has(id)) entries.set(id, [...(entries.get(id) ?? []), entry]);
  };
  if (affected.size) {
    try {
      const { readDrilldownErrors } = await import("./healthDrilldown.repository");
      for (const row of await readDrilldownErrors(signals.now)) {
        const entry = { at: row.occurredAt.toISOString(), requestId: requestId(row.requestId), code: String(row.status),
          route: routeTemplate(app, row), summary: `伺服器錯誤 ${row.status}` };
        const id = pipelineForPath(row.path);
        if (id) add(id, entry);
        add("server.errors", entry);
      }
    } catch { /* Existing health signals still determine the lamps when optional detail is unavailable. */ }
  }
  for (const p of report.pipelines) {
    // These flows also observe non-HTTP failures in pipeline_logs; other route flows use app_errors.
    if (FLOW_DEFINITIONS.some(d => d.id === p.id) && !["portal.login", "admin.login", "manual.weekly-attendance"].includes(p.id)) continue;
    for (const log of p.logs ?? []) {
      if (log.level !== "error" && log.level !== "warn") continue;
      add(p.id, { at: log.at, requestId: requestId(log.requestId), code: null, route: null,
        summary: log.level === "error" ? "管線執行失敗" : "管線警告" });
      if (p.id === "clock.coverage" && log.message.startsWith("geolocation_failure ")) {
        add("clock.geolocation", { at: log.at, requestId: requestId(log.requestId), code: null, route: null, summary: "定位失敗" });
      }
    }
  }
  const failure = (id: string, at: string | undefined, summary: string) => {
    if (at && Number.isFinite(Date.parse(at)) && Date.parse(at) <= signals.now.getTime())
      add(id, { at: new Date(at).toISOString(), requestId: null, code: null, route: null, summary });
  };
  for (const [id, state] of Object.entries(signals.jobs)) {
    if (state && !("readError" in state)) failure(pipelineForJob(id), state.lastFailureAt, "排程執行失敗");
  }
  for (const [key, state] of Object.entries(signals.integrations)) {
    if (state && !("readError" in state)) failure(`integration.${key}`, state.lastFailureAt, "外部服務呼叫失敗");
  }
  for (const [id, state] of [["errors.purge", signals.flow?.purge], ["manual.weekly-attendance", signals.flow?.weeklyAttendance]] as const) {
    if (state && !("readError" in state)) failure(id, state.lastFailureAt, "排程執行失敗");
  }
  const webhook = signals.flow?.lineWebhook;
  if (webhook && !("readError" in webhook)) failure("line.webhook", webhook.lastFailureAt ?? undefined, "LINE webhook 處理失敗");
  if (!("readError" in signals.scheduleSave)) {
    failure("schedule.save", signals.scheduleSave.lastCriticalAt, "排班儲存失敗");
    failure("schedule.save", signals.scheduleSave.lastUnsavedExitAt, "排班尚未儲存即離開");
  }
  return { ...report, pipelines: report.pipelines.map(p => {
    const evidence = (entries.get(p.id) ?? []).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 5);
    return { ...p, ...(evidence.length ? { evidence } : {}),
      ...(origin ? { links: [{ label: "後台 IT 監控", url: `${origin}/it-monitor#${p.id}` }] } : {}) };
  }) };
}
