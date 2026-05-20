import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, CheckCircle, AlertTriangle, XCircle, Clock, Activity, Database, Radio } from "lucide-react";

interface Metrics {
  timestamp: string;
  uptimeSeconds: number;
  requestsLast60s: number;
  errorsLast60s: number;
  errorRateLast60s: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  memoryMb: { rss: number; heapUsed: number; heapTotal: number };
}

interface ServiceProbe {
  name: string;
  status: "ok" | "degraded" | "down";
  latencyMs: number | null;
  checkedAt: number;
  error?: string;
}

interface SystemStatus {
  overall: string;
  uptimeSeconds: number;
  timestamp: string;
  services: ServiceProbe[];
}

interface InternalApiStat {
  endpoint: string;
  callCount: number;
  errorCount: number;
  avgLatencyMs: number;
  errorRate: number;
  lastCalledAtIso: string | null;
}

interface AppLogRow {
  id: number;
  timestamp: string;
  level: string;
  module: string | null;
  action: string | null;
  requestId: string | null;
  route: string | null;
  statusCode: number | null;
  durationMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  message: string;
}

interface UserErrorRow {
  id: number;
  timestamp: string;
  requestId: string | null;
  userId: string | null;
  userRole: string | null;
  action: string | null;
  errorCode: string | null;
  messageShown: string | null;
  route: string | null;
}

interface AuditLogRow {
  id: number;
  timestamp: string;
  requestId: string | null;
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  message: string;
}

function StatusDot({ status }: { status: string }) {
  if (status === "ok") return <CheckCircle className="h-4 w-4 text-green-500" />;
  if (status === "degraded") return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
  return <XCircle className="h-4 w-4 text-red-500" />;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "ok") return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">正常</Badge>;
  if (status === "degraded") return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">異常</Badge>;
  return <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">中斷</Badge>;
}

function formatUptime(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}天 ${h}小時`;
  if (h > 0) return `${h}小時 ${m}分`;
  return `${m}分鐘`;
}

function formatTs(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function ObservabilityPage() {
  const [ridSearch, setRidSearch] = useState("");
  const [errorFilter, setErrorFilter] = useState("all");
  const [tab, setTab] = useState("overview");

  const metricsQuery = useQuery<Metrics>({
    queryKey: ["/api/system/metrics"],
    refetchInterval: 30_000,
  });

  const statusQuery = useQuery<SystemStatus>({
    queryKey: ["/api/system/status"],
    refetchInterval: 30_000,
  });

  const internalQuery = useQuery<{ endpoints: InternalApiStat[] }>({
    queryKey: ["/api/system/metrics/internal-api"],
    refetchInterval: 30_000,
  });

  const errorsQuery = useQuery<{ logs: AppLogRow[] }>({
    queryKey: ["/api/system/errors", ridSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "100" });
      if (ridSearch) params.set("request_id", ridSearch);
      const res = await fetch(`/api/system/errors?${params}`);
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const userErrorsQuery = useQuery<{ events: UserErrorRow[] }>({
    queryKey: ["/api/system/user-errors"],
    refetchInterval: 30_000,
  });

  const auditQuery = useQuery<{ logs: AuditLogRow[] }>({
    queryKey: ["/api/system/audit-logs"],
    refetchInterval: 60_000,
  });

  const m = metricsQuery.data;
  const s = statusQuery.data;
  const isLoading = metricsQuery.isLoading || statusQuery.isLoading;

  const filteredErrors = (errorsQuery.data?.logs ?? []).filter((l) => {
    if (errorFilter === "all") return true;
    return l.level === errorFilter;
  });

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" data-testid="text-page-title">IT 監控</h1>
          <p className="text-sm text-muted-foreground">系統健康、請求指標、錯誤追蹤</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          data-testid="button-refresh-metrics"
          onClick={() => {
            metricsQuery.refetch();
            statusQuery.refetch();
            internalQuery.refetch();
            errorsQuery.refetch();
            userErrorsQuery.refetch();
            auditQuery.refetch();
          }}
        >
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          重新整理
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview" data-testid="tab-overview">總覽</TabsTrigger>
          <TabsTrigger value="services" data-testid="tab-services">外部服務</TabsTrigger>
          <TabsTrigger value="internal-api" data-testid="tab-internal-api">Internal API</TabsTrigger>
          <TabsTrigger value="errors" data-testid="tab-errors">
            錯誤日誌
            {(errorsQuery.data?.logs.length ?? 0) > 0 && (
              <span className="ml-1.5 text-[10px] bg-red-500 text-white rounded-full px-1.5 min-w-[18px] text-center">
                {errorsQuery.data!.logs.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="user-errors" data-testid="tab-user-errors">使用者錯誤</TabsTrigger>
          <TabsTrigger value="audit" data-testid="tab-audit">稽核軌跡</TabsTrigger>
        </TabsList>

        {/* ── 總覽 ── */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          {isLoading ? (
            <div className="text-sm text-muted-foreground">載入中…</div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <Activity className="h-4 w-4 text-blue-500" />
                      <span className="text-xs text-muted-foreground">系統狀態</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusDot status={s?.overall ?? "ok"} />
                      <span className="font-semibold text-sm" data-testid="text-system-status">
                        {s?.overall === "ok" ? "正常運行" : "部分異常"}
                      </span>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <Clock className="h-4 w-4 text-purple-500" />
                      <span className="text-xs text-muted-foreground">運行時間</span>
                    </div>
                    <div className="font-semibold text-sm" data-testid="text-uptime">
                      {m ? formatUptime(m.uptimeSeconds) : "—"}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <Radio className="h-4 w-4 text-green-500" />
                      <span className="text-xs text-muted-foreground">近60秒請求</span>
                    </div>
                    <div className="font-semibold text-sm" data-testid="text-requests-60s">
                      {m?.requestsLast60s ?? "—"}
                      {m && <span className="text-xs text-muted-foreground ml-1">筆</span>}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle className="h-4 w-4 text-red-500" />
                      <span className="text-xs text-muted-foreground">近60秒錯誤</span>
                    </div>
                    <div className="font-semibold text-sm" data-testid="text-errors-60s">
                      {m?.errorsLast60s ?? "—"}
                      {m && <span className="text-xs text-muted-foreground ml-1">筆</span>}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">平均延遲</p>
                    <p className="font-semibold" data-testid="text-avg-latency">{m ? `${m.avgLatencyMs} ms` : "—"}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">P95 延遲</p>
                    <p className="font-semibold" data-testid="text-p95-latency">{m ? `${m.p95LatencyMs} ms` : "—"}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">記憶體用量</p>
                    <p className="font-semibold" data-testid="text-memory">
                      {m ? `${m.memoryMb.heapUsed} / ${m.memoryMb.heapTotal} MB` : "—"}
                    </p>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>

        {/* ── 外部服務 ── */}
        <TabsContent value="services" className="mt-4">
          {statusQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">探測中…</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(s?.services ?? []).map((svc) => (
                <Card key={svc.name} data-testid={`card-service-${svc.name}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Database className="h-4 w-4 text-muted-foreground" />
                        {svc.name === "db" ? "資料庫" : svc.name === "line" ? "LINE API" : "Ragic"}
                      </CardTitle>
                      <StatusBadge status={svc.status} />
                    </div>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground space-y-1">
                    <p>延遲：{svc.latencyMs != null ? `${svc.latencyMs} ms` : "—"}</p>
                    <p>檢查時間：{formatTs(new Date(svc.checkedAt).toISOString())}</p>
                    {svc.error && <p className="text-red-500">錯誤：{svc.error}</p>}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Internal API ── */}
        <TabsContent value="internal-api" className="mt-4">
          {internalQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">載入中…</div>
          ) : (internalQuery.data?.endpoints.length ?? 0) === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">尚無外部呼叫記錄</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left py-2 pr-4">端點</th>
                    <th className="text-right py-2 px-2">呼叫次數</th>
                    <th className="text-right py-2 px-2">錯誤次數</th>
                    <th className="text-right py-2 px-2">平均延遲</th>
                    <th className="text-right py-2 pl-2">最後呼叫</th>
                  </tr>
                </thead>
                <tbody>
                  {(internalQuery.data?.endpoints ?? []).map((ep) => (
                    <tr key={ep.endpoint} className="border-b hover:bg-muted/30" data-testid={`row-internal-${ep.endpoint}`}>
                      <td className="py-2 pr-4 font-mono text-xs">{ep.endpoint}</td>
                      <td className="text-right py-2 px-2">{ep.callCount}</td>
                      <td className="text-right py-2 px-2">
                        {ep.errorCount > 0
                          ? <span className="text-red-500">{ep.errorCount}</span>
                          : <span className="text-muted-foreground">0</span>}
                      </td>
                      <td className="text-right py-2 px-2">{ep.avgLatencyMs} ms</td>
                      <td className="text-right py-2 pl-2 text-muted-foreground">{formatTs(ep.lastCalledAtIso)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* ── 錯誤日誌 ── */}
        <TabsContent value="errors" className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="搜尋 request_id…"
              className="w-56 h-8 text-sm"
              value={ridSearch}
              onChange={(e) => setRidSearch(e.target.value)}
              data-testid="input-request-id-search"
            />
            <Select value={errorFilter} onValueChange={setErrorFilter}>
              <SelectTrigger className="w-28 h-8 text-sm" data-testid="select-error-level">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="error">error</SelectItem>
                <SelectItem value="warn">warn</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {errorsQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">載入中…</div>
          ) : filteredErrors.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">沒有符合的錯誤記錄</div>
          ) : (
            <div className="space-y-1">
              {filteredErrors.map((log) => (
                <div
                  key={log.id}
                  className="border rounded-lg p-3 text-sm space-y-1 hover:bg-muted/20"
                  data-testid={`card-error-log-${log.id}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={log.level === "error" ? "destructive" : "outline"} className="text-xs">
                      {log.level}
                    </Badge>
                    {log.module && <span className="text-muted-foreground text-xs">[{log.module}]</span>}
                    {log.errorCode && <code className="text-xs bg-muted px-1 rounded">{log.errorCode}</code>}
                    <span className="text-xs text-muted-foreground ml-auto">{formatTs(log.timestamp)}</span>
                  </div>
                  <p className="font-medium">{log.message}</p>
                  {(log.route || log.requestId) && (
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      {log.route && <span>{log.route}</span>}
                      {log.statusCode && <span>HTTP {log.statusCode}</span>}
                      {log.durationMs != null && <span>{log.durationMs}ms</span>}
                      {log.requestId && (
                        <span className="font-mono">{log.requestId}</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── 使用者錯誤 ── */}
        <TabsContent value="user-errors" className="mt-4">
          {userErrorsQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">載入中…</div>
          ) : (userErrorsQuery.data?.events.length ?? 0) === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">尚無使用者錯誤事件</div>
          ) : (
            <div className="space-y-1">
              {(userErrorsQuery.data?.events ?? []).map((ev) => (
                <div
                  key={ev.id}
                  className="border rounded-lg p-3 text-sm space-y-1 hover:bg-muted/20"
                  data-testid={`card-user-error-${ev.id}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {ev.userRole && <Badge variant="outline" className="text-xs">{ev.userRole}</Badge>}
                    {ev.errorCode && <code className="text-xs bg-muted px-1 rounded">{ev.errorCode}</code>}
                    <span className="text-xs text-muted-foreground ml-auto">{formatTs(ev.timestamp)}</span>
                  </div>
                  {ev.messageShown && <p className="font-medium">{ev.messageShown}</p>}
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    {ev.userId && <span>User: {ev.userId}</span>}
                    {ev.action && <span>動作: {ev.action}</span>}
                    {ev.route && <span>{ev.route}</span>}
                    {ev.requestId && <span className="font-mono">{ev.requestId}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── 稽核軌跡 ── */}
        <TabsContent value="audit" className="mt-4">
          {auditQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">載入中…</div>
          ) : (auditQuery.data?.logs.length ?? 0) === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">尚無稽核記錄</div>
          ) : (
            <div className="space-y-1">
              {(auditQuery.data?.logs ?? []).map((al) => (
                <div
                  key={al.id}
                  className="border rounded-lg p-3 text-sm space-y-1 hover:bg-muted/20"
                  data-testid={`card-audit-log-${al.id}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="text-xs">{al.action}</Badge>
                    {al.targetType && <span className="text-xs text-muted-foreground">{al.targetType} #{al.targetId}</span>}
                    <span className="text-xs text-muted-foreground ml-auto">{formatTs(al.timestamp)}</span>
                  </div>
                  <p className="text-muted-foreground">{al.message}</p>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    {al.actorUserId && <span>執行者: {al.actorUserId}</span>}
                    {al.actorRole && <span>[{al.actorRole}]</span>}
                    {al.requestId && <span className="font-mono">{al.requestId}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
