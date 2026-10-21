/**
 * Ragic 的唯一對外出口（H01 員工表）。只負責傳輸與分頁，不含業務規則、不寫資料庫。
 */

import { recordIntegration } from "../shared/health/healthState";

export const RAGIC_API_URL = "https://ap7.ragic.com/xinsheng/ragicforms4/20004";
export const PAGE_SIZE = 1000;
export const MAX_RETRIES = 3;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, headers: Record<string, string>): Promise<Record<string, any>> {
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(`Ragic HTTP ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      recordIntegration("ragic", true);
      return data as Record<string, any>;
    } catch (err: any) {
      lastErr = err;
      console.warn(`[ragic] 第 ${attempt} 次請求失敗: ${err.message}，${attempt < MAX_RETRIES ? `等待 ${attempt * 2}s 後重試...` : "已達最大重試次數"}`);
      if (attempt < MAX_RETRIES) {
        await sleep(attempt * 2000);
      }
    }
  }
  recordIntegration("ragic", false, lastErr);
  throw lastErr ?? new Error("fetchWithRetry: unknown error");
}

export async function fetchAllRagicRecords(apiKey: string): Promise<Record<string, any>> {
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
    const url = `${RAGIC_API_URL}?${params.toString()}`;
    console.log(`[ragic] 拉取第 ${page} 頁 (offset=${offset}, limit=${PAGE_SIZE})...`);

    const data = await fetchWithRetry(url, headers);

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
    await sleep(300);
  }

  return allRecords;
}
