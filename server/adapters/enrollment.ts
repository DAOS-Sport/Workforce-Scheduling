/**
 * 報名系統（暑假課程人數）的唯一對外出口。外部 API 一次回全部梯次，不接受梯次過濾。
 * 回傳原始回應，由呼叫端判斷內容型別與錯誤。
 */
import { recordIntegration } from "../shared/health/healthState";

export async function fetchEnrollmentCounts(apiUrl: string, apiKey: string): Promise<Response> {
  const url = new URL(apiUrl);
  url.searchParams.set("includeZero", "true");
  try {
    const res = await fetch(url.toString(), {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(10000),
    });
    recordIntegration("enrollment", res.ok, res.ok ? undefined : `HTTP ${res.status}`);
    return res;
  } catch (err) {
    recordIntegration("enrollment", false, err);
    throw err;
  }
}
