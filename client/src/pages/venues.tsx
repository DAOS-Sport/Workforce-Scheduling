import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { RegionTabs } from "@/components/region-tabs";
import { useRegion } from "@/lib/region-context";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Building2, MapPin, Plus, Edit2, Navigation, Trash2, LifeBuoy, UserRound, Sparkles, ShieldCheck, Clock, RefreshCw } from "lucide-react";
import type { Venue, VenueShiftTemplate } from "@shared/schema";
import { REGIONS_DATA } from "@shared/schema";

const ROLE_OPTIONS = ["救生", "守望", "櫃檯", "清潔", "管理"];

const ROLE_ICON_MAP: Record<string, typeof LifeBuoy> = {
  "救生": LifeBuoy,
  "守望": ShieldCheck,
  "櫃檯": UserRound,
  "清潔": Sparkles,
  "管理": ShieldCheck,
};

interface TemplateRow {
  localId: string;
  shiftLabel: string;
  startTime: string;
  endTime: string;
  role: string;
  requiredCount: number;
}

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

export default function VenuesPage() {
  const { activeRegion } = useRegion();
  const { toast } = useToast();
  const [venueSyncing, setVenueSyncing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingVenue, setEditingVenue] = useState<Venue | null>(null);
  const [form, setForm] = useState({
    name: "",
    shortName: "",
    address: "",
    latitude: "",
    longitude: "",
    radius: "100",
  });
  const [activeTemplateTab, setActiveTemplateTab] = useState("weekday");
  const [weekdayTemplates, setWeekdayTemplates] = useState<TemplateRow[]>([]);
  const [weekendTemplates, setWeekendTemplates] = useState<TemplateRow[]>([]);

  const regionId = REGIONS_DATA.findIndex((r) => r.code === activeRegion) + 1;

  const { data: venues = [], isLoading } = useQuery<Venue[]>({
    queryKey: ["/api/venues", activeRegion],
  });

  const { data: loadedTemplates = [], refetch: refetchTemplates } = useQuery<VenueShiftTemplate[]>({
    queryKey: ["/api/venue-shift-templates", editingVenue?.id],
    enabled: !!editingVenue,
  });

  useEffect(() => {
    if (editingVenue && loadedTemplates.length >= 0) {
      const weekday = loadedTemplates
        .filter((t) => t.dayType === "weekday")
        .map((t) => ({
          localId: generateId(),
          shiftLabel: t.shiftLabel,
          startTime: t.startTime,
          endTime: t.endTime,
          role: t.role,
          requiredCount: t.requiredCount,
        }));
      const weekend = loadedTemplates
        .filter((t) => t.dayType === "weekend")
        .map((t) => ({
          localId: generateId(),
          shiftLabel: t.shiftLabel,
          startTime: t.startTime,
          endTime: t.endTime,
          role: t.role,
          requiredCount: t.requiredCount,
        }));
      setWeekdayTemplates(weekday);
      setWeekendTemplates(weekend);
    }
  }, [loadedTemplates, editingVenue]);

  const createVenue = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/venues", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/venues"] });
      toast({ title: "場館已新增" });
      setDialogOpen(false);
      resetForm();
    },
    onError: (err: Error) => {
      toast({ title: "新增失敗", description: err.message, variant: "destructive" });
    },
  });

  const updateVenue = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const res = await apiRequest("PATCH", `/api/venues/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/venues"] });
      toast({ title: "場館已更新" });
    },
    onError: (err: Error) => {
      toast({ title: "更新失敗", description: err.message, variant: "destructive" });
    },
  });

  const saveTemplatesBatch = useMutation({
    mutationFn: async ({ venueId, templates }: { venueId: number; templates: any[] }) => {
      const res = await apiRequest("POST", `/api/venue-shift-templates/batch/${venueId}`, { templates });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/venue-shift-templates"] });
      toast({ title: "班次範本已儲存" });
      setDialogOpen(false);
      resetForm();
    },
    onError: (err: Error) => {
      toast({ title: "範本儲存失敗", description: err.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setForm({ name: "", shortName: "", address: "", latitude: "", longitude: "", radius: "100" });
    setEditingVenue(null);
    setWeekdayTemplates([]);
    setWeekendTemplates([]);
    setActiveTemplateTab("weekday");
  };

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (venue: Venue) => {
    setEditingVenue(venue);
    setForm({
      name: venue.name,
      shortName: venue.shortName,
      address: venue.address || "",
      latitude: venue.latitude?.toString() || "",
      longitude: venue.longitude?.toString() || "",
      radius: venue.radius?.toString() || "100",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.shortName) return;
    const payload = {
      name: form.name,
      shortName: form.shortName,
      address: form.address || null,
      latitude: form.latitude ? parseFloat(form.latitude) : null,
      longitude: form.longitude ? parseFloat(form.longitude) : null,
      radius: parseInt(form.radius) || 100,
      regionId,
    };

    if (editingVenue) {
      await updateVenue.mutateAsync({ id: editingVenue.id, ...payload });
      const allTemplates = [
        ...weekdayTemplates.map((t) => ({ ...t, dayType: "weekday" })),
        ...weekendTemplates.map((t) => ({ ...t, dayType: "weekend" })),
      ];
      saveTemplatesBatch.mutate({ venueId: editingVenue.id, templates: allTemplates });
    } else {
      const newVenue = await createVenue.mutateAsync(payload);
      if (newVenue && newVenue.id) {
        const allTemplates = [
          ...weekdayTemplates.map((t) => ({ ...t, dayType: "weekday" })),
          ...weekendTemplates.map((t) => ({ ...t, dayType: "weekend" })),
        ];
        if (allTemplates.length > 0) {
          saveTemplatesBatch.mutate({ venueId: newVenue.id, templates: allTemplates });
        }
      }
    }
  };

  const addTemplateRow = (dayType: string) => {
    const newRow: TemplateRow = {
      localId: generateId(),
      shiftLabel: "早班",
      startTime: "08:00",
      endTime: "12:00",
      role: "救生",
      requiredCount: 1,
    };
    if (dayType === "weekday") {
      setWeekdayTemplates((prev) => [...prev, newRow]);
    } else {
      setWeekendTemplates((prev) => [...prev, newRow]);
    }
  };

  const updateTemplateRow = (dayType: string, localId: string, field: string, value: any) => {
    const setter = dayType === "weekday" ? setWeekdayTemplates : setWeekendTemplates;
    setter((prev) =>
      prev.map((r) => (r.localId === localId ? { ...r, [field]: value } : r))
    );
  };

  const removeTemplateRow = (dayType: string, localId: string) => {
    const setter = dayType === "weekday" ? setWeekdayTemplates : setWeekendTemplates;
    setter((prev) => prev.filter((r) => r.localId !== localId));
  };

  const renderTemplateRows = (rows: TemplateRow[], dayType: string) => (
    <div className="space-y-2">
      {rows.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-3">尚未設定班次範本</p>
      )}
      {rows.map((row) => {
        const RoleIcon = ROLE_ICON_MAP[row.role] || UserRound;
        return (
          <div key={row.localId} className="flex items-center gap-1.5 flex-wrap" data-testid={`template-row-${row.localId}`}>
            <Input
              value={row.shiftLabel}
              onChange={(e) => updateTemplateRow(dayType, row.localId, "shiftLabel", e.target.value)}
              className="w-16 text-xs"
              placeholder="早班"
              data-testid={`input-template-label-${row.localId}`}
            />
            <Input
              type="time"
              value={row.startTime}
              onChange={(e) => updateTemplateRow(dayType, row.localId, "startTime", e.target.value)}
              className="w-[100px] text-xs"
              data-testid={`input-template-start-${row.localId}`}
            />
            <span className="text-xs text-muted-foreground">-</span>
            <Input
              type="time"
              value={row.endTime}
              onChange={(e) => updateTemplateRow(dayType, row.localId, "endTime", e.target.value)}
              className="w-[100px] text-xs"
              data-testid={`input-template-end-${row.localId}`}
            />
            <Select
              value={row.role}
              onValueChange={(v) => updateTemplateRow(dayType, row.localId, "role", v)}
            >
              <SelectTrigger className="w-20 text-xs" data-testid={`select-template-role-${row.localId}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">x</span>
            <Input
              type="number"
              min="1"
              value={row.requiredCount}
              onChange={(e) => updateTemplateRow(dayType, row.localId, "requiredCount", parseInt(e.target.value) || 1)}
              className="w-14 text-xs"
              data-testid={`input-template-count-${row.localId}`}
            />
            <Button
              size="icon"
              variant="ghost"
              onClick={() => removeTemplateRow(dayType, row.localId)}
              data-testid={`button-remove-template-${row.localId}`}
            >
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </div>
        );
      })}
      <Button
        variant="outline"
        size="sm"
        onClick={() => addTemplateRow(dayType)}
        className="w-full"
        data-testid={`button-add-template-${dayType}`}
      >
        <Plus className="h-3.5 w-3.5 mr-1" />
        新增班次
      </Button>
    </div>
  );

  const getVenueTemplateSummary = (venueId: number) => {
    return null;
  };

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-5 border-b border-border/50">
        <div>
          <h1 className="text-xl font-bold tracking-tight" data-testid="text-venues-title">場館管理</h1>
          <p className="text-sm text-muted-foreground mt-0.5">管理場館地點、GPS 圍欄與班次範本</p>
        </div>
        <RegionTabs />
      </div>

      <div className="p-4 space-y-4">
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={venueSyncing}
            onClick={async () => {
              setVenueSyncing(true);
              try {
                const res = await apiRequest("POST", "/api/ragic-venue-sync");
                const data = await res.json();
                queryClient.invalidateQueries({ queryKey: ["/api/venues", activeRegion] });
                toast({
                  title: "Ragic 場館同步完成",
                  description: `新增 ${data.created} 個場館，既有 ${data.existing} 個，跳過 ${data.skipped} 個${data.errors?.length ? `，${data.errors.length} 個錯誤` : ""}`,
                });
              } catch (err: any) {
                toast({ title: "同步失敗", description: err.message, variant: "destructive" });
              } finally {
                setVenueSyncing(false);
              }
            }}
            data-testid="button-ragic-venue-sync"
          >
            <RefreshCw className={`h-4 w-4 mr-1.5 ${venueSyncing ? "animate-spin" : ""}`} />
            {venueSyncing ? "同步中..." : "Ragic 同步"}
          </Button>
          <Button onClick={openCreate} data-testid="button-add-venue">
            <Plus className="h-4 w-4 mr-1.5" />
            新增場館
          </Button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="p-4">
                <Skeleton className="h-6 w-32 mb-2" />
                <Skeleton className="h-4 w-48 mb-1" />
                <Skeleton className="h-4 w-24" />
              </Card>
            ))}
          </div>
        ) : venues.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Building2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>此區域尚無場館</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {venues.map((venue) => (
              <VenueCard key={venue.id} venue={venue} onEdit={() => openEdit(venue)} />
            ))}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) { setDialogOpen(false); resetForm(); } else { setDialogOpen(true); }}}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingVenue ? "編輯場館" : "新增場館"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>場館名稱 *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="三重商工館"
                  data-testid="input-venue-name"
                />
              </div>
              <div className="space-y-2">
                <Label>簡稱 *</Label>
                <Input
                  value={form.shortName}
                  onChange={(e) => setForm({ ...form, shortName: e.target.value })}
                  placeholder="三重商工"
                  data-testid="input-venue-short-name"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>地址</Label>
              <Input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="新北市三重區..."
                data-testid="input-venue-address"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>緯度</Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={form.latitude}
                  onChange={(e) => setForm({ ...form, latitude: e.target.value })}
                  placeholder="25.0645"
                  data-testid="input-venue-lat"
                />
              </div>
              <div className="space-y-2">
                <Label>經度</Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={form.longitude}
                  onChange={(e) => setForm({ ...form, longitude: e.target.value })}
                  placeholder="121.4873"
                  data-testid="input-venue-lng"
                />
              </div>
              <div className="space-y-2">
                <Label>半徑 (m)</Label>
                <Input
                  type="number"
                  value={form.radius}
                  onChange={(e) => setForm({ ...form, radius: e.target.value })}
                  placeholder="100"
                  data-testid="input-venue-radius"
                />
              </div>
            </div>

            <div className="border-t pt-4">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm font-medium">班次職能範本</Label>
              </div>
              <Tabs value={activeTemplateTab} onValueChange={setActiveTemplateTab}>
                <TabsList className="w-full">
                  <TabsTrigger value="weekday" className="flex-1" data-testid="tab-weekday">
                    平日
                    {weekdayTemplates.length > 0 && (
                      <Badge variant="secondary" className="ml-1.5 text-[10px]">{weekdayTemplates.length}</Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="weekend" className="flex-1" data-testid="tab-weekend">
                    假日
                    {weekendTemplates.length > 0 && (
                      <Badge variant="secondary" className="ml-1.5 text-[10px]">{weekendTemplates.length}</Badge>
                    )}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="weekday" className="mt-3">
                  {renderTemplateRows(weekdayTemplates, "weekday")}
                </TabsContent>
                <TabsContent value="weekend" className="mt-3">
                  {renderTemplateRows(weekendTemplates, "weekend")}
                </TabsContent>
              </Tabs>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }} data-testid="button-cancel-venue">
              取消
            </Button>
            <Button
              onClick={handleSave}
              disabled={!form.name || !form.shortName || createVenue.isPending || updateVenue.isPending || saveTemplatesBatch.isPending}
              data-testid="button-save-venue"
            >
              {createVenue.isPending || updateVenue.isPending || saveTemplatesBatch.isPending ? "儲存中..." : "儲存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VenueCard({ venue, onEdit }: { venue: Venue; onEdit: () => void }) {
  const { data: templates = [] } = useQuery<VenueShiftTemplate[]>({
    queryKey: ["/api/venue-shift-templates", venue.id],
  });

  const weekdayTemplates = templates.filter((t) => t.dayType === "weekday");
  const weekendTemplates = templates.filter((t) => t.dayType === "weekend");

  const renderMiniTemplates = (items: VenueShiftTemplate[], label: string) => {
    if (items.length === 0) return null;
    const grouped = new Map<string, VenueShiftTemplate[]>();
    items.forEach((t) => {
      const key = `${t.shiftLabel} ${t.startTime}-${t.endTime}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(t);
    });

    return (
      <div className="mt-2">
        <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
        <div className="flex flex-wrap gap-1 mt-0.5">
          {Array.from(grouped.entries()).map(([key, tpls]) => (
            <Badge key={key} variant="secondary" className="text-[10px] gap-0.5">
              {key}
              {tpls.map((tp) => {
                const Icon = ROLE_ICON_MAP[tp.role] || UserRound;
                return (
                  <span key={tp.id} className="inline-flex items-center gap-0.5 ml-0.5">
                    <Icon className="h-2.5 w-2.5" />
                    {tp.requiredCount}
                  </span>
                );
              })}
            </Badge>
          ))}
        </div>
      </div>
    );
  };

  return (
    <Card className="p-4" data-testid={`card-venue-${venue.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 mb-2">
          <div className="p-2 rounded-md bg-primary/10">
            <Building2 className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h3 className="font-medium text-sm">{venue.name}</h3>
            <p className="text-xs text-muted-foreground">{venue.shortName}</p>
          </div>
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={onEdit}
          data-testid={`button-edit-venue-${venue.id}`}
        >
          <Edit2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {venue.address && (
        <div className="flex items-start gap-1.5 mt-2 text-sm text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{venue.address}</span>
        </div>
      )}
      {venue.latitude && venue.longitude && (
        <div className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground flex-wrap">
          <Navigation className="h-3 w-3 shrink-0" />
          <span>{venue.latitude?.toFixed(4)}, {venue.longitude?.toFixed(4)}</span>
          <Badge variant="secondary" className="text-[10px]">
            半徑 {venue.radius}m
          </Badge>
        </div>
      )}
      {renderMiniTemplates(weekdayTemplates, "平日")}
      {renderMiniTemplates(weekendTemplates, "假日")}
      {templates.length === 0 && (
        <p className="text-[10px] text-muted-foreground mt-2 italic">尚未設定班次範本</p>
      )}
    </Card>
  );
}
