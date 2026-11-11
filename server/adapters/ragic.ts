/**
 * Ragic 的唯一對外出口（H01／H02 員工表）。只負責傳輸與分頁，不含業務規則、不寫資料庫。
 *
 * 每次請求有逾時（涵蓋等標頭與讀內容），只有逾時、網路錯誤、429、5xx 會重試；
 * 其他 4xx（例如金鑰錯誤）重試也不會好，直接停（GitHub #1）。
 */

import { recordIntegration } from "../shared/health/healthState";

export const RAGIC_API_URL = "https://ap7.ragic.com/xinsheng/ragicforms4/20004";
export const RAGIC_H02_API_URL = "https://ap7.ragic.com/xinsheng/ragicforms4/13";
export const PAGE_SIZE = 1000;
export const MAX_RETRIES = 3;
export const ATTEMPT_TIMEOUT_MS = 30_000;

export interface RagicFetchOptions {
  baseUrl?: string;
  attemptTimeoutMs?: number;
  maxRetries?: number;
  /** 第 n 次失敗後要等多久再重試 */
  backoffMs?: (attempt: number) => number;
  pageDelayMs?: number;
}

const DEFAULTS: Required<RagicFetchOptions> = {
  baseUrl: RAGIC_API_URL,
  attemptTimeoutMs: ATTEMPT_TIMEOUT_MS,
  maxRetries: MAX_RETRIES,
  backoffMs: (attempt) => attempt * 2000,
  pageDelayMs: 300,
};

export class RagicHttpError extends Error {
  constructor(readonly status: number, statusText: string) {
    super(`Ragic HTTP ${status} ${statusText}`);
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(err: unknown): boolean {
  if (err instanceof RagicHttpError) return err.status === 429 || err.status >= 500;
  return true;
}

function describe(err: any, timeoutMs: number): string {
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return `逾時（超過 ${timeoutMs / 1000} 秒）`;
  return err?.message ?? String(err);
}

async function fetchWithRetry(url: string, headers: Record<string, string>, opts: Required<RagicFetchOptions>): Promise<Record<string, any>> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= opts.maxRetries; attempt++) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(opts.attemptTimeoutMs) });
      if (!response.ok) throw new RagicHttpError(response.status, response.statusText);
      const data = await response.json();
      recordIntegration("ragic", true);
      return data as Record<string, any>;
    } catch (err) {
      lastErr = err;
      const retry = isRetryable(err) && attempt < opts.maxRetries;
      const wait = opts.backoffMs(attempt);
      const next = retry ? `等待 ${wait / 1000}s 後重試...` : isRetryable(err) ? "已達最大重試次數" : "這種錯誤重試也不會好，停止";
      console.warn(`[ragic] 第 ${attempt} 次請求失敗: ${describe(err, opts.attemptTimeoutMs)}，${next}`);
      if (!retry) break;
      await sleep(wait);
    }
  }
  recordIntegration("ragic", false, lastErr);
  throw lastErr ?? new Error("fetchWithRetry: unknown error");
}

export async function fetchAllRagicRecords(apiKey: string, options: RagicFetchOptions = {}): Promise<Record<string, any>> {
  const opts = { ...DEFAULTS, ...options };
  const headers = {
    Authorization: `Basic ${apiKey}`,
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };

  const allRecords: Record<string, any> = {};
  let offset = 0;
  let page = 1;

  while (true) {
    const params = new URLSearchParams({
      v: "3",
      limit: String(PAGE_SIZE),
      offset: String(offset),
      _: String(Date.now()),
    });
    const url = `${opts.baseUrl}?${params.toString()}`;
    console.log(`[ragic] 拉取第 ${page} 頁 (offset=${offset}, limit=${PAGE_SIZE})...`);

    const data = await fetchWithRetry(url, headers, opts);

    const entries = Object.entries(data).filter(([k]) => !k.startsWith("@"));
    if (entries.length === 0) {
      console.log(`[ragic] 第 ${page} 頁無資料，停止分頁`);
      break;
    }

    for (const [k, v] of entries) {
      allRecords[k] = v;
    }

    console.log(`[ragic] 第 ${page} 頁取得 ${entries.length} 筆，累計 ${Object.keys(allRecords).length} 筆`);

    if (entries.length < PAGE_SIZE) {
      console.log(`[ragic] 最後一頁（筆數 ${entries.length} < ${PAGE_SIZE}），完成拉取`);
      break;
    }

    offset += PAGE_SIZE;
    page++;
    await sleep(opts.pageDelayMs);
  }

  return allRecords;
}

export function fetchH02RagicRecords(apiKey: string): Promise<Record<string, any>> {
  return fetchAllRagicRecords(apiKey, { baseUrl: RAGIC_H02_API_URL });
}
