import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { zhTW } from "date-fns/locale";
import { Megaphone, Plus, Trash2, Globe, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Announcement {
  id: number;
  title: string;
  content: string;
  targetRegion: string | null;
  publishedAt: string;
  expiresAt: string | null;
  createdBy: number | null;
}

const REGION_LABELS: Record<string, string> = {
  A: "三蘆戰區",
  B: "松山國小",
  C: "新竹區",
  D: "內勤",
};

export default function AnnouncementsPage() {
  const { toast } = useToast();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [targetRegion, setTargetRegion] = useState<string>("all");
  const [expiresAt, setExpiresAt] = useState<string>("");

  const { data: announcements = [], isLoading } = useQuery<Announcement[]>({
    queryKey: ["/api/announcements"],
    staleTime: 60 * 1000,
  });

  const createMutation = useMutation({
    mutationFn: async (data: object) => {
      const res = await apiRequest("POST", "/api/announcements", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/announcements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/announcements/active"] });
      setCreateDialogOpen(false);
      setTitle("");
      setContent("");
      setTargetRegion("all");
      setExpiresAt("");
      toast({ title: "公告已發布", description: "員工Portal將立即顯示此公告" });
    },
    onError: (err: any) => {
      toast({ title: "發布失敗", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
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

  const handleCreate = () => {
    if (!title.trim() || !content.trim()) {
      toast({ title: "請填寫標題和內容", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      title: title.trim(),
      content: content.trim(),
      targetRegion: targetRegion === "all" ? null : targetRegion,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    });
  };

  const now = new Date();
  const activeAnnouncements = announcements.filter((a) => !a.expiresAt || new Date(a.expiresAt) > now);
  const expiredAnnouncements = announcements.filter((a) => a.expiresAt && new Date(a.expiresAt) <= now);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100">
            <Megaphone className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold">公告管理</h1>
            <p className="text-sm text-muted-foreground">發布公告至員工Portal班表頁面</p>
          </div>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)} data-testid="button-create-announcement">
          <Plus className="h-4 w-4 mr-1.5" />
          發布公告
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
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
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-red-500 shrink-0"
                          onClick={() => deleteMutation.mutate(ann.id)}
                          disabled={deleteMutation.isPending}
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
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-red-500 shrink-0"
                          onClick={() => deleteMutation.mutate(ann.id)}
                          disabled={deleteMutation.isPending}
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

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>發布公告</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>公告標題</Label>
              <Input
                placeholder="請輸入標題"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                data-testid="input-announcement-title"
              />
            </div>
            <div className="space-y-1.5">
              <Label>公告內容</Label>
              <Textarea
                placeholder="請輸入公告內容"
                className="h-24 resize-none"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                data-testid="input-announcement-content"
              />
            </div>
            <div className="space-y-1.5">
              <Label>發送對象</Label>
              <Select value={targetRegion} onValueChange={setTargetRegion}>
                <SelectTrigger data-testid="select-announcement-region">
                  <SelectValue />
                </SelectTrigger>
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
              <Input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                data-testid="input-announcement-expires"
              />
              <p className="text-[11px] text-muted-foreground">不填則永不過期</p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending} data-testid="button-submit-announcement">
              {createMutation.isPending ? "發布中..." : "發布公告"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
