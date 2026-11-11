/**
 * 健康檢查的狀態紀錄：排程／同步工作最後一次的執行結果，與外部系統最後一次呼叫的成敗。
 *
 * 存在 system_configs（鍵 `health:job:<名稱>`、`health:integration:<名稱>`），不另開資料表，
 * 這樣不需要改正式庫結構，也不會踩到 Replit 發布時依開發庫 schema 提議 DROP 的問題。
 * 只存「最後一次」，不存歷史。
 *
 * 記錄失敗只印警告，絕不讓原本的工作失敗。每次寫入是單句 SQL（jsonb 合併、計數在資料庫內加一），
 * 不先讀再寫，多個執行個體同時寫同一個鍵也不會互相蓋掉；同一個程序內對同一個鍵仍依呼叫順序送出。
 */
import { systemRepository } from "../../modules/system/system.repository";
import type { IntegrationState, JobState } from "../../core/health/types";
import { pipelineForJob } from "../../core/health/flowRules";
import { withPipeline } from "../logging/context";
import { recordLog } from "../logging/collector";

export const JOB_KEY_PREFIX = "health:job:";
export const INTEGRATION_KEY_PREFIX = "health:integration:";

export type JobTrigger = "cron" | "webhook" | "manual" | "startup";
export type IntegrationName = "line" | "mail" | "ragic" | "enrollment";

const queues = new Map<string, Promise<void>>();

/**
 * Merges `patch` into the stored state with one statement, so two instances never overwrite each other's fields
 * or lose a count. `increment` names a counter raised by one inside that statement. Writes from this process
 * to one key still go out in call order.
 */
function mergeState(key: string, patch: object, options: { increment?: string; stampRecovery?: boolean } = {}): Promise<void> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(async () => {
    try {
      await systemRepository.mergeJsonConfig(key, patch as Record<string, unknown>, options);
    } catch (err: any) {
      console.warn(`[health] 無法寫入 ${key}: ${err?.message ?? err}`);
    }
  });
  queues.set(key, next);
  return next;
}

async function readJson<T>(key: string): Promise<T | undefined> {
  const row = await systemRepository.getSystemConfig(key);
  if (!row) return undefined;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return undefined;
  }
}

const nowIso = () => new Date().toISOString();
const message = (err: unknown) => String((err as any)?.message ?? err).slice(0, 300);

/** 執行一個排程或同步工作，並記下開始、結束、成敗與摘要。工作本身的結果與錯誤原樣傳回。 */
export async function trackJob<T>(
  job: string,
  trigger: JobTrigger,
  run: () => Promise<T>,
  summarize?: (result: T) => Record<string, unknown>,
): Promise<T> {
  const pipeline = pipelineForJob(job);
  recordLog("info", `job started (${trigger})`, pipeline);
  await mergeState(JOB_KEY_PREFIX + job, { lastStartedAt: nowIso(), lastStatus: "running", lastTrigger: trigger } satisfies JobState);
  try {
    const result = await withPipeline(pipeline, run);
    let summary: Record<string, unknown> | undefined;
    try {
      summary = summarize?.(result);
    } catch {
      summary = undefined;
    }
    await mergeState(JOB_KEY_PREFIX + job, { lastFinishedAt: nowIso(), lastStatus: "success", lastSuccessAt: nowIso(), lastSummary: summary } satisfies JobState, { stampRecovery: true });
    recordLog("info", "job finished (success)", pipeline);
    return result;
  } catch (err) {
    recordLog("error", `job finished (failed): ${message(err)}`, pipeline);
    await mergeState(JOB_KEY_PREFIX + job, { lastFinishedAt: nowIso(), lastStatus: "failed", lastFailureAt: nowIso(), lastError: message(err) } satisfies JobState);
    throw err;
  }
}

const SUCCESS_PERSIST_INTERVAL_MS = 5 * 60 * 1000;
const memo = new Map<IntegrationName, { lastOk?: boolean; okPersistedAt: number }>();

/**
 * 記下一次外部呼叫的成敗。呼叫端可以不等待回傳值，寫入不影響呼叫端的時序。
 * 成功時 5 分鐘內最多寫一次（推播一次發幾百則），失敗一定寫。
 * 連續失敗次數由資料庫在同一句 SQL 內加一，多個執行個體同時失敗也不會少算；成功把它歸零。
 */
export function recordIntegration(name: IntegrationName, ok: boolean, error?: unknown): Promise<void> {
  const m = memo.get(name) ?? { okPersistedAt: 0 };
  const now = Date.now();
  if (ok) {
    const skip = m.lastOk === true && now - m.okPersistedAt < SUCCESS_PERSIST_INTERVAL_MS;
    m.lastOk = true;
    memo.set(name, m);
    if (skip) return Promise.resolve();
    m.okPersistedAt = now;
    return mergeState(INTEGRATION_KEY_PREFIX + name, { lastSuccessAt: nowIso(), consecutiveFailures: 0 } satisfies IntegrationState, { stampRecovery: true });
  }
  m.lastOk = false;
  recordLog("error", `integration failed: ${message(error ?? "失敗")}`, `integration.${name}`);
  memo.set(name, m);
  return mergeState(INTEGRATION_KEY_PREFIX + name, { lastFailureAt: nowIso(), lastError: message(error ?? "失敗") } satisfies IntegrationState, { increment: "consecutiveFailures" });
}

export function readJobState(job: string): Promise<JobState | undefined> {
  return readJson<JobState>(JOB_KEY_PREFIX + job);
}

export function readIntegrationState(name: IntegrationName): Promise<IntegrationState | undefined> {
  return readJson<IntegrationState>(INTEGRATION_KEY_PREFIX + name);
}
