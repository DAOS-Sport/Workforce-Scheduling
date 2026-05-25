import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { CheckCircle2, XCircle, AlertTriangle, RefreshCw, MapPin, Activity } from "lucide-react";

interface ClockLogRow {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  venueId: number | null;
  shiftId: number | null;
  clockType: string;
  latitude: number;
  longitude: number;
  distance: number | null;
  status: string;
  failReason: string | null;
  clockTime: string;
  matchedVenueName: string | null;
  accuracy: number | null;
  accuracyBufferApplied: boolean | null;
  suspiciousLocation: boolean | null;
  gpsCapturedAt: string | null;
}

const statusMeta: Record<string, { label: string; cls: string; icon: any }> = {
  success: { label: "成功", cls: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
  warning: { label: "警告", cls: "bg-amber-100 text-amber-700 border-amber-200", icon: AlertTriangle },
  fail: { label: "失敗", cls: "bg-rose-100 text-rose-700 border-rose-200", icon: XCircle },
};

function fmtTime(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export default function ClockLogsPage() {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery<ClockLogRow[]>({
    queryKey: ["/api/clock-logs/today"],
    refetchInterval: autoRefresh ? 5000 : false,
    refetchOnWindowFocus: true,
  });

  const rows = useMemo(() => {
    let r = data || [];
    if (statusFilter !== "all") r = r.filter((x) => x.status === statusFilter);
    if (typeFilter !== "all") r = r.filter((x) => x.clockType === typeFilter);
    return r;
  }, [data, statusFilter, typeFilter]);

  const counts = useMemo(() => {
    const c = { total: data?.length || 0, success: 0, warning: 0, fail: 0 };
    for (const r of data || []) {
      if (r.status === "success") c.success++;
      else if (r.status === "warning") c.warning++;
      else if (r.status === "fail") c.fail++;
    }
    return c;
  }, [data]);

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }) : "—";

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4" data-testid="page-clock-logs">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-blue-600" />
                打卡即時日誌
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                今日所有打卡嘗試（含成功 / 警告 / 失敗），最新在上。最後更新 {lastUpdated}
                {isFetching && <span className="ml-2 text-blue-500">更新中…</span>}
              </p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Switch
                  id="auto-refresh"
                  checked={autoRefresh}
                  onCheckedChange={setAutoRefresh}
                  data-testid="switch-auto-refresh"
                />
                <Label htmlFor="auto-refresh" className="text-xs cursor-pointer">自動更新 (5 秒)</Label>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => refetch()}
                data-testid="button-refresh-logs"
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`} />
                重新整理
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2 mt-4">
            <StatBox label="總嘗試" value={counts.total} cls="bg-slate-100 text-slate-700" />
            <StatBox label="成功" value={counts.success} cls="bg-emerald-100 text-emerald-700" />
            <StatBox label="警告" value={counts.warning} cls="bg-amber-100 text-amber-700" />
            <StatBox label="失敗" value={counts.fail} cls="bg-rose-100 text-rose-700" />
          </div>

          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <Label className="text-xs text-muted-foreground">狀態</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-28 text-xs" data-testid="select-status-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="success">成功</SelectItem>
                <SelectItem value="warning">警告</SelectItem>
                <SelectItem value="fail">失敗</SelectItem>
              </SelectContent>
            </Select>
            <Label className="text-xs text-muted-foreground ml-2">類型</Label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-8 w-28 text-xs" data-testid="select-type-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="in">上班</SelectItem>
                <SelectItem value="out">下班</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[calc(100vh-340px)] min-h-[400px]">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground text-sm">載入中…</div>
            ) : rows.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm" data-testid="text-empty-logs">
                今日尚無符合條件的打卡記錄
              </div>
            ) : (
              <div className="divide-y">
                {rows.map((r) => {
                  const meta = statusMeta[r.status] || statusMeta.fail;
                  const Icon = meta.icon;
                  return (
                    <div
                      key={r.id}
                      className="px-4 py-3 hover:bg-slate-50 grid grid-cols-12 gap-2 items-start text-sm"
                      data-testid={`row-clock-log-${r.id}`}
                    >
                      <div className="col-span-2 font-mono text-xs text-slate-500">
                        {fmtTime(r.clockTime)}
                      </div>
                      <div className="col-span-2">
                        <div className="font-medium text-slate-900">{r.employeeName}</div>
                        <div className="text-xs text-slate-400">{r.employeeCode}</div>
                      </div>
                      <div className="col-span-1">
                        <Badge variant="outline" className={r.clockType === "in" ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"}>
                          {r.clockType === "in" ? "上班" : "下班"}
                        </Badge>
                      </div>
                      <div className="col-span-1">
                        <Badge variant="outline" className={meta.cls}>
                          <Icon className="h-3 w-3 mr-0.5" />
                          {meta.label}
                        </Badge>
                      </div>
                      <div className="col-span-2 text-xs">
                        <div className="text-slate-700">{r.matchedVenueName || "—"}</div>
                        <div className="text-slate-400 flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {r.distance != null ? `${r.distance}m` : "—"}
                          {r.accuracy != null && <span className="text-slate-300">±{Math.round(r.accuracy)}m</span>}
                        </div>
                        <div className="flex gap-1 mt-0.5 flex-wrap">
                          {r.accuracyBufferApplied && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0 bg-sky-50 text-sky-700 border-sky-200" data-testid={`badge-buffer-${r.id}`}>套精度</Badge>
                          )}
                          {r.suspiciousLocation && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0 bg-amber-50 text-amber-700 border-amber-200" data-testid={`badge-suspicious-${r.id}`}>可疑位置</Badge>
                          )}
                        </div>
                      </div>
                      <div className="col-span-3 text-xs text-slate-600">
                        {r.failReason ? (
                          <span className={r.status === "fail" ? "text-rose-600 font-medium" : r.status === "warning" ? "text-amber-700" : "text-slate-500"}>
                            {r.failReason}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </div>
                      <div className="col-span-1 text-[10px] font-mono text-slate-400 text-right">
                        #{r.id}
                        <div>{r.latitude.toFixed(4)},{r.longitude.toFixed(4)}</div>
                        {r.gpsCapturedAt && (() => {
                          const latencyMs = new Date(r.clockTime).getTime() - new Date(r.gpsCapturedAt).getTime();
                          if (!isFinite(latencyMs)) return null;
                          const latencyS = Math.round(latencyMs / 1000);
                          const cls = latencyS > 60 ? "text-amber-600" : "text-slate-400";
                          return (
                            <div className={cls} title="GPS 取得時刻 → 送出時刻延遲">Δ{latencyS}s</div>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

function StatBox({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className={`rounded-lg px-3 py-2 ${cls}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-xl font-bold tabular-nums" data-testid={`stat-${label}`}>{value}</div>
    </div>
  );
}
