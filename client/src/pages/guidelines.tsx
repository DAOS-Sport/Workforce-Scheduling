import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, startOfMonth, endOfMonth, parseISO } from "date-fns";
import { zhTW } from "date-fns/locale";
import { Card, CardContent } from "@/components/ui/card";
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
import { Plus, Edit2, Trash2, FileText, Video, Image, Shield, Eye, Users, BookOpen, CalendarDays, Lock, MapPin, Megaphone, Globe } from "lucide-react";
import type { Guideline, GuidelineAck, Employee, Venue, Shift } from "@shared/schema";

type GuidelineCategory = "fixed" | "monthly" | "confidentiality";
type ActiveTab = GuidelineCategory | "announcements";

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

const REGION_LABELS: Record<string, string> = {
  A: "三蘆戰區",
  B: "松山國小",
  C: "新竹區",
  D: "內勤",
};

interface Announcement {
  id: number;
  title: string;
  content: string;
  targetRegion: string | null;
  publishedAt: string;
  expiresAt: string | null;
  createdBy: number | null;
}

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
  const [activeTab, setActiveTab] = useState<ActiveTab>("fixed");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Guideline | null>(null);
  const [viewAckDialogOpen, setViewAckDialogOpen] = useState(false);
  const [viewingGuideline, setViewingGuideline] = useState<Guideline | null>(null);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewItem, setPreviewItem] = useState<Guideline | null>(null);

  const [form, setForm] = useState({
    title: "",
    content: "",
    contentType: "text" as "text" | "video" | "image",
    videoUrl: "",
    imageUrl: "",
    venueId: null as number | null,
    sortOrder: 0,
    isActive: true,
    yearMonth: getCurrentYearMonth(),
  });

  // Announcement form state
  const [annDialogOpen, setAnnDialogOpen] = useState(false);
  const [annTitle, setAnnTitle] = useState("");
  const [annContent, setAnnContent] = useState("");
  const [annTargetRegion, setAnnTargetRegion] = useState<string>("all");
  const [annExpiresAt, setAnnExpiresAt] = useState<string>("");

  const { data: allGuidelines = [], isLoading } = useQuery<Guideline[]>({
    queryKey: ["/api/guidelines"],
  });

  const filtered = allGuidelines.filter((g) => g.category === activeTab);

  const { data: employeesA = [] } = useQuery<Employee[]>({ queryKey: ["/api/employees", "A"] });
  const { data: employeesB = [] } = useQuery<Employee[]>({ queryKey: ["/api/employees", "B"] });
  const { data: employeesC = [] } = useQuery<Employee[]>({ queryKey: ["/api/employees", "C"] });
  const allEmployees = [...employeesA, ...employeesB, ...employeesC];

  const { data: venuesA = [] } = useQuery<Venue[]>({ queryKey: ["/api/venues", "A"] });
  const { data: venuesB = [] } = useQuery<Venue[]>({ queryKey: ["/api/venues", "B"] });
  const { data: venuesC = [] } = useQuery<Venue[]>({ queryKey: ["/api/venues", "C"] });
  const allVenues = [...venuesA, ...venuesB, ...venuesC];
  const venueMap = useMemo(() => {
    const map = new Map<number, Venue>();
    allVenues.forEach((v) => map.set(v.id, v));
    return map;
  }, [allVenues]);

  const now = new Date();
  const monthStart = format(startOfMonth(now), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(now), "yyyy-MM-dd");

  const { data: shiftsA = [] } = useQuery<Shift[]>({ queryKey: ["/api/shifts", "A", monthStart, monthEnd] });
  const { data: shiftsB = [] } = useQuery<Shift[]>({ queryKey: ["/api/shifts", "B", monthStart, monthEnd] });
  const { data: shiftsC = [] } = useQuery<Shift[]>({ queryKey: ["/api/shifts", "C", monthStart, monthEnd] });
  const allShifts = [...shiftsA, ...shiftsB, ...shiftsC];

  const employeesByVenue = useMemo(() => {
    const map = new Map<number, Set<number>>();
    allShifts.forEach((s) => {
      if (!map.has(s.venueId)) map.set(s.venueId, new Set());
      map.get(s.venueId)!.add(s.employeeId);
    });
    return map;
  }, [allShifts]);

  const { data: acks = [] } = useQuery<GuidelineAck[]>({
    queryKey: ["/api/guidelines", viewingGuideline?.id, "acknowledgments"],
    enabled: !!viewingGuideline?.id,
  });

  // Announcements query
  const { data: announcements = [], isLoading: annLoading } = useQuery<Announcement[]>({
    queryKey: ["/api/announcements"],
    staleTime: 60 * 1000,
    enabled: activeTab === "announcements",
  });
  const activeAnnouncements = announcements.filter((a) => !a.expiresAt || new Date(a.expiresAt) > now);
  const expiredAnnouncements = announcements.filter((a) => a.expiresAt && new Date(a.expiresAt) <= now);

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

  const createAnnMutation = useMutation({
    mutationFn: async (data: object) => {
      const res = await apiRequest("POST", "/api/announcements", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/announcements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/announcements/active"] });
      setAnnDialogOpen(false);
      setAnnTitle(""); setAnnContent(""); setAnnTargetRegion("all"); setAnnExpiresAt("");
      toast({ title: "公告已發布", description: "員工Portal將立即顯示此公告" });
    },
    onError: (err: any) => {
      toast({ title: "發布失敗", description: err.message, variant: "destructive" });
    },
  });

  const deleteAnnMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/announcements/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/announcements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/announcements/active"] });
      toast({ title: "公告已刪除" });
    },
  });

  function openCreate() {
    setEditingItem(null);
    setForm({
      title: "", content: "", contentType: "text", videoUrl: "", imageUrl: "",
      venueId: null, sortOrder: filtered.length, isActive: true,
      yearMonth: getCurrentYearMonth(),
    });
    setDialogOpen(true);
  }

  function openEdit(item: Guideline) {
    setEditingItem(item);
    setForm({
      title: item.title, content: item.content,
      contentType: item.contentType as "text" | "video" | "image",
      videoUrl: item.videoUrl || "",
      imageUrl: item.imageUrl || "",
      venueId: item.venueId,
      sortOrder: item.sortOrder, isActive: item.isActive,
      yearMonth: item.yearMonth || getCurrentYearMonth(),
    });
    setDialogOpen(true);
  }

  function handleSave() {
    const payload: any = {
      category: activeTab,
      title: form.title, content: form.content,
      contentType: form.contentType,
      videoUrl: form.contentType === "video" ? form.videoUrl || null : null,
      imageUrl: form.contentType === "image" ? form.imageUrl || null : null,
      venueId: activeTab === "fixed" ? form.venueId : null,
      sortOrder: form.sortOrder, isActive: form.isActive,
      yearMonth: activeTab === "monthly" ? form.yearMonth : null,
    };
    if (editingItem) {
      updateMutation.mutate({ id: editingItem.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  function handleCreateAnn() {
    if (!annTitle.trim() || !annContent.trim()) {
      toast({ title: "請填寫標題和內容", variant: "destructive" });
      return;
    }
    createAnnMutation.mutate({
      title: annTitle.trim(), content: annContent.trim(),
      targetRegion: annTargetRegion === "all" ? null : annTargetRegion,
      expiresAt: annExpiresAt ? new Date(annExpiresAt).toISOString() : null,
    });
  }

  function openAckView(guideline: Guideline) {
    setViewingGuideline(guideline);
    setViewAckDialogOpen(true);
  }

  function openPreview(item: Guideline) {
    setPreviewItem(item);
    setPreviewDialogOpen(true);
  }

  const ackedEmployeeIds = new Set(acks.map((a) => a.employeeId));

  const ackTargetEmployees = useMemo(() => {
    if (!viewingGuideline) return allEmployees;
    if (viewingGuideline.category === "fixed" && viewingGuideline.venueId) {
      const scheduledEmpIds = employeesByVenue.get(viewingGuideline.venueId);
      if (!scheduledEmpIds || scheduledEmpIds.size === 0) return [];
      return allEmployees.filter((e) => scheduledEmpIds.has(e.id));
    }
    return allEmployees;
  }, [viewingGuideline, allEmployees, employeesByVenue]);

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-5 border-b border-border/50">
        <div>
          <h1 className="text-xl font-bold tracking-tight" data-testid="text-page-title">守則與公告</h1>
          <p className="text-sm text-muted-foreground mt-0.5">管理員工守則、每月說明、保密同意書及Portal公告</p>
        </div>
      </div>
      <div className="p-4 space-y-4">

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ActiveTab)}>
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
            <TabsTrigger value="announcements" data-testid="tab-announcements">
              <Megaphone className="h-4 w-4 mr-1" />
              公告
            </TabsTrigger>
          </TabsList>

          {activeTab !== "announcements" ? (
            <Button onClick={openCreate} data-testid="button-add-guideline">
              <Plus className="h-4 w-4 mr-1" />
              新增{CATEGORY_LABELS[activeTab as GuidelineCategory]}
            </Button>
          ) : (
            <Button onClick={() => setAnnDialogOpen(true)} data-testid="button-create-announcement">
              <Plus className="h-4 w-4 mr-1" />
              發布公告
            </Button>
          )}
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
                      venueName={item.venueId ? venueMap.get(item.venueId)?.shortName : undefined}
                      onEdit={() => openEdit(item)}
                      onDelete={() => deleteMutation.mutate(item.id)}
                      onViewAck={() => openAckView(item)}
                      onPreview={() => openPreview(item)}
                      isDeleting={deleteMutation.isPending}
                    />
                  ))}
              </div>
            )}
          </TabsContent>
        ))}

        <TabsContent value="announcements" className="mt-4">
          {annLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  有效公告 ({activeAnnouncements.length})
                </h2>
                {activeAnnouncements.length === 0 ? (
                  <Card>
                    <CardContent className="py-8 text-center text-sm text-muted-foreground">
                      目前沒有有效公告
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {activeAnnouncements.map((ann) => (
                      <Card key={ann.id} data-testid={`announcement-item-${ann.id}`}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-medium text-sm">{ann.title}</span>
                                {ann.targetRegion ? (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5">
                                    <MapPin className="h-2.5 w-2.5 mr-0.5" />
                                    {REGION_LABELS[ann.targetRegion] || ann.targetRegion}
                                  </Badge>
                                ) : (
                                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5">
                                    <Globe className="h-2.5 w-2.5 mr-0.5" />
                                    全員
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-2">{ann.content}</p>
                              <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
                                <span>發布：{format(parseISO(ann.publishedAt), "M/d HH:mm", { locale: zhTW })}</span>
                                {ann.expiresAt && (
                                  <span>到期：{format(parseISO(ann.expiresAt), "M/d HH:mm", { locale: zhTW })}</span>
                                )}
                              </div>
                            </div>
                            <Button
                              variant="ghost" size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-red-500 shrink-0"
                              onClick={() => deleteAnnMutation.mutate(ann.id)}
                              disabled={deleteAnnMutation.isPending}
                              data-testid={`button-delete-announcement-${ann.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>

              {expiredAnnouncements.length > 0 && (
                <div>
                  <h2 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-slate-400" />
                    已過期 ({expiredAnnouncements.length})
                  </h2>
                  <div className="space-y-3 opacity-60">
                    {expiredAnnouncements.map((ann) => (
                      <Card key={ann.id}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <span className="font-medium text-sm line-through">{ann.title}</span>
                              <div className="text-[11px] text-muted-foreground mt-1">
                                到期：{format(parseISO(ann.expiresAt!), "M/d", { locale: zhTW })}
                              </div>
                            </div>
                            <Button
                              variant="ghost" size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-red-500 shrink-0"
                              onClick={() => deleteAnnMutation.mutate(ann.id)}
                              disabled={deleteAnnMutation.isPending}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Guideline create/edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingItem ? "編輯" : "新增"}{CATEGORY_LABELS[activeTab as GuidelineCategory]}</DialogTitle>
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

            {activeTab === "fixed" && (
              <div className="space-y-2">
                <Label>所屬場館</Label>
                <Select
                  value={form.venueId?.toString() || "none"}
                  onValueChange={(v) => setForm({ ...form, venueId: v === "none" ? null : parseInt(v) })}
                >
                  <SelectTrigger data-testid="select-guideline-venue">
                    <SelectValue placeholder="選擇場館" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">全部場館（通用）</SelectItem>
                    {allVenues.map((v) => (
                      <SelectItem key={v.id} value={v.id.toString()}>{v.shortName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">指定場館後，只有當月排班到該場館的員工需要確認此守則</p>
              </div>
            )}

            <div className="space-y-2">
              <Label>內容類型</Label>
              <Select
                value={form.contentType}
                onValueChange={(v) => setForm({ ...form, contentType: v as "text" | "video" | "image" })}
              >
                <SelectTrigger data-testid="select-content-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">
                    <div className="flex items-center gap-1"><FileText className="h-3 w-3" /> 文字</div>
                  </SelectItem>
                  <SelectItem value="video">
                    <div className="flex items-center gap-1"><Video className="h-3 w-3" /> 影片</div>
                  </SelectItem>
                  <SelectItem value="image">
                    <div className="flex items-center gap-1"><Image className="h-3 w-3" /> 圖片</div>
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

            {form.contentType === "image" && (
              <div className="space-y-2">
                <Label>上傳圖片</Label>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  id="guideline-image-upload"
                  data-testid="input-guideline-image"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const img = new window.Image();
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      img.onload = () => {
                        const MAX = 1024;
                        let { width, height } = img;
                        if (width > MAX || height > MAX) {
                          if (width > height) { height = Math.round((height * MAX) / width); width = MAX; }
                          else { width = Math.round((width * MAX) / height); height = MAX; }
                        }
                        const canvas = document.createElement("canvas");
                        canvas.width = width; canvas.height = height;
                        const ctx = canvas.getContext("2d")!;
                        ctx.drawImage(img, 0, 0, width, height);
                        const base64 = canvas.toDataURL("image/jpeg", 0.7);
                        setForm((f) => ({ ...f, imageUrl: base64 }));
                      };
                      img.src = ev.target?.result as string;
                    };
                    reader.readAsDataURL(file);
                    e.target.value = "";
                  }}
                />
                <label
                  htmlFor="guideline-image-upload"
                  className="flex items-center justify-center gap-2 h-10 px-4 rounded-md border border-dashed border-border cursor-pointer hover:bg-muted text-sm text-muted-foreground transition-colors"
                >
                  <Image className="h-4 w-4" />
                  選擇圖片
                </label>
                {form.imageUrl && (
                  <div className="relative mt-2">
                    <img
                      src={form.imageUrl}
                      alt="預覽"
                      className="w-full max-h-48 object-contain rounded-md border border-border"
                      data-testid="img-guideline-preview"
                    />
                    <button
                      type="button"
                      className="absolute top-1 right-1 bg-background border border-border rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:text-destructive"
                      onClick={() => setForm((f) => ({ ...f, imageUrl: "" }))}
                    >
                      移除
                    </button>
                  </div>
                )}
              </div>
            )}

            {activeTab === "monthly" && (
              <div className="space-y-2">
                <Label>適用月份</Label>
                <Select value={form.yearMonth} onValueChange={(v) => setForm({ ...form, yearMonth: v })}>
                  <SelectTrigger data-testid="select-year-month"><SelectValue /></SelectTrigger>
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
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-guideline">取消</Button>
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

      {/* Announcement create dialog */}
      <Dialog open={annDialogOpen} onOpenChange={setAnnDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>發布公告</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>公告標題</Label>
              <Input placeholder="請輸入標題" value={annTitle} onChange={(e) => setAnnTitle(e.target.value)} data-testid="input-announcement-title" />
            </div>
            <div className="space-y-1.5">
              <Label>公告內容</Label>
              <Textarea placeholder="請輸入公告內容" className="h-24 resize-none" value={annContent} onChange={(e) => setAnnContent(e.target.value)} data-testid="input-announcement-content" />
            </div>
            <div className="space-y-1.5">
              <Label>發送對象</Label>
              <Select value={annTargetRegion} onValueChange={setAnnTargetRegion}>
                <SelectTrigger data-testid="select-announcement-region"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全員</SelectItem>
                  <SelectItem value="A">三蘆戰區</SelectItem>
                  <SelectItem value="B">松山國小</SelectItem>
                  <SelectItem value="C">新竹區</SelectItem>
                  <SelectItem value="D">內勤</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>到期日（選填）</Label>
              <Input type="date" value={annExpiresAt} onChange={(e) => setAnnExpiresAt(e.target.value)} data-testid="input-announcement-expires" />
              <p className="text-[11px] text-muted-foreground">不填則永不過期</p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAnnDialogOpen(false)}>取消</Button>
            <Button onClick={handleCreateAnn} disabled={createAnnMutation.isPending} data-testid="button-submit-announcement">
              {createAnnMutation.isPending ? "發布中..." : "發布公告"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ack view dialog */}
      <Dialog open={viewAckDialogOpen} onOpenChange={setViewAckDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>確認紀錄</DialogTitle>
          </DialogHeader>
          {viewingGuideline?.venueId && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3" />
              <span>僅顯示當月排班到「{venueMap.get(viewingGuideline.venueId)?.shortName}」的員工</span>
            </div>
          )}
          <div className="space-y-3 max-h-[400px] overflow-auto">
            {ackTargetEmployees.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                {viewingGuideline?.venueId ? "當月無員工排班到此場館" : "無員工資料"}
              </p>
            ) : (
              ackTargetEmployees.map((emp) => {
                const acked = ackedEmployeeIds.has(emp.id);
                const ackRecord = acks.find((a) => a.employeeId === emp.id);
                return (
                  <div key={emp.id} className="flex items-center justify-between gap-2 py-1 border-b last:border-b-0" data-testid={`ack-row-${emp.id}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{emp.name}</span>
                      <span className="text-xs text-muted-foreground">{emp.employeeCode}</span>
                    </div>
                    {acked ? (
                      <Badge variant="default" className="text-xs">
                        <Shield className="h-3 w-3 mr-1" />
                        已確認
                        {ackRecord?.acknowledgedAt && (
                          <span className="ml-1 opacity-70">{new Date(ackRecord.acknowledgedAt).toLocaleDateString("zh-TW")}</span>
                        )}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">未確認</Badge>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <DialogFooter>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Users className="h-3 w-3" />
              {ackTargetEmployees.filter((e) => ackedEmployeeIds.has(e.id)).length} / {ackTargetEmployees.length} 已確認
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
      <Dialog open={previewDialogOpen} onOpenChange={setPreviewDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{previewItem?.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {previewItem?.venueId && (
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="text-xs">
                  <MapPin className="h-3 w-3 mr-1" />
                  {venueMap.get(previewItem.venueId)?.shortName || "未知場館"}
                </Badge>
              </div>
            )}
            {previewItem?.contentType === "video" && previewItem?.videoUrl && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">影片連結</Label>
                <a href={previewItem.videoUrl} target="_blank" rel="noopener noreferrer"
                  className="text-sm text-primary underline break-all" data-testid="link-preview-video">
                  {previewItem.videoUrl}
                </a>
              </div>
            )}
            {previewItem?.contentType === "image" && previewItem?.imageUrl && (
              <div className="space-y-2">
                <img
                  src={previewItem.imageUrl}
                  alt={previewItem.title}
                  className="w-full max-h-80 object-contain rounded-md border border-border"
                  data-testid="img-preview-guideline"
                />
              </div>
            )}
            <div className="whitespace-pre-wrap text-sm leading-relaxed" data-testid="text-preview-content">
              {previewItem?.content}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}

function GuidelineCard({
  item, venueName, onEdit, onDelete, onViewAck, onPreview, isDeleting,
}: {
  item: Guideline; venueName?: string;
  onEdit: () => void; onDelete: () => void;
  onViewAck: () => void; onPreview: () => void;
  isDeleting: boolean;
}) {
  return (
    <Card className="p-4" data-testid={`card-guideline-${item.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-medium text-sm">{item.title}</h3>
            {!item.isActive && <Badge variant="secondary" className="text-xs">停用</Badge>}
            {item.contentType === "video" && (
              <Badge variant="outline" className="text-xs">
                <Video className="h-3 w-3 mr-1" />影片
              </Badge>
            )}
            {item.contentType === "image" && (
              <Badge variant="outline" className="text-xs">
                <Image className="h-3 w-3 mr-1" />圖片
              </Badge>
            )}
            {venueName && (
              <Badge variant="outline" className="text-xs">
                <MapPin className="h-3 w-3 mr-1" />{venueName}
              </Badge>
            )}
            {item.yearMonth && (
              <Badge variant="outline" className="text-xs">
                <CalendarDays className="h-3 w-3 mr-1" />{item.yearMonth}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.content || "(無內容)"}</p>
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
            size="icon" variant="ghost"
            className="text-muted-foreground hover:text-red-500"
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
