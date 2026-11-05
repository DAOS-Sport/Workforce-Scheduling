import { Activity, AlertTriangle, CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ago,
  apiPipeline,
  formatTaipei,
  groupPipelines,
  LEVEL_LABEL,
  recoveredAt,
  worstLevel,
  type HealthReport,
  type Level,
  type Pipeline,
} from "@/lib/health-view";

/** 一條失敗紀錄對到的請求編號。錯誤落表上線後由頁面傳進來，這裡只負責顯示。 */
export interface ErrorRef {
  requestId: string;
}

const LEVEL_STYLE: Record<Level, { dot: string; badge: string; Icon: typeof CheckCircle2 }> = {
  green: { dot: "bg-green-500", badge: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300", Icon: CheckCircle2 },
  yellow: { dot: "bg-amber-500", badge: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300", Icon: AlertTriangle },
  red: { dot: "bg-red-500", badge: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300", Icon: XCircle },
};

function Light({ level, testId }: { level: Level; testId: string }) {
  const { dot, badge, Icon } = LEVEL_STYLE[level];
  return (
    <span className="flex items-center gap-2 shrink-0" data-testid={testId} data-level={level}>
      <span className={`h-3 w-3 rounded-full ${dot}`} aria-hidden="true" />
      <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ${badge}`}>
        <Icon className="h-3 w-3" aria-hidden="true" />
        {LEVEL_LABEL[level]}
      </span>
    </span>
  );
}

function TimeLine({ label, iso, now, testId }: { label: string; iso: string | null; now: Date; testId: string }) {
  return (
    <div className="flex flex-wrap gap-x-2" data-testid={testId}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium break-words">
        {iso ? (
          <>
            <time dateTime={iso}>{formatTaipei(iso)}</time>
            <span className="ml-1 text-muted-foreground font-normal">{ago(iso, now)}</span>
          </>
        ) : (
          "—"
        )}
      </dd>
    </div>
  );
}

function PipelineCard({ pipeline: p, now, errorRef }: { pipeline: Pipeline; now: Date; errorRef?: ErrorRef }) {
  const recovered = recoveredAt(p);
  return (
    <li className="rounded-lg border bg-card p-3 space-y-2 min-w-0" data-testid={`pipeline-${p.id}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold leading-tight min-w-0 break-words">{p.name}</h3>
        <Light level={p.level} testId={`light-${p.id}`} />
      </div>
      <p className="text-xs text-muted-foreground break-words" data-testid={`reason-${p.id}`}>{p.reason}</p>
      <dl className="text-xs space-y-0.5">
        <TimeLine label="最後成功" iso={p.lastSuccessAt} now={now} testId={`last-success-${p.id}`} />
        {p.lastFailureAt && <TimeLine label="最近錯誤" iso={p.lastFailureAt} now={now} testId={`last-failure-${p.id}`} />}
        {p.lastFailureAt && recovered && <TimeLine label="恢復時間" iso={recovered} now={now} testId={`recovered-${p.id}`} />}
        {errorRef && (
          <div className="flex flex-wrap gap-x-2" data-testid={`request-id-${p.id}`}>
            <dt className="text-muted-foreground">request ID</dt>
            <dd className="font-mono break-all">{errorRef.requestId}</dd>
          </div>
        )}
      </dl>
    </li>
  );
}

export interface HealthMonitorProps {
  report: HealthReport | null;
  /** 取得報告失敗時的訊息；有值就表示這一輪失敗。 */
  error: string | null;
  fetchedAt: string | null;
  failedAt: string | null;
  /** 失敗之後第一次取報告成功的時間。 */
  apiRecoveredAt?: string | null;
  now: Date;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** 管線 id 對到最近一次失敗的請求編號（錯誤落表工單合併後接上）。 */
  errorRefs?: Record<string, ErrorRef | undefined>;
}

export function HealthMonitor({ report, error, fetchedAt, failedAt, apiRecoveredAt, now, refreshing, onRefresh, errorRefs }: HealthMonitorProps) {
  const api = apiPipeline({ report, error, fetchedAt, failedAt, recoveredAt: apiRecoveredAt });
  const pipelines = [api, ...(report?.pipelines ?? [])];
  const overall = worstLevel(pipelines.map((p) => p.level));
  const counts = { red: 0, yellow: 0, green: 0 } as Record<Level, number>;
  for (const p of pipelines) counts[p.level] += 1;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="h-5 w-5" aria-hidden="true" />
            IT 監控
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">API、資料庫、外部依賴與排程的狀態，每 60 秒自動更新</p>
        </div>
        {onRefresh && (
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing} data-testid="button-refresh-health">
            <RefreshCw className={`h-4 w-4 mr-1.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
            立即更新
          </Button>
        )}
      </div>

      <div className="rounded-lg border bg-card p-3 flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="health-summary">
        <Light level={overall} testId="light-overall" />
        <span className="text-sm" data-testid="text-health-counts">
          異常 {counts.red}・注意 {counts.yellow}・正常 {counts.green}
        </span>
        <span className="text-xs text-muted-foreground break-words" data-testid="text-health-checked">
          {report ? `報告時間 ${formatTaipei(report.checkedAt)}・版本 ${report.build}` : "尚未取得報告"}
        </span>
      </div>

      {groupPipelines(pipelines).map((group) =>
        group.items.length === 0 ? null : (
          <section key={group.key} className="space-y-2" data-testid={`group-${group.key}`}>
            <h2 className="text-sm font-semibold text-muted-foreground">{group.title}</h2>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {group.items.map((p) => (
                <PipelineCard key={p.id} pipeline={p} now={now} errorRef={errorRefs?.[p.id]} />
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}
