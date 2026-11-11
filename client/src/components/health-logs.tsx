import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatTaipei, type HealthReport } from "@/lib/health-view";
import type { HealthLogEntry } from "../../../server/core/health/types";

interface LogPage {
  logs: HealthLogEntry[];
  nextCursor: string | null;
}

function localInput(iso: string): string {
  const date = new Date(new Date(iso).getTime() - 24 * 60 * 60 * 1000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

const LEVEL_LABEL = { info: "資訊", warn: "警告", error: "錯誤" };
const controlStyle = "h-9 rounded-md border bg-background px-2 text-sm min-w-0";

export function HealthLogs({ report }: { report: HealthReport }) {
  const [pipeline, setPipeline] = useState("");
  const [since, setSince] = useState(() => localInput(report.checkedAt));
  const [level, setLevel] = useState("warn");
  const [page, setPage] = useState<LogPage | null>(null);
  const [activeQuery, setActiveQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logs = page?.logs ?? report.pipelines.flatMap((item) => item.logs ?? []).sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id);
  const unavailable = page ? [] : report.pipelines.filter((item) => item.logsError);

  async function load(more = false) {
    const params = more ? new URLSearchParams(activeQuery) : new URLSearchParams({ level, limit: "50" });
    if (!more) {
      if (pipeline) params.set("pipeline", pipeline);
      if (since) params.set("since", new Date(since).toISOString());
    } else if (page?.nextCursor) params.set("cursor", page.nextCursor);
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/health/logs?${params}`, { credentials: "same-origin" });
      if (!response.ok) throw new Error();
      const next = await response.json() as LogPage;
      setPage({ logs: more ? [...(page?.logs ?? []), ...next.logs] : next.logs, nextCursor: next.nextCursor });
      if (!more) setActiveQuery(params.toString());
    } catch {
      setError("無法讀取日誌，請稍後再試");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mt-6 space-y-3 rounded-lg border bg-card p-4" aria-labelledby="health-logs-title">
      <div>
        <h2 id="health-logs-title" className="font-semibold">管線日誌</h2>
        <p className="text-xs text-muted-foreground mt-1">{page ? "依條件查詢的日誌" : "最近 24 小時，每條管線最多 20 筆警告與錯誤"}</p>
      </div>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); void load(); }}>
        <label className="flex flex-col gap-1 text-xs">管線
          <select aria-label="管線" className={controlStyle} value={pipeline} onChange={(event) => setPipeline(event.target.value)}>
            <option value="">全部管線</option>
            {report.pipelines.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">起始時間（本機時間）
          <input aria-label="起始時間（本機時間）" type="datetime-local" className={controlStyle} value={since} onChange={(event) => setSince(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs">等級
          <select aria-label="等級" className={controlStyle} value={level} onChange={(event) => setLevel(event.target.value)}>
            <option value="info">資訊以上</option>
            <option value="warn">警告以上</option>
            <option value="error">錯誤</option>
          </select>
        </label>
        <Button type="submit" size="sm" variant="outline" disabled={loading}>查詢日誌</Button>
      </form>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {unavailable.map((item) => <p key={item.id} className="text-sm text-amber-700">{item.name}：{item.logsError}</p>)}
      {logs.length ? (
        <ul className="space-y-2" aria-label="日誌紀錄">
          {logs.map((entry) => (
            <li key={entry.id} className="min-w-0 rounded-md border p-3 text-xs space-y-1">
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                <time dateTime={entry.at}>{formatTaipei(entry.at)}</time>
                <span>{LEVEL_LABEL[entry.level]}</span>
                <span className="break-all">{entry.pipeline}</span>
                {entry.requestId && <span className="font-mono break-all">{entry.requestId}</span>}
              </div>
              <p className="whitespace-pre-wrap break-words">{entry.message}</p>
            </li>
          ))}
        </ul>
      ) : !unavailable.length && !error && <p className="text-sm text-muted-foreground">沒有符合條件的日誌</p>}
      {page?.nextCursor && <Button variant="outline" size="sm" disabled={loading} onClick={() => void load(true)}>載入更多</Button>}
      {loading && <p role="status" className="text-xs text-muted-foreground">正在讀取日誌…</p>}
    </section>
  );
}
