import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, CheckCircle2, Clock, BookOpen, CalendarDays, Lock, Filter, X } from "lucide-react";

interface AckDetail {
  id: number;
  guidelineId: number;
  employeeId: number;
  acknowledgedAt: string | null;
  guidelineTitle: string | null;
  guidelineCategory: string | null;
  employeeName: string | null;
  employeeCode: string | null;
}

interface GuidelineListItem {
  id: number;
  title: string;
  category: string;
  isActive: boolean;
  sortOrder: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  fixed: "固定守則",
  monthly: "每月說明",
  confidentiality: "保密同意書",
};

const CATEGORY_COLORS: Record<string, string> = {
  fixed: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  monthly: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  confidentiality: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
};

const CATEGORY_ICONS: Record<string, typeof BookOpen> = {
  fixed: BookOpen,
  monthly: CalendarDays,
  confidentiality: Lock,
};

function formatTaiwanTime(dt: string | null): { date: string; time: string } {
  if (!dt) return { date: "—", time: "—" };
  try {
    const d = new Date(dt);
    const taiwan = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    const date = `${taiwan.getFullYear()}/${String(taiwan.getMonth() + 1).padStart(2, "0")}/${String(taiwan.getDate()).padStart(2, "0")}`;
    const time = `${String(taiwan.getHours()).padStart(2, "0")}:${String(taiwan.getMinutes()).padStart(2, "0")}`;
    return { date, time };
  } catch {
    return { date: "—", time: "—" };
  }
}

function getCurrentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function GuidelineAcksPage() {
  const { toast } = useToast();

  // Filters
  const [searchEmp, setSearchEmp] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterGuidelineId, setFilterGuidelineId] = useState("all");

  // Create guideline dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newForm, setNewForm] = useState({
    title: "",
    content: "",
    category: "fixed" as "fixed" | "monthly" | "confidentiality",
    yearMonth: getCurrentYearMonth(),
    isActive: true,
    sortOrder: 0,
  });

  // Queries
  const { data: acks = [], isLoading: acksLoading } = useQuery<AckDetail[]>({
    queryKey: ["/api/guidelines/all-acknowledgments"],
  });

  const { data: guidelines = [] } = useQuery<GuidelineListItem[]>({
    queryKey: ["/api/guidelines"],
  });

  // Create guideline mutation
  const createMutation = useMutation({
    mutationFn: (payload: object) => apiRequest("POST", "/api/guidelines", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/guidelines"] });
      queryClient.invalidateQueries({ queryKey: ["/api/guidelines/all-acknowledgments"] });
      toast({ title: "✅ 守則已建立", description: `「${newForm.title}」已新增，員工下次登入時將需確認閱讀。` });
      setCreateOpen(false);
      setNewForm({ title: "", content: "", category: "fixed", yearMonth: getCurrentYearMonth(), isActive: true, sortOrder: 0 });
    },
    onError: (err: any) => {
      toast({ title: "建立失敗", description: err.message, variant: "destructive" });
    },
  });

  const handleCreate = () => {
    if (!newForm.title.trim()) {
      toast({ title: "請填寫標題", variant: "destructive" });
      return;
    }
    const payload: any = {
      title: newForm.title.trim(),
      content: newForm.content.trim(),
      category: newForm.category,
      isActive: newForm.isActive,
      sortOrder: newForm.sortOrder,
      contentType: "text",
    };
    if (newForm.category === "monthly") {
      payload.yearMonth = newForm.yearMonth;
    }
    createMutation.mutate(payload);
  };

  // Filtered acks
  const filtered = useMemo(() => {
    return acks.filter((a) => {
      if (filterCategory !== "all" && a.guidelineCategory !== filterCategory) return false;
      if (filterGuidelineId !== "all" && String(a.guidelineId) !== filterGuidelineId) return false;
      if (searchEmp) {
        const q = searchEmp.toLowerCase();
        const name = (a.employeeName || "").toLowerCase();
        const code = (a.employeeCode || "").toLowerCase();
        if (!name.includes(q) && !code.includes(q)) return false;
      }
      return true;
    });
  }, [acks, filterCategory, filterGuidelineId, searchEmp]);

  // Stats
  const totalAcks = acks.length;
  const uniqueEmployees = new Set(acks.map((a) => a.employeeId)).size;
  const uniqueGuidelines = new Set(acks.map((a) => a.guidelineId)).size;

  const hasFilters = searchEmp || filterCategory !== "all" || filterGuidelineId !== "all";

  const clearFilters = () => {
    setSearchEmp("");
    setFilterCategory("all");
    setFilterGuidelineId("all");
  };

  return (
    <div className="h-full overflow-auto">
      <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">守則簽署管理</h1>
            <p className="text-sm text-muted-foreground mt-0.5">查看員工確認守則的時間紀錄，以及新增需要員工閱讀的守則</p>
          </div>
          <Button
            onClick={() => setCreateOpen(true)}
            data-testid="button-create-guideline"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            新增守則
          </Button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
          <Card className="border-0 shadow-sm bg-blue-50 dark:bg-blue-950/30">
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0" />
                <div>
                  <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">{totalAcks}</p>
                  <p className="text-xs text-blue-600/80 dark:text-blue-400/80">總簽署筆數</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm bg-emerald-50 dark:bg-emerald-950/30">
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <div>
                  <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{uniqueEmployees}</p>
                  <p className="text-xs text-emerald-600/80 dark:text-emerald-400/80">已簽署人數</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm bg-violet-50 dark:bg-violet-950/30">
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-violet-600 dark:text-violet-400 shrink-0" />
                <div>
                  <p className="text-2xl font-bold text-violet-700 dark:text-violet-300">{uniqueGuidelines}</p>
                  <p className="text-xs text-violet-600/80 dark:text-violet-400/80">涉及守則數</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="shadow-sm">
          <CardContent className="p-3">
            <div className="flex flex-wrap gap-2 items-center">
              <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="relative flex-1 min-w-[160px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="搜尋員工姓名或編號…"
                  value={searchEmp}
                  onChange={(e) => setSearchEmp(e.target.value)}
                  className="pl-8 h-8 text-sm"
                  data-testid="input-search-employee"
                />
              </div>
              <Select value={filterCategory} onValueChange={(v) => { setFilterCategory(v); setFilterGuidelineId("all"); }}>
                <SelectTrigger className="h-8 text-sm w-[140px]" data-testid="select-filter-category">
                  <SelectValue placeholder="全部類別" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部類別</SelectItem>
                  <SelectItem value="fixed">固定守則</SelectItem>
                  <SelectItem value="monthly">每月說明</SelectItem>
                  <SelectItem value="confidentiality">保密同意書</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterGuidelineId} onValueChange={setFilterGuidelineId}>
                <SelectTrigger className="h-8 text-sm w-[180px]" data-testid="select-filter-guideline">
                  <SelectValue placeholder="全部守則" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部守則</SelectItem>
                  {guidelines
                    .filter((g) => filterCategory === "all" || g.category === filterCategory)
                    .map((g) => (
                      <SelectItem key={g.id} value={String(g.id)}>
                        {g.title}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {hasFilters && (
                <Button variant="ghost" size="sm" className="h-8 text-xs px-2" onClick={clearFilters} data-testid="button-clear-filters">
                  <X className="h-3 w-3 mr-1" />
                  清除篩選
                </Button>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {filtered.length} 筆{hasFilters ? `（共 ${totalAcks} 筆）` : ""}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Ack table */}
        <Card className="shadow-sm">
          <CardContent className="p-0">
            {acksLoading ? (
              <div className="p-4 space-y-2">
                {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-16 text-center">
                <CheckCircle2 className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  {hasFilters ? "找不到符合篩選條件的紀錄" : "尚無任何簽署紀錄"}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs">員工</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs">守則名稱</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs">類別</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs">
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          簽署日期
                        </div>
                      </th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs">
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          簽署時間
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((ack, idx) => {
                      const { date, time } = formatTaiwanTime(ack.acknowledgedAt);
                      const CatIcon = CATEGORY_ICONS[ack.guidelineCategory || "fixed"] || BookOpen;
                      return (
                        <tr
                          key={ack.id}
                          className={`border-b last:border-0 hover:bg-muted/20 transition-colors ${idx % 2 === 0 ? "" : "bg-muted/5"}`}
                          data-testid={`row-ack-${ack.id}`}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="h-7 w-7 rounded-full bg-gradient-to-br from-slate-400 to-slate-500 dark:from-slate-600 dark:to-slate-700 flex items-center justify-center text-white text-[11px] font-bold shrink-0">
                                {(ack.employeeName || "?").charAt(0)}
                              </div>
                              <div>
                                <p className="font-medium leading-tight" data-testid={`text-emp-name-${ack.id}`}>{ack.employeeName || "未知"}</p>
                                <p className="text-[11px] text-muted-foreground">{ack.employeeCode || ""}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-medium" data-testid={`text-guideline-title-${ack.id}`}>{ack.guidelineTitle || "已刪除守則"}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${CATEGORY_COLORS[ack.guidelineCategory || ""] || "bg-gray-100 text-gray-600"}`}>
                              <CatIcon className="h-3 w-3" />
                              {CATEGORY_LABELS[ack.guidelineCategory || ""] || ack.guidelineCategory || "—"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground" data-testid={`text-ack-date-${ack.id}`}>
                            {date}
                          </td>
                          <td className="px-4 py-3" data-testid={`text-ack-time-${ack.id}`}>
                            <span className="inline-flex items-center gap-1 font-mono text-sm font-semibold text-foreground">
                              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                              {time}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create guideline dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>新增守則</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground -mt-1">
            建立後，符合條件的員工下次進入系統時將被要求點選確認閱讀。
          </p>
          <div className="space-y-4 mt-1">
            <div className="space-y-1.5">
              <Label>守則標題 <span className="text-red-500">*</span></Label>
              <Input
                placeholder="例：泳池安全守則、保密同意書…"
                value={newForm.title}
                onChange={(e) => setNewForm({ ...newForm, title: e.target.value })}
                data-testid="input-new-guideline-title"
              />
            </div>

            <div className="space-y-1.5">
              <Label>類別</Label>
              <Select
                value={newForm.category}
                onValueChange={(v) => setNewForm({ ...newForm, category: v as any })}
              >
                <SelectTrigger data-testid="select-new-guideline-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">固定守則（長期有效）</SelectItem>
                  <SelectItem value="monthly">每月說明（指定月份）</SelectItem>
                  <SelectItem value="confidentiality">保密同意書</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {newForm.category === "monthly" && (
              <div className="space-y-1.5">
                <Label>適用月份</Label>
                <Input
                  type="month"
                  value={newForm.yearMonth}
                  onChange={(e) => setNewForm({ ...newForm, yearMonth: e.target.value })}
                  data-testid="input-new-guideline-month"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>內容</Label>
              <Textarea
                placeholder="請輸入守則內容…&#10;&#10;例：&#10;1. 救生員必須持有合格證照&#10;2. 上班前需檢查救生器材&#10;3. 值班期間禁止使用手機"
                className="min-h-[160px] resize-y font-mono text-sm leading-relaxed"
                value={newForm.content}
                onChange={(e) => setNewForm({ ...newForm, content: e.target.value })}
                data-testid="input-new-guideline-content"
              />
              <p className="text-[11px] text-muted-foreground">支援純文字，換行會保留。如需圖片請至「守則與公告」頁面編輯。</p>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <Switch
                checked={newForm.isActive}
                onCheckedChange={(v) => setNewForm({ ...newForm, isActive: v })}
                data-testid="switch-new-guideline-active"
              />
              <Label className="cursor-pointer">建立後立即啟用</Label>
              <span className="text-xs text-muted-foreground">（關閉則不會要求員工確認）</span>
            </div>
          </div>
          <DialogFooter className="gap-2 mt-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)} data-testid="button-cancel-create">取消</Button>
            <Button
              onClick={handleCreate}
              disabled={!newForm.title.trim() || createMutation.isPending}
              data-testid="button-submit-create"
            >
              {createMutation.isPending ? "建立中…" : "建立守則"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
