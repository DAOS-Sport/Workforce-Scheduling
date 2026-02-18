import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit2, Trash2, FileText, Video, Shield, Eye, Users, GripVertical, BookOpen, CalendarDays, Lock } from "lucide-react";
import type { Guideline, GuidelineAck, Employee } from "@shared/schema";

type GuidelineCategory = "fixed" | "monthly" | "confidentiality";

const CATEGORY_LABELS: Record<GuidelineCategory, string> = {
  fixed: "固定守則",
  monthly: "每月說明",
  confidentiality: "保密同意書",
};

const CATEGORY_ICONS: Record<GuidelineCategory, typeof BookOpen> = {
  fixed: BookOpen,
  monthly: CalendarDays,
  confidentiality: Lock,
};

function getCurrentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getYearMonthOptions() {
  const options: string[] = [];
  const now = new Date();
  for (let i = -3; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    options.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return options;
}

export default function GuidelinesPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<GuidelineCategory>("fixed");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Guideline | null>(null);
  const [viewAckDialogOpen, setViewAckDialogOpen] = useState(false);
  const [viewingGuidelineId, setViewingGuidelineId] = useState<number | null>(null);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewItem, setPreviewItem] = useState<Guideline | null>(null);

  const [form, setForm] = useState({
    title: "",
    content: "",
    contentType: "text" as "text" | "video",
    videoUrl: "",
    sortOrder: 0,
    isActive: true,
    yearMonth: getCurrentYearMonth(),
  });

  const { data: allGuidelines = [], isLoading } = useQuery<Guideline[]>({
    queryKey: ["/api/guidelines"],
  });

  const filtered = allGuidelines.filter((g) => g.category === activeTab);

  const { data: employeesA = [] } = useQuery<Employee[]>({
    queryKey: ["/api/employees", "A"],
  });
  const { data: employeesB = [] } = useQuery<Employee[]>({
    queryKey: ["/api/employees", "B"],
  });
  const { data: employeesC = [] } = useQuery<Employee[]>({
    queryKey: ["/api/employees", "C"],
  });
  const allEmployees = [...employeesA, ...employeesB, ...employeesC];

  const { data: acks = [] } = useQuery<GuidelineAck[]>({
    queryKey: ["/api/guidelines", viewingGuidelineId, "acknowledgments"],
    enabled: !!viewingGuidelineId,
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/guidelines", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/guidelines"] });
      toast({ title: "已新增守則" });
      setDialogOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "新增失敗", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await apiRequest("PATCH", `/api/guidelines/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/guidelines"] });
      toast({ title: "已更新守則" });
      setDialogOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "更新失敗", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/guidelines/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/guidelines"] });
      toast({ title: "已刪除守則" });
    },
    onError: (err: Error) => {
      toast({ title: "刪除失敗", description: err.message, variant: "destructive" });
    },
  });

  function openCreate() {
    setEditingItem(null);
    setForm({
      title: "",
      content: "",
      contentType: "text",
      videoUrl: "",
      sortOrder: filtered.length,
      isActive: true,
      yearMonth: getCurrentYearMonth(),
    });
    setDialogOpen(true);
  }

  function openEdit(item: Guideline) {
    setEditingItem(item);
    setForm({
      title: item.title,
      content: item.content,
      contentType: item.contentType as "text" | "video",
      videoUrl: item.videoUrl || "",
      sortOrder: item.sortOrder,
      isActive: item.isActive,
      yearMonth: item.yearMonth || getCurrentYearMonth(),
    });
    setDialogOpen(true);
  }

  function handleSave() {
    const payload: any = {
      category: activeTab,
      title: form.title,
      content: form.content,
      contentType: form.contentType,
      videoUrl: form.videoUrl || null,
      sortOrder: form.sortOrder,
      isActive: form.isActive,
      yearMonth: activeTab === "monthly" ? form.yearMonth : null,
    };

    if (editingItem) {
      updateMutation.mutate({ id: editingItem.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  function openAckView(guidelineId: number) {
    setViewingGuidelineId(guidelineId);
    setViewAckDialogOpen(true);
  }

  function openPreview(item: Guideline) {
    setPreviewItem(item);
    setPreviewDialogOpen(true);
  }

  const ackedEmployeeIds = new Set(acks.map((a) => a.employeeId));

  return (
    <div className="flex flex-col h-full overflow-auto p-4 gap-4">
      <div>
        <h1 className="text-xl font-bold" data-testid="text-page-title">守則管理</h1>
        <p className="text-sm text-muted-foreground">管理員工上班守則、每月新增說明及保密同意書</p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as GuidelineCategory)}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <TabsList>
            {(Object.keys(CATEGORY_LABELS) as GuidelineCategory[]).map((cat) => {
              const Icon = CATEGORY_ICONS[cat];
              return (
                <TabsTrigger key={cat} value={cat} data-testid={`tab-${cat}`}>
                  <Icon className="h-4 w-4 mr-1" />
                  {CATEGORY_LABELS[cat]}
                </TabsTrigger>
              );
            })}
          </TabsList>
          <Button onClick={openCreate} data-testid="button-add-guideline">
            <Plus className="h-4 w-4 mr-1" />
            新增{CATEGORY_LABELS[activeTab]}
          </Button>
        </div>

        {(Object.keys(CATEGORY_LABELS) as GuidelineCategory[]).map((cat) => (
          <TabsContent key={cat} value={cat} className="mt-4">
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : filtered.length === 0 ? (
              <Card className="p-8 text-center">
                <div className="text-muted-foreground">
                  <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>尚未建立{CATEGORY_LABELS[cat]}</p>
                  <p className="text-xs mt-1">點擊上方按鈕新增</p>
                </div>
              </Card>
            ) : (
              <div className="space-y-3">
                {filtered
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .map((item) => (
                    <GuidelineCard
                      key={item.id}
                      item={item}
                      onEdit={() => openEdit(item)}
                      onDelete={() => deleteMutation.mutate(item.id)}
                      onViewAck={() => openAckView(item.id)}
                      onPreview={() => openPreview(item)}
                      isDeleting={deleteMutation.isPending}
                    />
                  ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingItem ? "編輯" : "新增"}{CATEGORY_LABELS[activeTab]}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>標題</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="輸入標題"
                data-testid="input-guideline-title"
              />
            </div>

            <div className="space-y-2">
              <Label>內容類型</Label>
              <Select
                value={form.contentType}
                onValueChange={(v) => setForm({ ...form, contentType: v as "text" | "video" })}
              >
                <SelectTrigger data-testid="select-content-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">
                    <div className="flex items-center gap-1">
                      <FileText className="h-3 w-3" /> 文字
                    </div>
                  </SelectItem>
                  <SelectItem value="video">
                    <div className="flex items-center gap-1">
                      <Video className="h-3 w-3" /> 影片
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>內容</Label>
              <Textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder="輸入守則內容..."
                rows={6}
                data-testid="input-guideline-content"
              />
            </div>

            {form.contentType === "video" && (
              <div className="space-y-2">
                <Label>影片連結</Label>
                <Input
                  value={form.videoUrl}
                  onChange={(e) => setForm({ ...form, videoUrl: e.target.value })}
                  placeholder="https://youtube.com/..."
                  data-testid="input-guideline-video-url"
                />
              </div>
            )}

            {activeTab === "monthly" && (
              <div className="space-y-2">
                <Label>適用月份</Label>
                <Select
                  value={form.yearMonth}
                  onValueChange={(v) => setForm({ ...form, yearMonth: v })}
                >
                  <SelectTrigger data-testid="select-year-month">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {getYearMonthOptions().map((ym) => (
                      <SelectItem key={ym} value={ym}>{ym}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label>排序順序</Label>
              <Input
                type="number"
                value={form.sortOrder}
                onChange={(e) => setForm({ ...form, sortOrder: parseInt(e.target.value) || 0 })}
                data-testid="input-guideline-sort"
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={form.isActive}
                onCheckedChange={(v) => setForm({ ...form, isActive: v })}
                data-testid="switch-guideline-active"
              />
              <Label>啟用中</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-guideline">
              取消
            </Button>
            <Button
              onClick={handleSave}
              disabled={!form.title || createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-guideline"
            >
              {createMutation.isPending || updateMutation.isPending ? "儲存中..." : "儲存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={viewAckDialogOpen} onOpenChange={setViewAckDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>確認紀錄</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[400px] overflow-auto">
            {allEmployees.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">無員工資料</p>
            ) : (
              allEmployees.map((emp) => {
                const acked = ackedEmployeeIds.has(emp.id);
                const ackRecord = acks.find((a) => a.employeeId === emp.id);
                return (
                  <div
                    key={emp.id}
                    className="flex items-center justify-between gap-2 py-1 border-b last:border-b-0"
                    data-testid={`ack-row-${emp.id}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{emp.name}</span>
                      <span className="text-xs text-muted-foreground">{emp.employeeCode}</span>
                    </div>
                    {acked ? (
                      <Badge variant="default" className="text-xs">
                        <Shield className="h-3 w-3 mr-1" />
                        已確認
                        {ackRecord?.acknowledgedAt && (
                          <span className="ml-1 opacity-70">
                            {new Date(ackRecord.acknowledgedAt).toLocaleDateString("zh-TW")}
                          </span>
                        )}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">
                        未確認
                      </Badge>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <DialogFooter>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Users className="h-3 w-3" />
              {ackedEmployeeIds.size} / {allEmployees.length} 已確認
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={previewDialogOpen} onOpenChange={setPreviewDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{previewItem?.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {previewItem?.contentType === "video" && previewItem?.videoUrl && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">影片連結</Label>
                <a
                  href={previewItem.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary underline break-all"
                  data-testid="link-preview-video"
                >
                  {previewItem.videoUrl}
                </a>
              </div>
            )}
            <div className="whitespace-pre-wrap text-sm leading-relaxed" data-testid="text-preview-content">
              {previewItem?.content}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GuidelineCard({
  item,
  onEdit,
  onDelete,
  onViewAck,
  onPreview,
  isDeleting,
}: {
  item: Guideline;
  onEdit: () => void;
  onDelete: () => void;
  onViewAck: () => void;
  onPreview: () => void;
  isDeleting: boolean;
}) {
  return (
    <Card className="p-4" data-testid={`card-guideline-${item.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-medium text-sm">{item.title}</h3>
            {!item.isActive && (
              <Badge variant="secondary" className="text-xs">停用</Badge>
            )}
            {item.contentType === "video" && (
              <Badge variant="outline" className="text-xs">
                <Video className="h-3 w-3 mr-1" />
                影片
              </Badge>
            )}
            {item.yearMonth && (
              <Badge variant="outline" className="text-xs">
                <CalendarDays className="h-3 w-3 mr-1" />
                {item.yearMonth}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
            {item.content || "(無內容)"}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button size="icon" variant="ghost" onClick={onPreview} data-testid={`button-preview-${item.id}`}>
            <Eye className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={onViewAck} data-testid={`button-view-ack-${item.id}`}>
            <Users className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={onEdit} data-testid={`button-edit-guideline-${item.id}`}>
            <Edit2 className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onDelete}
            disabled={isDeleting}
            data-testid={`button-delete-guideline-${item.id}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
