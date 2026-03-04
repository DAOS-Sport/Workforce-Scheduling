import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ShieldAlert,
  FileWarning,
  CheckCircle2,
  RefreshCw,
  Search,
  X,
  ChevronRight,
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

function KpiCard({ title, value, icon: Icon, color }: { title: string; value: string | number; icon: any; color: string }) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border bg-card p-4 min-w-[150px] transition-transform hover:-translate-y-0.5`}
      data-testid={`text-kpi-${title}`}
    >
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${color}`}>
        <Icon className="h-5 w-5 text-white" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground font-medium">{title}</p>
        <p className="text-xl font-bold">{value}</p>
      </div>
    </div>
  );
}

function DetailRow({ icon: Icon, label, value }: { icon: any; label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 text-sm">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
      <span className="text-muted-foreground min-w-[60px]">{label}</span>
      <span className="font-medium break-all">{value}</span>
    </div>
  );
}

function AnomalyCard({
  report,
  isSelected,
  onSelect,
}: {
  report: AnomalyReport;
  isSelected: boolean;
  onSelect: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [noteInput, setNoteInput] = useState(report.resolvedNote || "");
  const [showReport, setShowReport] = useState(false);
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

  const borderColor = isSelected
    ? "ring-2 ring-blue-400"
    : isResolved
    ? "border-green-200 dark:border-green-800"
    : "border-orange-200 dark:border-orange-800";

  const bgColor = isResolved ? "bg-green-50/30 dark:bg-green-950/20" : "";

  const StatusIcon = isResolved ? CheckCircle2 : isFail ? ShieldAlert : FileWarning;
  const statusColor = isResolved ? "text-green-600" : isFail ? "text-red-500" : "text-orange-500";

  return (
    <div
      className={`rounded-xl border ${borderColor} ${bgColor} overflow-hidden transition-all`}
      data-testid={`card-anomaly-${report.id}`}
    >
      <div
        className="flex items-center gap-3 p-4 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => {
            e.stopPropagation();
            onSelect(report.id);
          }}
          onClick={(e) => e.stopPropagation()}
          className="h-4 w-4 rounded border-gray-300"
          data-testid={`checkbox-${report.id}`}
        />
        <StatusIcon className={`h-5 w-5 ${statusColor} shrink-0`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm" data-testid={`text-anomaly-employee-${report.id}`}>
              {report.employeeName || "未知員工"}
            </span>
            <Badge
              variant={isResolved ? "default" : "secondary"}
              className={isResolved ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200"}
              data-testid={`badge-resolution-${report.id}`}
            >
              {isResolved ? "已處理" : "待解決"}
            </Badge>
            {report.clockType && (
              <Badge variant="outline" className="text-xs">
                {report.clockType === "in" ? "上班" : "下班"}
              </Badge>
            )}
            {report.venueName && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Building2 className="h-3 w-3" /> {report.venueName}
              </span>
            )}
            {report.failReason && (
              <span className="text-xs text-red-500">{report.failReason}</span>
            )}
            {report.imageUrls && report.imageUrls.length > 0 && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <ImageIcon className="h-3 w-3" /> {report.imageUrls.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-muted-foreground" data-testid={`text-anomaly-time-${report.id}`}>
              {formatDate(report.createdAt)}
            </span>
            <span className="text-xs text-muted-foreground hidden sm:inline">
              ({relativeTime(report.createdAt)})
            </span>
          </div>
        </div>
        <ChevronRight
          className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
          data-testid={`button-expand-${report.id}`}
        />
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t" data-testid={`detail-anomaly-${report.id}`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-3">
            <DetailRow icon={User} label="姓名" value={report.employeeName} />
            <DetailRow icon={Hash} label="編號" value={report.employeeCode} />
            <DetailRow icon={Briefcase} label="職位" value={report.role} />
            <DetailRow icon={Clock} label="時間" value={report.clockTime} />
            <DetailRow icon={Building2} label="場館" value={report.venueName} />
            <DetailRow icon={Ruler} label="距離" value={report.distance} />
            <DetailRow icon={AlertTriangle} label="原因" value={report.failReason} />
            <DetailRow icon={FileText} label="類型" value={report.clockType === "in" ? "上班打卡" : report.clockType === "out" ? "下班打卡" : null} />
            <DetailRow icon={FileWarning} label="異常" value={report.context} />
          </div>

          {report.errorMsg && (
            <div className="rounded-lg bg-red-50/60 dark:bg-red-950/30 border border-red-200/60 dark:border-red-800/60 p-3">
              <p className="text-sm text-red-700 dark:text-red-300"><b>錯誤訊息：</b>{report.errorMsg}</p>
            </div>
          )}

          {report.userNote && (
            <div className="rounded-lg bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-800/60 p-3">
              <p className="text-sm text-blue-700 dark:text-blue-300"><b>使用者備註：</b>{report.userNote}</p>
            </div>
          )}

          {report.imageUrls && report.imageUrls.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {report.imageUrls.map((url, i) => {
                const fullUrl = url.startsWith("http") ? url : `${window.location.origin}${url}`;
                return (
                  <a
                    key={i}
                    href={fullUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid={`img-anomaly-${report.id}-${i}`}
                  >
                    <img
                      src={fullUrl}
                      alt={`附件 ${i + 1}`}
                      className="h-20 w-20 rounded-lg object-cover border hover:opacity-80 transition-opacity"
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </a>
                );
              })}
            </div>
          )}

          <div className="rounded-lg bg-gray-50/80 dark:bg-zinc-900/50 border border-gray-200/60 dark:border-zinc-700/60 p-3 space-y-2">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
              <Input
                placeholder="處理備註..."
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                className="flex-1 h-8 text-sm"
                data-testid={`input-note-${report.id}`}
              />
              {isResolved ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => resolutionMutation.mutate({ resolution: "pending", resolvedNote: noteInput })}
                  disabled={resolutionMutation.isPending}
                  data-testid={`button-unresolve-${report.id}`}
                >
                  改為待解決
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => resolutionMutation.mutate({ resolution: "resolved", resolvedNote: noteInput })}
                  disabled={resolutionMutation.isPending}
                  className="bg-green-600 hover:bg-green-700"
                  data-testid={`button-resolve-${report.id}`}
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" /> 標記已處理
                </Button>
              )}
            </div>
            {report.resolvedNote && (
              <p className="text-xs text-muted-foreground"><b>處理備註：</b>{report.resolvedNote}</p>
            )}
          </div>

          {report.reportText && (
            <details data-testid={`toggle-report-text-${report.id}`}>
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                查看完整報告文字
              </summary>
              <pre className="mt-2 text-xs bg-muted/50 rounded-lg p-3 whitespace-pre-wrap overflow-x-auto">
                {report.reportText}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
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

  const venues = useMemo(() => {
    const v = new Set<string>();
    reports.forEach((r) => {
      if (r.venueName) v.add(r.venueName);
    });
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
    const d = new Date(r.createdAt);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  }).length;

  const topVenue = useMemo(() => {
    const counts: Record<string, number> = {};
    reports.forEach((r) => {
      if (r.venueName) counts[r.venueName] = (counts[r.venueName] || 0) + 1;
    });
    const entries = Object.entries(counts);
    if (entries.length === 0) return "—";
    entries.sort((a, b) => b[1] - a[1]);
    return entries[0][0];
  }, [reports]);

  const topReason = useMemo(() => {
    const counts: Record<string, number> = {};
    reports.forEach((r) => {
      if (r.failReason) counts[r.failReason] = (counts[r.failReason] || 0) + 1;
    });
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 space-y-6" data-testid="page-anomaly-reports">
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

      <div className="flex flex-wrap gap-3">
        <KpiCard title="總異常數" value={totalReports} icon={FileWarning} color="bg-blue-500" />
        <KpiCard title="待解決" value={pendingCount} icon={AlertTriangle} color="bg-orange-500" />
        <KpiCard title="今日異常" value={todayCount} icon={Clock} color="bg-red-500" />
        <KpiCard title="最常見場館" value={topVenue} icon={Building2} color="bg-purple-500" />
        <KpiCard title="最常見原因" value={topReason} icon={MessageSquare} color="bg-teal-500" />
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
          <SelectTrigger className="w-[150px] h-9" data-testid="select-venue">
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
          <SelectTrigger className="w-[120px] h-9" data-testid="select-status">
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
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-blue-50/50 dark:bg-blue-950/20 p-3">
          <span className="text-sm font-medium">已選 {selectedIds.size} 筆</span>
          <Input
            placeholder="批量備註..."
            value={batchNote}
            onChange={(e) => setBatchNote(e.target.value)}
            className="flex-1 min-w-[150px] h-8 text-sm"
          />
          <Button
            size="sm"
            className="bg-green-600 hover:bg-green-700 gap-1"
            onClick={() => batchMutation.mutate({ ids: Array.from(selectedIds), resolution: "resolved", resolvedNote: batchNote })}
            disabled={batchMutation.isPending}
            data-testid="button-batch-resolve"
          >
            <CheckCircle2 className="h-4 w-4" /> 批量已處理
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => batchMutation.mutate({ ids: Array.from(selectedIds), resolution: "pending", resolvedNote: batchNote })}
            disabled={batchMutation.isPending}
            data-testid="button-batch-pending"
          >
            批量待解決
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
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

      <div className="space-y-3" data-testid="list-anomaly-reports">
        {filteredReports.length === 0 ? (
          <div className="text-center py-12" data-testid="text-empty-state">
            <ShieldAlert className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">
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
            />
          ))
        )}
      </div>
    </div>
  );
}
