import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ShieldAlert,
  FileWarning,
  CheckCircle2,
  RefreshCw,
  Search,
  X,
  ChevronDown,
  AlertTriangle,
  Clock,
  MapPin,
  User,
  Hash,
  Briefcase,
  Building2,
  Ruler,
  FileText,
  Bell,
  BellOff,
  Mail,
  Plus,
  Trash2,
  Send,
  Image as ImageIcon,
  MessageSquare,
  ZoomIn,
} from "lucide-react";

interface AnomalyReport {
  id: number;
  employeeId: number | null;
  employeeName: string | null;
  employeeCode: string | null;
  role: string | null;
  lineUserId: string | null;
  context: string;
  clockStatus: string | null;
  clockType: string | null;
  clockTime: string | null;
  venueName: string | null;
  distance: string | null;
  failReason: string | null;
  errorMsg: string | null;
  userNote: string | null;
  imageUrls: string[] | null;
  reportText: string | null;
  resolution: string | null;
  resolvedNote: string | null;
  createdAt: string | null;
}

interface NotificationRecipient {
  id: number;
  email: string;
  label: string | null;
  enabled: boolean | null;
  notifyNewReport: boolean | null;
  notifyResolution: boolean | null;
  createdAt: string | null;
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function relativeTime(dateStr: string | null) {
  if (!dateStr) return "";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return "剛剛";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分鐘前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小時前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

function getImageSrc(url: string): string {
  if (url.startsWith("data:")) return url;
  if (url.startsWith("http")) return url;
  return `${window.location.origin}${url}`;
}

function KpiCard({ title, value, icon: Icon, color }: { title: string; value: string | number; icon: any; color: string }) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border bg-card p-4 min-w-[140px] flex-1`}
      data-testid={`text-kpi-${title}`}
    >
      <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${color}`}>
        <Icon className="h-4 w-4 text-white" />
      </div>
      <div>
        <p className="text-[11px] text-muted-foreground font-medium leading-tight">{title}</p>
        <p className="text-lg font-bold leading-tight mt-0.5">{value}</p>
      </div>
    </div>
  );
}

function AnomalyCard({
  report,
  isSelected,
  onSelect,
  onDelete,
}: {
  report: AnomalyReport;
  isSelected: boolean;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [noteInput, setNoteInput] = useState(report.resolvedNote || "");
  const [showReport, setShowReport] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const { toast } = useToast();

  const resolutionMutation = useMutation({
    mutationFn: async ({ resolution, resolvedNote }: { resolution: string; resolvedNote?: string }) => {
      const res = await apiRequest("PATCH", `/api/anomaly-reports/${report.id}/resolution`, { resolution, resolvedNote });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/anomaly-reports"] });
      toast({ title: "已更新處理狀態" });
    },
  });

  const isResolved = report.resolution === "resolved";
  const isFail = report.clockStatus === "fail";
  const hasImages = report.imageUrls && report.imageUrls.length > 0;

  return (
    <>
      <div
        className={`rounded-xl border overflow-hidden transition-all ${
          isSelected
            ? "ring-2 ring-blue-400 border-blue-300 dark:border-blue-600"
            : isResolved
            ? "border-border/60"
            : "border-orange-200/80 dark:border-orange-800/50"
        } ${isResolved ? "opacity-70" : ""}`}
        data-testid={`card-anomaly-${report.id}`}
      >
        <div
          className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none hover:bg-muted/30 transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => { e.stopPropagation(); onSelect(report.id); }}
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-4 rounded border-gray-300 shrink-0"
            data-testid={`checkbox-${report.id}`}
          />

          <div className={`flex h-8 w-8 items-center justify-center rounded-full shrink-0 ${
            isResolved ? "bg-green-100 dark:bg-green-900/40" : isFail ? "bg-red-100 dark:bg-red-900/40" : "bg-orange-100 dark:bg-orange-900/40"
          }`}>
            {isResolved ? (
              <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
            ) : isFail ? (
              <ShieldAlert className="h-4 w-4 text-red-500" />
            ) : (
              <FileWarning className="h-4 w-4 text-orange-500" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm" data-testid={`text-anomaly-employee-${report.id}`}>
                {report.employeeName || "未知員工"}
              </span>
              <Badge
                variant="secondary"
                className={`text-[10px] px-1.5 py-0 h-5 ${
                  isResolved
                    ? "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300"
                    : "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300"
                }`}
                data-testid={`badge-resolution-${report.id}`}
              >
                {isResolved ? "已處理" : "待解決"}
              </Badge>
              {report.clockType && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5">
                  {report.clockType === "in" ? "上班" : "下班"}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
              {report.venueName && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> {report.venueName}
                </span>
              )}
              {report.failReason && (
                <span className="text-red-500 dark:text-red-400">{report.failReason}</span>
              )}
              {hasImages && (
                <span className="flex items-center gap-0.5">
                  <ImageIcon className="h-3 w-3" /> {report.imageUrls!.length}
                </span>
              )}
            </div>
          </div>

          <div className="text-right shrink-0 hidden sm:block">
            <p className="text-xs text-muted-foreground" data-testid={`text-anomaly-time-${report.id}`}>
              {formatDate(report.createdAt)}
            </p>
            <p className="text-[10px] text-muted-foreground/70">
              {relativeTime(report.createdAt)}
            </p>
          </div>

          <ChevronDown
            className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
            data-testid={`button-expand-${report.id}`}
          />
        </div>

        {expanded && (
          <div className="border-t bg-muted/20" data-testid={`detail-anomaly-${report.id}`}>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-sm">
                <div>
                  <span className="text-[11px] text-muted-foreground block">姓名</span>
                  <span className="font-medium text-sm">{report.employeeName || "—"}</span>
                </div>
                <div>
                  <span className="text-[11px] text-muted-foreground block">編號</span>
                  <span className="font-medium text-sm">{report.employeeCode || "—"}</span>
                </div>
                <div>
                  <span className="text-[11px] text-muted-foreground block">職位</span>
                  <span className="font-medium text-sm">{report.role || "—"}</span>
                </div>
                <div>
                  <span className="text-[11px] text-muted-foreground block">打卡時間</span>
                  <span className="font-medium text-sm">{report.clockTime || "—"}</span>
                </div>
                <div>
                  <span className="text-[11px] text-muted-foreground block">場館</span>
                  <span className="font-medium text-sm">{report.venueName || "—"}</span>
                </div>
                <div>
                  <span className="text-[11px] text-muted-foreground block">距離</span>
                  <span className="font-medium text-sm">{report.distance || "—"}</span>
                </div>
                <div>
                  <span className="text-[11px] text-muted-foreground block">類型</span>
                  <span className="font-medium text-sm">{report.clockType === "in" ? "上班打卡" : report.clockType === "out" ? "下班打卡" : "—"}</span>
                </div>
                <div>
                  <span className="text-[11px] text-muted-foreground block">異常原因</span>
                  <span className="font-medium text-sm text-red-600 dark:text-red-400">{report.failReason || report.context || "—"}</span>
                </div>
              </div>

              {report.errorMsg && (
                <div className="rounded-lg bg-red-50/80 dark:bg-red-950/30 border border-red-200/60 dark:border-red-800/40 px-3 py-2">
                  <p className="text-xs text-red-700 dark:text-red-300"><span className="font-semibold">錯誤訊息：</span>{report.errorMsg}</p>
                </div>
              )}

              {report.userNote && (
                <div className="rounded-lg bg-blue-50/80 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-800/40 px-3 py-2">
                  <p className="text-xs text-blue-700 dark:text-blue-300"><span className="font-semibold">使用者備註：</span>{report.userNote}</p>
                </div>
              )}

              {hasImages && (
                <div>
                  <p className="text-[11px] text-muted-foreground mb-1.5 font-medium">附件圖片</p>
                  <div className="flex flex-wrap gap-2">
                    {report.imageUrls!.map((url, i) => {
                      const src = getImageSrc(url);
                      return (
                        <div
                          key={i}
                          className="relative group cursor-pointer"
                          onClick={() => setPreviewImage(src)}
                          data-testid={`img-anomaly-${report.id}-${i}`}
                        >
                          <img
                            src={src}
                            alt={`附件 ${i + 1}`}
                            className="h-24 w-24 rounded-lg object-cover border border-border/60 group-hover:border-blue-400 transition-all"
                            loading="lazy"
                            onError={(e) => {
                              const el = e.target as HTMLImageElement;
                              el.parentElement!.innerHTML = `<div class="h-24 w-24 rounded-lg border border-dashed border-muted-foreground/30 flex items-center justify-center text-muted-foreground/50"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg></div>`;
                            }}
                          />
                          <div className="absolute inset-0 rounded-lg bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                            <ZoomIn className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-md" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
                <Input
                  placeholder="處理備註..."
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  className="flex-1 h-8 text-sm"
                  data-testid={`input-note-${report.id}`}
                />
                <div className="flex gap-2">
                  {isResolved ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() => resolutionMutation.mutate({ resolution: "pending", resolvedNote: noteInput })}
                      disabled={resolutionMutation.isPending}
                      data-testid={`button-unresolve-${report.id}`}
                    >
                      改為待解決
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="h-8 text-xs bg-green-600 hover:bg-green-700"
                      onClick={() => resolutionMutation.mutate({ resolution: "resolved", resolvedNote: noteInput })}
                      disabled={resolutionMutation.isPending}
                      data-testid={`button-resolve-${report.id}`}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> 標記已處理
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                    onClick={(e) => { e.stopPropagation(); onDelete(report.id); }}
                    data-testid={`button-delete-${report.id}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              {report.resolvedNote && (
                <p className="text-xs text-muted-foreground"><span className="font-semibold">處理備註：</span>{report.resolvedNote}</p>
              )}

              {report.reportText && (
                <details data-testid={`toggle-report-text-${report.id}`}>
                  <summary className="text-[11px] text-muted-foreground cursor-pointer hover:text-foreground select-none">
                    查看完整報告文字
                  </summary>
                  <pre className="mt-2 text-[11px] bg-muted/50 rounded-lg p-3 whitespace-pre-wrap overflow-x-auto leading-relaxed">
                    {report.reportText}
                  </pre>
                </details>
              )}
            </div>
          </div>
        )}
      </div>

      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent className="max-w-3xl p-2">
          <DialogHeader className="sr-only">
            <DialogTitle>圖片預覽</DialogTitle>
          </DialogHeader>
          {previewImage && (
            <img
              src={previewImage}
              alt="預覽"
              className="w-full rounded-lg object-contain max-h-[80vh]"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function NotificationSettingsPanel() {
  const [showPanel, setShowPanel] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const { toast } = useToast();

  const { data: recipients = [] } = useQuery<NotificationRecipient[]>({
    queryKey: ["/api/notification-recipients"],
  });

  const addMutation = useMutation({
    mutationFn: async (data: { email: string; label: string }) => {
      const res = await apiRequest("POST", "/api/notification-recipients", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notification-recipients"] });
      setNewEmail("");
      setNewLabel("");
      toast({ title: "已新增收件者" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await apiRequest("PATCH", `/api/notification-recipients/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notification-recipients"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/notification-recipients/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notification-recipients"] });
      toast({ title: "已刪除收件者" });
    },
  });

  const testEmailMutation = useMutation({
    mutationFn: async (email: string) => {
      const res = await apiRequest("POST", "/api/test-email", { email });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "測試郵件已發送" });
    },
    onError: (err: any) => {
      toast({ title: "發送失敗", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-3">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowPanel(!showPanel)}
        className="gap-2"
        data-testid="button-toggle-notifications"
      >
        {showPanel ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
        郵件通知設定
        {recipients.length > 0 && (
          <Badge variant="secondary" className="ml-1">{recipients.length}</Badge>
        )}
      </Button>

      {showPanel && (
        <div className="rounded-xl border bg-card p-4 space-y-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder="Email 地址"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="flex-1 h-9 text-sm"
            />
            <Input
              placeholder="名稱標籤（選填）"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="w-full sm:w-40 h-9 text-sm"
            />
            <Button
              size="sm"
              onClick={() => {
                if (!newEmail) return;
                addMutation.mutate({ email: newEmail, label: newLabel || "" });
              }}
              disabled={!newEmail || addMutation.isPending}
              className="gap-1 h-9"
            >
              <Plus className="h-4 w-4" /> 新增
            </Button>
          </div>

          {recipients.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">尚無通知收件者</p>
          ) : (
            <div className="space-y-2">
              {recipients.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-col sm:flex-row items-start sm:items-center gap-2 rounded-lg border p-3"
                  data-testid={`recipient-${r.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="text-sm font-medium truncate">{r.email}</span>
                      {r.label && <Badge variant="outline" className="text-xs">{r.label}</Badge>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="flex items-center gap-1 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={r.enabled !== false}
                        onChange={(e) => toggleMutation.mutate({ id: r.id, data: { enabled: e.target.checked } })}
                        className="h-3.5 w-3.5 rounded"
                      />
                      啟用
                    </label>
                    <label className="flex items-center gap-1 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={r.notifyNewReport !== false}
                        onChange={(e) => toggleMutation.mutate({ id: r.id, data: { notifyNewReport: e.target.checked } })}
                        className="h-3.5 w-3.5 rounded"
                      />
                      新異常
                    </label>
                    <label className="flex items-center gap-1 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={r.notifyResolution !== false}
                        onChange={(e) => toggleMutation.mutate({ id: r.id, data: { notifyResolution: e.target.checked } })}
                        className="h-3.5 w-3.5 rounded"
                      />
                      處理變更
                    </label>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => testEmailMutation.mutate(r.email)}
                      disabled={testEmailMutation.isPending}
                      title="發送測試信"
                    >
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-red-500 hover:text-red-700"
                      onClick={() => deleteMutation.mutate(r.id)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AnomalyReportsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [venueFilter, setVenueFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchNote, setBatchNote] = useState("");
  const { toast } = useToast();

  const { data: reports = [], isLoading, refetch } = useQuery<AnomalyReport[]>({
    queryKey: ["/api/anomaly-reports"],
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
  });

  const batchMutation = useMutation({
    mutationFn: async ({ ids, resolution, resolvedNote }: { ids: number[]; resolution: string; resolvedNote?: string }) => {
      const res = await apiRequest("PATCH", "/api/anomaly-reports/batch/resolution", { ids, resolution, resolvedNote });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/anomaly-reports"] });
      setSelectedIds(new Set());
      setBatchNote("");
      toast({ title: `已更新 ${data.updated} 筆` });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/anomaly-reports/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/anomaly-reports"] });
      toast({ title: "已刪除" });
    },
  });

  const batchDeleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await apiRequest("POST", "/api/anomaly-reports/batch/delete", { ids });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/anomaly-reports"] });
      setSelectedIds(new Set());
      toast({ title: `已刪除 ${data.deleted} 筆` });
    },
  });

  const venues = useMemo(() => {
    const v = new Set<string>();
    reports.forEach((r) => { if (r.venueName) v.add(r.venueName); });
    return Array.from(v).sort();
  }, [reports]);

  const filteredReports = useMemo(() => {
    return reports.filter((r) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const match =
          (r.employeeName || "").toLowerCase().includes(q) ||
          (r.employeeCode || "").toLowerCase().includes(q) ||
          (r.venueName || "").toLowerCase().includes(q);
        if (!match) return false;
      }
      if (venueFilter !== "all" && r.venueName !== venueFilter) return false;
      if (statusFilter === "pending" && r.resolution === "resolved") return false;
      if (statusFilter === "resolved" && r.resolution !== "resolved") return false;
      return true;
    });
  }, [reports, searchQuery, venueFilter, statusFilter]);

  const totalReports = reports.length;
  const pendingCount = reports.filter((r) => r.resolution !== "resolved").length;
  const todayCount = reports.filter((r) => {
    if (!r.createdAt) return false;
    return new Date(r.createdAt).toDateString() === new Date().toDateString();
  }).length;

  const topVenue = useMemo(() => {
    const counts: Record<string, number> = {};
    reports.forEach((r) => { if (r.venueName) counts[r.venueName] = (counts[r.venueName] || 0) + 1; });
    const entries = Object.entries(counts);
    if (entries.length === 0) return "—";
    entries.sort((a, b) => b[1] - a[1]);
    return entries[0][0];
  }, [reports]);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filteredReports.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredReports.map((r) => r.id)));
    }
  };

  const handleDelete = (id: number) => {
    if (confirm("確定要刪除此異常報告？")) {
      deleteMutation.mutate(id);
    }
  };

  const handleBatchDelete = () => {
    if (confirm(`確定要刪除選取的 ${selectedIds.size} 筆異常報告？此操作無法復原。`)) {
      batchDeleteMutation.mutate(Array.from(selectedIds));
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 space-y-5" data-testid="page-anomaly-reports">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-red-500 shadow-lg">
            <ShieldAlert className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold" data-testid="text-page-title">打卡異常管理</h1>
            <p className="text-xs text-muted-foreground">即時監控與管理打卡異常紀錄</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="gap-2"
          data-testid="button-refresh"
        >
          <RefreshCw className="h-4 w-4" /> 刷新
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard title="總異常數" value={totalReports} icon={FileWarning} color="bg-blue-500" />
        <KpiCard title="待解決" value={pendingCount} icon={AlertTriangle} color="bg-orange-500" />
        <KpiCard title="今日異常" value={todayCount} icon={Clock} color="bg-red-500" />
        <KpiCard title="最常見場館" value={topVenue} icon={Building2} color="bg-purple-500" />
      </div>

      <NotificationSettingsPanel />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜尋姓名、編號、場館..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
            data-testid="input-search"
          />
        </div>
        <Select value={venueFilter} onValueChange={setVenueFilter}>
          <SelectTrigger className="w-[140px] h-9" data-testid="select-venue">
            <SelectValue placeholder="場館" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部場館</SelectItem>
            {venues.map((v) => (
              <SelectItem key={v} value={v}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[110px] h-9" data-testid="select-status">
            <SelectValue placeholder="狀態" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部</SelectItem>
            <SelectItem value="pending">待解決</SelectItem>
            <SelectItem value="resolved">已處理</SelectItem>
          </SelectContent>
        </Select>
        {(searchQuery || venueFilter !== "all" || statusFilter !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setSearchQuery(""); setVenueFilter("all"); setStatusFilter("all"); }}
            data-testid="button-clear-filters"
          >
            <X className="h-4 w-4 mr-1" /> 清除
          </Button>
        )}
      </div>

      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 p-3">
          <span className="text-sm font-medium">已選 {selectedIds.size} 筆</span>
          <Input
            placeholder="批量備註..."
            value={batchNote}
            onChange={(e) => setBatchNote(e.target.value)}
            className="flex-1 min-w-[150px] h-8 text-sm"
          />
          <Button
            size="sm"
            className="bg-green-600 hover:bg-green-700 gap-1 h-8 text-xs"
            onClick={() => batchMutation.mutate({ ids: Array.from(selectedIds), resolution: "resolved", resolvedNote: batchNote })}
            disabled={batchMutation.isPending}
            data-testid="button-batch-resolve"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> 批量已處理
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => batchMutation.mutate({ ids: Array.from(selectedIds), resolution: "pending", resolvedNote: batchNote })}
            disabled={batchMutation.isPending}
            data-testid="button-batch-pending"
          >
            批量待解決
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs text-red-500 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/30"
            onClick={handleBatchDelete}
            disabled={batchDeleteMutation.isPending}
            data-testid="button-batch-delete"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" /> 批量刪除
          </Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setSelectedIds(new Set())}>
            取消
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          顯示 {filteredReports.length} / {totalReports} 筆
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={selectAll}
          data-testid="button-select-all"
        >
          {selectedIds.size === filteredReports.length && filteredReports.length > 0 ? "取消全選" : "全選"}
        </Button>
      </div>

      <div className="space-y-2" data-testid="list-anomaly-reports">
        {filteredReports.length === 0 ? (
          <div className="text-center py-16" data-testid="text-empty-state">
            <ShieldAlert className="h-12 w-12 mx-auto text-muted-foreground/20 mb-3" />
            <p className="text-muted-foreground text-sm">
              {totalReports === 0 ? "目前沒有異常報告" : "無符合篩選條件的異常報告"}
            </p>
          </div>
        ) : (
          filteredReports.map((report) => (
            <AnomalyCard
              key={report.id}
              report={report}
              isSelected={selectedIds.has(report.id)}
              onSelect={toggleSelect}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>
    </div>
  );
}