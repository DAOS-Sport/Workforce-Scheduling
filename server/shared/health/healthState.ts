/**
 * 健康檢查的狀態紀錄：排程／同步工作最後一次的執行結果，與外部系統最後一次呼叫的成敗。
 *
 * 存在 system_configs（鍵 `health:job:<名稱>`、`health:integration:<名稱>`），不另開資料表，
 * 這樣不需要改正式庫結構，也不會踩到 Replit 發布時依開發庫 schema 提議 DROP 的問題。
 * 只存「最後一次」，不存歷史。
 *
 * 記錄失敗只印警告，絕不讓原本的工作失敗。同一個鍵的寫入依呼叫順序排隊，避免讀改寫互相覆蓋。
 */
import { systemRepository } from "../../modules/system/system.repository";
import type { IntegrationState, JobState } from "../../core/health/types";

export const JOB_KEY_PREFIX = "health:job:";
export const INTEGRATION_KEY_PREFIX = "health:integration:";

export type JobTrigger = "cron" | "webhook" | "manual" | "startup";
export type IntegrationName = "line" | "mail" | "ragic" | "enrollment";

const queues = new Map<string, Promise<void>>();

function updateJson<T extends object>(key: string, change: (current: T) => T): Promise<void> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(async () => {
    try {
      const row = await systemRepository.getSystemConfig(key);
      const current = row ? (JSON.parse(row.value) as T) : ({} as T);
      await systemRepository.upsertSystemConfig(key, JSON.stringify(change(current)));
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
  await updateJson<JobState>(JOB_KEY_PREFIX + job, (s) => ({ ...s, lastStartedAt: nowIso(), lastStatus: "running", lastTrigger: trigger }));
  try {
    const result = await run();
    let summary: Record<string, unknown> | undefined;
    try {
      summary = summarize?.(result);
    } catch {
      summary = undefined;
    }
    await updateJson<JobState>(JOB_KEY_PREFIX + job, (s) => ({ ...s, lastFinishedAt: nowIso(), lastStatus: "success", lastSuccessAt: nowIso(), lastSummary: summary }));
    return result;
  } catch (err) {
    await updateJson<JobState>(JOB_KEY_PREFIX + job, (s) => ({ ...s, lastFinishedAt: nowIso(), lastStatus: "failed", lastFailureAt: nowIso(), lastError: message(err) }));
    throw err;
  }
}

const SUCCESS_PERSIST_INTERVAL_MS = 5 * 60 * 1000;
const memo = new Map<IntegrationName, { lastOk?: boolean; okPersistedAt: number; consecutiveFailures: number }>();

/**
 * 記下一次外部呼叫的成敗。不等待寫入完成，不影響呼叫端的時序。
 * 成功時 5 分鐘內最多寫一次（推播一次發幾百則），失敗一定寫。
 */
export function recordIntegration(name: IntegrationName, ok: boolean, error?: unknown): void {
  const m = memo.get(name) ?? { okPersistedAt: 0, consecutiveFailures: 0 };
  const now = Date.now();
  if (ok) {
    const skip = m.lastOk === true && now - m.okPersistedAt < SUCCESS_PERSIST_INTERVAL_MS;
    m.consecutiveFailures = 0;
    m.lastOk = true;
    memo.set(name, m);
    if (skip) return;
    m.okPersistedAt = now;
    void updateJson<IntegrationState>(INTEGRATION_KEY_PREFIX + name, (s) => ({ ...s, lastSuccessAt: nowIso(), consecutiveFailures: 0 }));
    return;
  }
  m.consecutiveFailures += 1;
  m.lastOk = false;
  memo.set(name, m);
  const failures = m.consecutiveFailures;
  void updateJson<IntegrationState>(INTEGRATION_KEY_PREFIX + name, (s) => ({ ...s, lastFailureAt: nowIso(), lastError: message(error ?? "失敗"), consecutiveFailures: failures }));
}

export function readJobState(job: string): Promise<JobState | undefined> {
  return readJson<JobState>(JOB_KEY_PREFIX + job);
}

export function readIntegrationState(name: IntegrationName): Promise<IntegrationState | undefined> {
  return readJson<IntegrationState>(INTEGRATION_KEY_PREFIX + name);
}
