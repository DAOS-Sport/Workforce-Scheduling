/**
 * 後台「IT 監控」頁的顯示邏輯：把 health-v1 報告分組、算恢復時間、格式化台北時間。
 * 全是純函式，輸入報告與「現在」，輸出畫面要的東西，方便不開瀏覽器就測。
 */
import type { HealthReport, Level, Pipeline } from "../../../server/core/health/types";

export type { HealthReport, Level, Pipeline };

export type GroupKey = "app" | "database" | "external" | "jobs";

export const GROUPS: ReadonlyArray<{ key: GroupKey; title: string }> = [
  { key: "app", title: "應用程式" },
  { key: "database", title: "資料庫" },
  { key: "external", title: "外部依賴" },
  { key: "jobs", title: "排程" },
];

export const LEVEL_LABEL: Record<Level, string> = { green: "正常", yellow: "注意", red: "異常" };

const RANK: Record<Level, number> = { green: 0, yellow: 1, red: 2 };

export function worstLevel(levels: Level[]): Level {
  return levels.reduce<Level>((acc, l) => (RANK[l] > RANK[acc] ? l : acc), "green");
}

/** 管線 id 對到畫面分組。沒見過的 id 歸「應用程式」，新增管線不用改這裡也會顯示。 */
export function groupOf(id: string): GroupKey {
  if (id === "database") return "database";
  if (id.startsWith("integration.") || id.startsWith("ragic.")) return "external";
  if (id.startsWith("push.") || id.startsWith("report.")) return "jobs";
  return "app";
}

/** 同一組內先放最嚴重的，同級維持報告原本的順序。 */
export function groupPipelines(pipelines: Pipeline[]): Array<{ key: GroupKey; title: string; items: Pipeline[] }> {
  return GROUPS.map((g) => ({
    ...g,
    items: pipelines
      .map((p, index) => ({ p, index }))
      .filter(({ p }) => groupOf(p.id) === g.key)
      .sort((a, b) => RANK[b.p.level] - RANK[a.p.level] || a.index - b.index)
      .map(({ p }) => p),
  }));
}

/**
 * 恢復時間：伺服器在失敗後第一次成功時蓋的章（recoveredAt）。只有它晚於最近一次失敗才算，
 * 沒有失敗紀錄、章還是上一次故障的、或舊資料沒有這個欄位，都回 null。
 */
export function recoveredAt(p: Pick<Pipeline, "lastFailureAt" | "recoveredAt">): string | null {
  if (!p.recoveredAt || !p.lastFailureAt) return null;
  return Date.parse(p.recoveredAt) > Date.parse(p.lastFailureAt) ? p.recoveredAt : null;
}

const taipeiParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** `2026-11-03 14:05`（台北時間）；不是合法時間就原樣回傳。 */
export function formatTaipei(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const parts = Object.fromEntries(taipeiParts.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/** 距離現在多久，例如「5 分鐘前」。未來的時間（時鐘誤差）算「剛剛」。 */
export function ago(iso: string | null | undefined, now: Date): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const minutes = Math.floor((now.getTime() - t) / 60_000);
  if (minutes < 1) return "剛剛";
  if (minutes < 60) return `${minutes} 分鐘前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} 小時前`;
  return `${Math.floor(hours / 24)} 天前`;
}

/** 「API」這一列：這頁自己取報告的結果。取得失敗就是紅燈，不靠報告內容。 */
export function apiPipeline(input: {
  report: HealthReport | null;
  error: string | null;
  fetchedAt: string | null;
  failedAt: string | null;
  /** 失敗之後第一次取報告成功的時間（頁面自己記）。 */
  recoveredAt?: string | null;
}): Pipeline {
  const { report, error, fetchedAt, failedAt } = input;
  if (error) {
    return {
      id: "api",
      name: "API",
      level: "red",
      reason: `無法取得健康報告：${error}`,
      lastSuccessAt: fetchedAt,
      lastFailureAt: failedAt,
      source: "GET /api/admin/health",
    };
  }
  return {
    id: "api",
    name: "API",
    level: report ? "green" : "yellow",
    reason: report ? `回應正常，報告時間 ${formatTaipei(report.checkedAt)}` : "正在取得健康報告",
    lastSuccessAt: fetchedAt,
    lastFailureAt: failedAt,
    ...(input.recoveredAt ? { recoveredAt: input.recoveredAt } : {}),
    source: "GET /api/admin/health",
  };
}
