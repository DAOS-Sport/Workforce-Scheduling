import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { zhTW } from "date-fns/locale";
import { CalendarOff, CheckCircle2, XCircle, Clock, Eye, BarChart2, ChevronDown, ChevronUp, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface LeaveRequest {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  hours: number | null;
  reason: string | null;
  certificateImageUrl: string | null;
  status: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
}

interface LeaveBalanceRow {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  year: number;
  totalHours: number;
  usedHours: number;
  pendingHours: number;
  updatedAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "審核中",
  approved: "已核准",
  rejected: "已拒絕",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
};

function daysBetween(startDate: string, endDate: string): number {
  const s = new Date(startDate);
  const e = new Date(endDate);
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1);
}

function BalanceOverviewSection() {
  const { toast } = useToast();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [collapsed, setCollapsed] = useState(false);
  const [editingRow, setEditingRow] = useState<LeaveBalanceRow | null>(null);
  const [editHours, setEditHours] = useState("");

  const { data: balances = [], isLoading: balancesLoading } = useQuery<LeaveBalanceRow[]>({
    queryKey: ["/api/leave-balances", year],
    queryFn: async () => {
      const res = await fetch(`/api/leave-balances?year=${year}`, { credentials: "include" });
      if (!res.ok) throw new Error("載入失敗");
      return res.json();
    },
  });

  const adjustMutation = useMutation({
    mutationFn: async ({ employeeId, totalHours }: { employeeId: number; totalHours: number }) => {
      return apiRequest("POST", "/api/leave-balances/adjust", { employeeId, year, totalHours });
    },
    onSuccess: () => {
      toast({ title: "特休時數已更新" });
      queryClient.invalidateQueries({ queryKey: ["/api/leave-balances"] });
      setEditingRow(null);
    },
    onError: (err: any) => {
      toast({ title: err.message || "更新失敗", variant: "destructive" });
    },
  });

  const handleSaveEdit = () => {
    if (!editingRow) return;
    const h = parseFloat(editHours);
    if (isNaN(h) || h < 0) {
      toast({ title: "請輸入有效的時數（≥0）", variant: "destructive" });
      return;
    }
    adjustMutation.mutate({ employeeId: editingRow.employeeId, totalHours: h });
  };

  const yearOptions = [currentYear - 1, currentYear, currentYear + 1];

  return (
    <Card data-testid="card-balance-overview">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <BarChart2 className="h-4 w-4 text-teal-600" />
            <CardTitle className="text-sm font-semibold">特休餘額總覽</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="h-7 text-xs w-24" data-testid="select-balance-year">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y} 年</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              onClick={() => setCollapsed((v) => !v)}
              className="text-slate-400 hover:text-slate-600 p-1 rounded"
              data-testid="button-toggle-balance"
            >
              {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </CardHeader>
      {!collapsed && (
        <CardContent className="p-0">
          {balancesLoading ? (
            <div className="p-4 space-y-2">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : balances.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <BarChart2 className="h-6 w-6 mx-auto mb-2 opacity-30" />
              <p className="text-xs">{year} 年尚無特休餘額資料</p>
              <p className="text-xs text-slate-400 mt-1">員工申請特休後會自動建立，或由管理員設定核發時數</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground">員工</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">核發</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">已用</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">待審</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">剩餘</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {balances.map((b) => {
                    const remaining = Math.max(0, b.totalHours - b.usedHours - b.pendingHours);
                    return (
                      <tr key={b.id} className="hover:bg-muted/20" data-testid={`row-balance-${b.employeeId}`}>
                        <td className="px-4 py-2">
                          <p className="font-medium text-sm">{b.employeeName}</p>
                          <p className="text-xs text-muted-foreground">{b.employeeCode}</p>
                        </td>
                        <td className="text-right px-3 py-2 text-sm">{b.totalHours}h</td>
                        <td className="text-right px-3 py-2 text-sm text-red-600">{b.usedHours}h</td>
                        <td className="text-right px-3 py-2 text-sm text-amber-600">{b.pendingHours}h</td>
                        <td className={`text-right px-3 py-2 text-sm font-semibold ${remaining <= 0 ? "text-red-600" : remaining <= 8 ? "text-amber-600" : "text-teal-700"}`}>
                          {remaining}h
                        </td>
                        <td className="px-3 py-2">
                          <button
                            className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
                            onClick={() => { setEditingRow(b); setEditHours(String(b.totalHours)); }}
                            data-testid={`button-edit-balance-${b.employeeId}`}
                            title="設定核發時數"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      )}

      {/* Edit dialog */}
      {editingRow && (
        <Dialog open={!!editingRow} onOpenChange={(open) => { if (!open) setEditingRow(null); }}>
          <DialogContent className="max-w-xs">
            <DialogHeader>
              <DialogTitle>設定特休核發時數</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                {editingRow.employeeName}（{editingRow.employeeCode}）— {year} 年
              </p>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">核發總時數（小時）</label>
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  value={editHours}
                  onChange={(e) => setEditHours(e.target.value)}
                  className="h-9"
                  data-testid="input-edit-balance-hours"
                />
                <p className="text-xs text-slate-400 mt-1">例：7天 = 56小時；14天 = 112小時</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingRow(null)}>取消</Button>
              <Button onClick={handleSaveEdit} disabled={adjustMutation.isPending} data-testid="button-save-balance">
                儲存
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

export default function LeaveRequestsPage() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [selected, setSelected] = useState<LeaveRequest | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [certOpen, setCertOpen] = useState(false);

  const { data: requests = [], isLoading } = useQuery<LeaveRequest[]>({
    queryKey: ["/api/leave-requests", statusFilter],
    queryFn: async () => {
      const params = statusFilter !== "all" ? `?status=${statusFilter}` : "";
      const res = await fetch(`/api/leave-requests${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("載入失敗");
      return res.json();
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, status, note }: { id: number; status: string; note: string }) => {
      return apiRequest("PATCH", `/api/leave-requests/${id}`, { status, reviewNote: note });
    },
    onSuccess: () => {
      toast({ title: "審核完成" });
      queryClient.invalidateQueries({ queryKey: ["/api/leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leave-balances"] });
      setSelected(null);
      setReviewNote("");
    },
    onError: (err: any) => {
      toast({ title: err.message || "審核失敗", variant: "destructive" });
    },
  });

  const handleReview = (status: "approved" | "rejected") => {
    if (!selected) return;
    reviewMutation.mutate({ id: selected.id, status, note: reviewNote });
  };

  const pendingCount = requests.filter((r) => r.status === "pending").length;

  return (
    <div className="h-full overflow-auto">
      <div className="p-6 max-w-4xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-teal-600 shadow-lg shadow-teal-500/25">
              <CalendarOff className="h-4.5 w-4.5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold" data-testid="heading-leave-requests">請假管理</h1>
              <p className="text-xs text-muted-foreground">審核員工請假申請 · 管理特休餘額</p>
            </div>
          </div>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36" data-testid="select-status-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">審核中</SelectItem>
              <SelectItem value="approved">已核准</SelectItem>
              <SelectItem value="rejected">已拒絕</SelectItem>
              <SelectItem value="all">全部</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Balance overview */}
        <BalanceOverviewSection />

        {/* Stats */}
        {statusFilter === "pending" && pendingCount > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg">
            <Clock className="h-4 w-4 text-amber-600" />
            <span className="text-sm text-amber-700 dark:text-amber-400 font-medium">
              共 {pendingCount} 筆請假申請待審核
            </span>
          </div>
        )}

        {/* Table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">申請列表</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {[...Array(4)].map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-lg" />
                ))}
              </div>
            ) : requests.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <CalendarOff className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">目前無{STATUS_LABEL[statusFilter] || ""}申請</p>
              </div>
            ) : (
              <div className="divide-y">
                {requests.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
                    data-testid={`row-leave-${r.id}`}
                  >
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold" data-testid={`text-employee-${r.id}`}>
                          {r.employeeName}
                        </span>
                        <span className="text-xs text-muted-foreground">{r.employeeCode}</span>
                        <Badge variant="outline" className="text-[11px] px-1.5 py-0">{r.leaveType}</Badge>
                        {r.hours != null && (
                          <Badge variant="outline" className="text-[11px] px-1.5 py-0 text-slate-500">{r.hours}h</Badge>
                        )}
                        <Badge variant={STATUS_VARIANT[r.status] || "outline"} className="text-[11px] px-1.5 py-0">
                          {STATUS_LABEL[r.status] || r.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {r.startDate} ～ {r.endDate}（{daysBetween(r.startDate, r.endDate)} 天）
                      </p>
                      {r.reason && <p className="text-xs text-slate-500 truncate">{r.reason}</p>}
                      {r.reviewNote && (
                        <p className="text-xs text-slate-400">備註：{r.reviewNote}</p>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => { setSelected(r); setReviewNote(r.reviewNote || ""); }}
                      data-testid={`button-review-${r.id}`}
                    >
                      <Eye className="h-3.5 w-3.5 mr-1" />
                      {r.status === "pending" ? "審核" : "查看"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Review Dialog */}
      {selected && (
        <Dialog open={!!selected} onOpenChange={(open) => { if (!open) { setSelected(null); setReviewNote(""); } }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>請假申請詳情</DialogTitle>
            </DialogHeader>

            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-xs text-muted-foreground">員工</p>
                  <p className="font-medium">{selected.employeeName}（{selected.employeeCode}）</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">假別</p>
                  <p className="font-medium">{selected.leaveType}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">請假期間</p>
                  <p className="font-medium">{selected.startDate} ～ {selected.endDate}（{daysBetween(selected.startDate, selected.endDate)} 天）</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">時數 / 狀態</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {selected.hours != null && (
                      <span className="text-sm font-medium">{selected.hours}h</span>
                    )}
                    <Badge variant={STATUS_VARIANT[selected.status] || "outline"}>
                      {STATUS_LABEL[selected.status] || selected.status}
                    </Badge>
                  </div>
                </div>
              </div>

              {selected.reason && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">原因</p>
                  <p className="text-sm bg-muted rounded p-2">{selected.reason}</p>
                </div>
              )}

              {selected.certificateImageUrl && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">證明文件</p>
                  <img
                    src={selected.certificateImageUrl}
                    alt="證明文件"
                    className="max-h-48 w-auto rounded-lg border cursor-pointer hover:opacity-90 transition"
                    onClick={() => setCertOpen(true)}
                    data-testid="img-certificate"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">點擊圖片放大</p>
                </div>
              )}

              {selected.reviewedByName && (
                <div className="text-xs text-muted-foreground bg-muted rounded p-2">
                  已由 {selected.reviewedByName} 於 {selected.reviewedAt ? format(parseISO(selected.reviewedAt), "MM/dd HH:mm", { locale: zhTW }) : ""} 審核
                </div>
              )}

              {selected.status === "pending" && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">審核備註（選填）</p>
                  <Textarea
                    value={reviewNote}
                    onChange={(e) => setReviewNote(e.target.value)}
                    placeholder="輸入備註..."
                    rows={2}
                    data-testid="textarea-review-note"
                  />
                </div>
              )}
            </div>

            {selected.status === "pending" && (
              <DialogFooter className="gap-2 flex-row justify-end">
                <Button
                  variant="destructive"
                  onClick={() => handleReview("rejected")}
                  disabled={reviewMutation.isPending}
                  data-testid="button-reject"
                >
                  <XCircle className="h-4 w-4 mr-1" />
                  拒絕
                </Button>
                <Button
                  onClick={() => handleReview("approved")}
                  disabled={reviewMutation.isPending}
                  data-testid="button-approve"
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  核准
                </Button>
              </DialogFooter>
            )}
          </DialogContent>
        </Dialog>
      )}

      {/* Certificate full-screen */}
      {certOpen && selected?.certificateImageUrl && (
        <Dialog open={certOpen} onOpenChange={setCertOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>證明文件</DialogTitle>
            </DialogHeader>
            <img src={selected.certificateImageUrl} alt="證明文件" className="w-full h-auto rounded-lg" data-testid="img-certificate-full" />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
