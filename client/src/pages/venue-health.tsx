import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { MapPinned, MapPin, AlertTriangle, CheckCircle2, Copy, EyeOff, Compass, RefreshCw } from "lucide-react";

interface VenueHealthRow {
  id: number;
  name: string;
  shortName: string;
  regionId: number;
  latitude: number | null;
  longitude: number | null;
  radius: number | null;
  isInternal: boolean;
  isActive: boolean;
  successCount: number;
  failCount: number;
  suspiciousCount: number;
  bufferAppliedCount: number;
  centroidLat: number | null;
  centroidLng: number | null;
  drift: number | null;
  duplicateOf: number[];
  label: "ok" | "no_data" | "drift" | "duplicate" | "no_coord" | "inactive";
}

interface VenueHealthResp {
  rangeStart: string;
  rangeEnd: string;
  rows: VenueHealthRow[];
}

const labelMeta: Record<VenueHealthRow["label"], { text: string; cls: string; icon: any }> = {
  drift: { text: "座標偏移", cls: "bg-rose-100 text-rose-700 border-rose-200", icon: AlertTriangle },
  duplicate: { text: "可能重複", cls: "bg-amber-100 text-amber-700 border-amber-200", icon: Copy },
  no_data: { text: "30 天無打卡", cls: "bg-slate-100 text-slate-600 border-slate-200", icon: EyeOff },
  no_coord: { text: "未設定座標", cls: "bg-slate-200 text-slate-700 border-slate-300", icon: MapPin },
  inactive: { text: "已停用", cls: "bg-zinc-200 text-zinc-600 border-zinc-300", icon: EyeOff },
  ok: { text: "正常", cls: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
};

export default function VenueHealthPage() {
  const { toast } = useToast();
  const [filter, setFilter] = useState<"all" | "issues">("issues");

  const { data, isLoading, refetch, isFetching } = useQuery<VenueHealthResp>({
    queryKey: ["/api/admin/venue-health"],
  });

  const relocateMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/admin/venue-health/${id}/relocate`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "已套用建議座標", description: `樣本 ${data.samples} 筆，新座標 ${data.latitude}, ${data.longitude}` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/venue-health"] });
      queryClient.invalidateQueries({ queryKey: ["/api/venues-all"] });
    },
    onError: (err: any) => toast({ title: "套用失敗", description: err.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/venues/${id}/active`, { isActive });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/venue-health"] });
      queryClient.invalidateQueries({ queryKey: ["/api/venues-all"] });
    },
    onError: (err: any) => toast({ title: "更新失敗", description: err.message, variant: "destructive" }),
  });

  const rows = (data?.rows || []).filter((r) => filter === "all" || r.label !== "ok");

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4" data-testid="page-venue-health">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MapPinned className="h-5 w-5 text-blue-600" />
                場館定位健康
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                統計區間 {data?.rangeStart} ~ {data?.rangeEnd}（近 30 天）。座標偏移 &gt; 200m / 重複 / 無打卡資料的場館優先列出。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={filter === "issues" ? "default" : "outline"}
                onClick={() => setFilter("issues")}
                data-testid="button-filter-issues"
              >
                僅顯示異常
              </Button>
              <Button
                size="sm"
                variant={filter === "all" ? "default" : "outline"}
                onClick={() => setFilter("all")}
                data-testid="button-filter-all"
              >
                全部
              </Button>
              <Button size="sm" variant="outline" onClick={() => refetch()} data-testid="button-refresh">
                <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`} />
                重整
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[calc(100vh-220px)] min-h-[400px]">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground text-sm">載入中…</div>
            ) : rows.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm" data-testid="text-empty-health">
                {filter === "issues" ? "沒有發現異常場館" : "沒有場館資料"}
              </div>
            ) : (
              <div className="divide-y">
                {rows.map((r) => {
                  const meta = labelMeta[r.label];
                  const Icon = meta.icon;
                  const canRelocate = r.centroidLat != null && r.centroidLng != null && r.successCount >= 10;
                  return (
                    <div key={r.id} className="px-4 py-3 hover:bg-slate-50 grid grid-cols-12 gap-2 items-center text-sm" data-testid={`row-venue-health-${r.id}`}>
                      <div className="col-span-3">
                        <div className="font-medium text-slate-900 flex items-center gap-2">
                          {r.shortName}
                          {r.isInternal && <Badge variant="outline" className="text-[10px] bg-purple-50 text-purple-700">內部</Badge>}
                        </div>
                        <div className="text-[11px] text-slate-400">{r.name}</div>
                        <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                          #{r.id} · 半徑 {r.radius ?? "—"}m
                        </div>
                      </div>
                      <div className="col-span-2">
                        <Badge variant="outline" className={meta.cls} data-testid={`badge-status-${r.id}`}>
                          <Icon className="h-3 w-3 mr-0.5" />
                          {meta.text}
                        </Badge>
                        {r.duplicateOf.length > 0 && (
                          <div className="text-[10px] text-amber-600 mt-1">與場館 #{r.duplicateOf.join(", #")} 接近</div>
                        )}
                      </div>
                      <div className="col-span-2 text-xs">
                        <div className="text-slate-600">成功 <span className="font-semibold text-emerald-700">{r.successCount}</span></div>
                        <div className="text-slate-600">失敗 <span className="font-semibold text-rose-700">{r.failCount}</span></div>
                        {r.suspiciousCount > 0 && (
                          <div className="text-amber-700">可疑 {r.suspiciousCount}</div>
                        )}
                        {r.bufferAppliedCount > 0 && (
                          <div className="text-slate-400">套精度 {r.bufferAppliedCount}</div>
                        )}
                      </div>
                      <div className="col-span-3 text-[11px] font-mono text-slate-500">
                        <div>登錄 {r.latitude != null ? `${r.latitude.toFixed(5)}, ${r.longitude!.toFixed(5)}` : "—"}</div>
                        <div>實際 {r.centroidLat != null ? `${r.centroidLat.toFixed(5)}, ${r.centroidLng!.toFixed(5)}` : "—"}</div>
                        {r.drift != null && (
                          <div className={r.drift > 200 ? "text-rose-600 font-semibold" : "text-slate-500"}>
                            偏移 {r.drift}m
                          </div>
                        )}
                      </div>
                      <div className="col-span-2 flex flex-col items-end gap-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-slate-500">啟用</span>
                          <Switch
                            checked={r.isActive}
                            onCheckedChange={(v) => toggleMutation.mutate({ id: r.id, isActive: v })}
                            data-testid={`switch-active-${r.id}`}
                          />
                        </div>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              disabled={!canRelocate || relocateMutation.isPending}
                              title={canRelocate ? "用實際成功打卡中心更新座標" : "成功打卡須 ≥ 10 筆"}
                              data-testid={`button-relocate-${r.id}`}
                            >
                              <Compass className="h-3 w-3 mr-1" />
                              套用實際座標
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>套用實際成功打卡中心？</AlertDialogTitle>
                              <AlertDialogDescription>
                                場館「{r.shortName}」將以最近 30 天 {r.successCount} 筆成功打卡的中心座標
                                ({r.centroidLat}, {r.centroidLng}) 更新位置。
                                {r.drift != null && ` 與目前座標偏移 ${r.drift}m。`}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel data-testid={`button-relocate-cancel-${r.id}`}>取消</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => relocateMutation.mutate(r.id)}
                                data-testid={`button-relocate-confirm-${r.id}`}
                              >
                                確認套用
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
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
