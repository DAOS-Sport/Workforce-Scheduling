import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval } from "date-fns";
import { zhTW } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RegionTabs } from "@/components/region-tabs";
import { useRegion } from "@/lib/region-context";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, ChevronRight, CalendarDays, Plus, ChevronUp, ChevronDown, Check, AlertCircle, Trash2, Edit2, LifeBuoy, Dumbbell, UserRound, Sparkles, ShieldCheck } from "lucide-react";
import type { Venue, Shift, ScheduleSlot, Employee } from "@shared/schema";

const ROLE_ICON_MAP: Record<string, typeof LifeBuoy> = {
  "救生": LifeBuoy,
  "教練": Dumbbell,
  "櫃檯": UserRound,
  "清潔": Sparkles,
  "管理": ShieldCheck,
};

const ROLE_SHORT: Record<string, string> = {
  "救生": "救",
  "教練": "練",
  "櫃檯": "櫃",
  "清潔": "潔",
  "管理": "管",
};

const DAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];
const ROLE_OPTIONS = ["救生", "教練", "櫃檯", "清潔", "管理"];

export default function SchedulePage() {
  const { activeRegion } = useRegion();
  const { toast } = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [slotDialogOpen, setSlotDialogOpen] = useState(false);
  const [editingVenueId, setEditingVenueId] = useState<number | null>(null);
  const [editingDate, setEditingDate] = useState<string>("");
  const [editingSlot, setEditingSlot] = useState<ScheduleSlot | null>(null);

  const [slotStartTime, setSlotStartTime] = useState("06:30");
  const [slotEndTime, setSlotEndTime] = useState("16:00");
  const [slotRole, setSlotRole] = useState("救生");
  const [slotCount, setSlotCount] = useState("1");

  const monthDates = useMemo(
    () => eachDayOfInterval({ start: startOfMonth(currentMonth), end: endOfMonth(currentMonth) }),
    [currentMonth]
  );

  const dateRange = useMemo(
    () => ({
      start: format(monthDates[0], "yyyy-MM-dd"),
      end: format(monthDates[monthDates.length - 1], "yyyy-MM-dd"),
    }),
    [monthDates]
  );

  const { data: venues = [], isLoading: venLoading } = useQuery<Venue[]>({
    queryKey: ["/api/venues", activeRegion],
  });

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["/api/employees", activeRegion],
  });

  const { data: scheduleSlots = [], isLoading: slotsLoading } = useQuery<ScheduleSlot[]>({
    queryKey: ["/api/schedule-slots", activeRegion, dateRange.start, dateRange.end],
  });

  const { data: shifts = [] } = useQuery<Shift[]>({
    queryKey: ["/api/shifts", activeRegion, dateRange.start, dateRange.end],
  });

  const slotsByVenueDate = useMemo(() => {
    const map = new Map<string, ScheduleSlot[]>();
    scheduleSlots.forEach((s) => {
      const key = `${s.venueId}-${s.date}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    });
    return map;
  }, [scheduleSlots]);

  const employeeMap = useMemo(() => {
    const map = new Map<number, Employee>();
    employees.forEach((e) => map.set(e.id, e));
    return map;
  }, [employees]);

  const shiftsByVenueDate = useMemo(() => {
    const map = new Map<string, Shift[]>();
    shifts.forEach((s) => {
      const key = `${s.venueId}-${s.date}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    });
    return map;
  }, [shifts]);

  const gapAnalysis = useMemo(() => {
    const gaps: { venueId: number; venueName: string; date: string; startTime: string; endTime: string; role: string; required: number; assigned: number; shortage: number }[] = [];
    let totalShortage = 0;
    scheduleSlots.forEach((slot) => {
      const venue = venues.find((v) => v.id === slot.venueId);
      const venueDateShifts = shiftsByVenueDate.get(`${slot.venueId}-${slot.date}`) || [];
      const assignedCount = venueDateShifts.filter((sh) => {
        const shStart = sh.startTime.substring(0, 5);
        const shEnd = sh.endTime.substring(0, 5);
        return shStart <= slot.startTime && shEnd >= slot.endTime;
      }).length;
      const shortage = slot.requiredCount - assignedCount;
      if (shortage > 0) {
        totalShortage += shortage;
        gaps.push({
          venueId: slot.venueId,
          venueName: venue?.shortName || "未知",
          date: slot.date,
          startTime: slot.startTime,
          endTime: slot.endTime,
          role: slot.role,
          required: slot.requiredCount,
          assigned: assignedCount,
          shortage,
        });
      }
    });
    return { gaps, totalShortage };
  }, [scheduleSlots, shiftsByVenueDate, venues]);

  const venueRoleSummaryByDate = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    gapAnalysis.gaps.forEach((g) => {
      const key = `${g.venueId}-${g.date}`;
      if (!map.has(key)) map.set(key, new Map());
      const roleMap = map.get(key)!;
      roleMap.set(g.role, (roleMap.get(g.role) || 0) + g.shortage);
    });
    return map;
  }, [gapAnalysis]);

  const createSlot = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/schedule-slots", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-slots"] });
      toast({ title: "需求已新增" });
    },
    onError: (err: Error) => {
      toast({ title: "新增失敗", description: err.message, variant: "destructive" });
    },
  });

  const updateSlot = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const res = await apiRequest("PATCH", `/api/schedule-slots/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-slots"] });
      toast({ title: "需求已更新" });
    },
    onError: (err: Error) => {
      toast({ title: "更新失敗", description: err.message, variant: "destructive" });
    },
  });

  const deleteSlot = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/schedule-slots/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-slots"] });
      toast({ title: "需求已刪除" });
    },
  });

  const openNewSlotDialog = (venueId: number, dateStr: string) => {
    setEditingVenueId(venueId);
    setEditingDate(dateStr);
    setEditingSlot(null);
    setSlotStartTime("06:30");
    setSlotEndTime("16:00");
    setSlotRole("救生");
    setSlotCount("1");
    setSlotDialogOpen(true);
  };

  const openEditSlotDialog = (slot: ScheduleSlot) => {
    setEditingVenueId(slot.venueId);
    setEditingDate(slot.date);
    setEditingSlot(slot);
    setSlotStartTime(slot.startTime);
    setSlotEndTime(slot.endTime);
    setSlotRole(slot.role);
    setSlotCount(slot.requiredCount.toString());
    setSlotDialogOpen(true);
  };

  const handleSaveSlot = () => {
    if (!editingVenueId || !editingDate || !slotStartTime || !slotEndTime) return;
    const count = parseInt(slotCount) || 1;
    if (editingSlot) {
      updateSlot.mutate({
        id: editingSlot.id,
        venueId: editingVenueId,
        date: editingDate,
        startTime: slotStartTime,
        endTime: slotEndTime,
        role: slotRole,
        requiredCount: count,
      });
    } else {
      createSlot.mutate({
        venueId: editingVenueId,
        date: editingDate,
        startTime: slotStartTime,
        endTime: slotEndTime,
        role: slotRole,
        requiredCount: count,
      });
    }
    setSlotDialogOpen(false);
  };

  useEffect(() => {
    if (scrollRef.current) {
      const todayStr = format(new Date(), "yyyy-MM-dd");
      const todayEl = scrollRef.current.querySelector(`[data-date-col="${todayStr}"]`);
      if (todayEl) {
        todayEl.scrollIntoView({ inline: "center", block: "nearest" });
      }
    }
  }, [currentMonth]);

  const isLoading = venLoading || slotsLoading;

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 border-b">
        <div>
          <h1 className="text-lg font-semibold" data-testid="text-page-title">排班編輯器</h1>
          <p className="text-sm text-muted-foreground">輸入各場館每日需求時段 — 自動偵測缺班</p>
        </div>
        <RegionTabs />
      </div>

      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="outline"
            onClick={() => setCurrentMonth((prev) => subMonths(prev, 1))}
            data-testid="button-prev-month"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            onClick={() => setCurrentMonth((prev) => addMonths(prev, 1))}
            data-testid="button-next-month"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium" data-testid="text-month-range">
            {format(currentMonth, "yyyy年 M月", { locale: zhTW })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentMonth(startOfMonth(new Date()))}
            data-testid="button-today"
          >
            本月
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-pick-date">
                <CalendarDays className="h-3.5 w-3.5 mr-1.5" />
                選擇月份
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={currentMonth}
                onSelect={(d) => { if (d) setCurrentMonth(startOfMonth(d)); }}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col relative">
        <div className="flex-1 overflow-auto" ref={scrollRef}>
          <table className="border-collapse text-sm" style={{ minWidth: `${130 + monthDates.length * 120}px` }}>
            <thead className="sticky top-0 z-20">
              <tr>
                <th
                  className="text-left p-2 border-b border-r font-medium text-muted-foreground bg-background sticky left-0 z-30"
                  style={{ minWidth: 130, width: 130 }}
                >
                  場館
                </th>
                {monthDates.map((d, i) => {
                  const isToday = format(d, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");
                  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                  return (
                    <th
                      key={i}
                      data-date-col={format(d, "yyyy-MM-dd")}
                      className={`text-center p-1.5 border-b border-r font-medium ${
                        isToday ? "bg-primary/5" : isWeekend ? "bg-muted/30" : "bg-background"
                      }`}
                      style={{ minWidth: 120, width: 120 }}
                    >
                      <div className={`text-xs ${isWeekend ? "text-destructive/70" : "text-muted-foreground"}`}>
                        週{DAY_NAMES[d.getDay()]}
                      </div>
                      <div className={`text-xs ${isToday ? "text-primary font-semibold" : ""}`}>
                        {format(d, "M/d")}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i}>
                    <td className="p-2 border-b border-r sticky left-0 bg-background z-[5]" style={{ minWidth: 130 }}>
                      <Skeleton className="h-5 w-20" />
                    </td>
                    {Array.from({ length: Math.min(monthDates.length, 10) }).map((_, j) => (
                      <td key={j} className="p-1 border-b border-r" style={{ minWidth: 120 }}>
                        <Skeleton className="h-12 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : venues.length === 0 ? (
                <tr>
                  <td colSpan={monthDates.length + 1} className="text-center py-12 text-muted-foreground">
                    此區域尚無場館
                  </td>
                </tr>
              ) : (
                venues.map((venue) => {
                  const venueSlots = scheduleSlots.filter((s) => s.venueId === venue.id);
                  const venueRoleTotals = new Map<string, { required: number; assigned: number }>();
                  venueSlots.forEach((slot) => {
                    const venueDateShifts = shiftsByVenueDate.get(`${slot.venueId}-${slot.date}`) || [];
                    const assignedCount = venueDateShifts.filter((sh) => {
                      const shStart = sh.startTime.substring(0, 5);
                      const shEnd = sh.endTime.substring(0, 5);
                      return shStart <= slot.startTime && shEnd >= slot.endTime;
                    }).length;
                    const prev = venueRoleTotals.get(slot.role) || { required: 0, assigned: 0 };
                    venueRoleTotals.set(slot.role, {
                      required: prev.required + slot.requiredCount,
                      assigned: prev.assigned + assignedCount,
                    });
                  });

                  return (
                  <tr key={venue.id} className="group">
                    <td
                      className="p-2 border-b border-r sticky left-0 bg-background z-[5]"
                      style={{ minWidth: 130, width: 130 }}
                    >
                      <span className="font-medium text-sm whitespace-nowrap" data-testid={`text-venue-name-${venue.id}`}>
                        {venue.shortName}
                      </span>
                      {venueRoleTotals.size > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1" data-testid={`venue-role-summary-${venue.id}`}>
                          {Array.from(venueRoleTotals.entries()).map(([role, { required, assigned }]) => {
                            const shortage = required - assigned;
                            if (shortage <= 0) return null;
                            const Icon = ROLE_ICON_MAP[role] || UserRound;
                            const short = ROLE_SHORT[role] || role;
                            return (
                              <span
                                key={role}
                                className="inline-flex items-center gap-0.5 text-[10px] text-red-600 dark:text-red-400 font-medium"
                              >
                                <Icon className="h-2.5 w-2.5" />
                                {short}-{shortage}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </td>
                    {monthDates.map((d, di) => {
                      const dateStr = format(d, "yyyy-MM-dd");
                      const cellSlots = slotsByVenueDate.get(`${venue.id}-${dateStr}`) || [];
                      const cellShifts = shiftsByVenueDate.get(`${venue.id}-${dateStr}`) || [];
                      const isToday = dateStr === format(new Date(), "yyyy-MM-dd");
                      const isWeekend = d.getDay() === 0 || d.getDay() === 6;

                      return (
                        <td
                          key={di}
                          className={`p-0.5 border-b border-r relative align-top ${
                            isToday ? "bg-primary/5" : isWeekend ? "bg-muted/20" : ""
                          }`}
                          style={{ minWidth: 120, width: 120 }}
                          data-testid={`cell-${venue.id}-${dateStr}`}
                        >
                          {cellSlots.length > 0 ? (
                            <div className="space-y-0.5">
                              {cellSlots.map((slot) => {
                                const matchedShifts = cellShifts.filter((sh) => {
                                  const shStart = sh.startTime.substring(0, 5);
                                  const shEnd = sh.endTime.substring(0, 5);
                                  return shStart <= slot.startTime && shEnd >= slot.endTime;
                                });
                                const assigned = matchedShifts.length;
                                const shortage = slot.requiredCount - assigned;
                                const isFull = shortage <= 0;
                                return (
                                  <div
                                    key={slot.id}
                                    className={`rounded px-1 py-0.5 text-xs cursor-pointer transition-colors ${
                                      isFull
                                        ? "bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800"
                                        : "bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800"
                                    }`}
                                    onClick={() => openEditSlotDialog(slot)}
                                    data-testid={`slot-${slot.id}`}
                                  >
                                    <div className="font-medium leading-tight text-[11px]">
                                      {slot.startTime}-{slot.endTime}
                                    </div>
                                    <div className="leading-tight text-[11px] flex items-center justify-between gap-0.5">
                                      <span>{slot.role}{slot.requiredCount}人</span>
                                      {isFull ? (
                                        <Check className="h-3 w-3 text-green-600 dark:text-green-400 shrink-0" />
                                      ) : (
                                        <span className="text-red-600 dark:text-red-400 font-bold shrink-0">缺{shortage}</span>
                                      )}
                                    </div>
                                    {matchedShifts.length > 0 && (
                                      <div className="text-[10px] text-muted-foreground leading-tight mt-0.5 border-t border-current/10 pt-0.5">
                                        {matchedShifts.map((sh) => {
                                          const emp = employeeMap.get(sh.employeeId);
                                          const RoleIcon = ROLE_ICON_MAP[slot.role] || UserRound;
                                          return (
                                            <div key={sh.id} className="flex items-center gap-0.5">
                                              <RoleIcon className="h-2.5 w-2.5 shrink-0" />
                                              <span className="truncate">{emp?.name || sh.employeeId}</span>
                                              {sh.isDispatch && <span className="text-orange-500">(派)</span>}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                              <button
                                className="w-full flex items-center justify-center py-0.5 text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
                                onClick={() => openNewSlotDialog(venue.id, dateStr)}
                                data-testid={`button-add-slot-${venue.id}-${dateStr}`}
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            </div>
                          ) : (
                            <button
                              className="flex items-center justify-center w-full h-[48px] text-muted-foreground/30 hover:text-muted-foreground/60 hover:bg-muted/30 transition-colors rounded cursor-pointer"
                              onClick={() => openNewSlotDialog(venue.id, dateStr)}
                              data-testid={`button-add-slot-${venue.id}-${dateStr}`}
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div
          className={`border-t bg-card transition-all duration-300 ease-in-out shrink-0 ${
            drawerOpen ? "max-h-[200px]" : "max-h-[36px]"
          } overflow-hidden`}
          data-testid="vacancy-drawer"
        >
          <button
            onClick={() => setDrawerOpen((prev) => !prev)}
            className="w-full flex items-center justify-between gap-2 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-toggle-drawer"
          >
            <div className="flex items-center gap-2">
              {gapAnalysis.totalShortage > 0 ? (
                <>
                  <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                  <span>缺班明細 — 共 {gapAnalysis.totalShortage} 個缺口</span>
                </>
              ) : (
                <>
                  <Check className="h-3.5 w-3.5 text-green-500" />
                  <span>{scheduleSlots.length > 0 ? "本月所有時段人力已滿" : "尚未建立排班需求"}</span>
                </>
              )}
            </div>
            {drawerOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </button>
          {drawerOpen && gapAnalysis.gaps.length > 0 && (
            <div className="px-4 pb-3 overflow-auto max-h-[160px]">
              <div className="flex flex-wrap gap-1.5">
                {gapAnalysis.gaps.map((g, i) => {
                  const RoleIcon = ROLE_ICON_MAP[g.role] || UserRound;
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-1.5 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-2 py-1 text-xs"
                      data-testid={`vacancy-detail-${i}`}
                    >
                      <span className="text-red-700 dark:text-red-300 font-medium">{g.venueName}</span>
                      <span className="text-muted-foreground">{format(new Date(g.date), "M/d")}</span>
                      <span className="text-muted-foreground">{g.startTime}-{g.endTime}</span>
                      <span className="inline-flex items-center gap-0.5 text-muted-foreground">
                        <RoleIcon className="h-3 w-3" />
                        {g.role}
                      </span>
                      <span className="text-red-600 dark:text-red-400 font-bold">缺{g.shortage}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={slotDialogOpen} onOpenChange={setSlotDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editingSlot ? <Edit2 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {editingSlot ? "編輯需求時段" : "新增需求時段"}
            </DialogTitle>
            <DialogDescription>
              {venues.find((v) => v.id === editingVenueId)?.shortName} — {editingDate ? format(new Date(editingDate), "M月d日 (E)", { locale: zhTW }) : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="flex-1 space-y-2">
                <Label>開始時間</Label>
                <Input
                  type="time"
                  value={slotStartTime}
                  onChange={(e) => setSlotStartTime(e.target.value)}
                  data-testid="input-slot-start-time"
                />
              </div>
              <div className="flex-1 space-y-2">
                <Label>結束時間</Label>
                <Input
                  type="time"
                  value={slotEndTime}
                  onChange={(e) => setSlotEndTime(e.target.value)}
                  data-testid="input-slot-end-time"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-1 space-y-2">
                <Label>角色</Label>
                <Select value={slotRole} onValueChange={setSlotRole}>
                  <SelectTrigger data-testid="select-slot-role">
                    <SelectValue placeholder="選擇角色" />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 space-y-2">
                <Label>需要人數</Label>
                <Input
                  type="number"
                  min="1"
                  max="20"
                  value={slotCount}
                  onChange={(e) => setSlotCount(e.target.value)}
                  data-testid="input-slot-count"
                />
              </div>
            </div>

            <div className="rounded-md bg-muted/30 p-3 text-xs text-muted-foreground">
              預覽：{slotStartTime}-{slotEndTime} {slotRole}{slotCount}人
            </div>
          </div>

          <DialogFooter className="flex-row gap-2 justify-between sm:justify-between">
            <div>
              {editingSlot && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    deleteSlot.mutate(editingSlot.id);
                    setSlotDialogOpen(false);
                  }}
                  data-testid="button-delete-slot"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  刪除
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setSlotDialogOpen(false)} data-testid="button-cancel-slot">
                取消
              </Button>
              <Button
                onClick={handleSaveSlot}
                disabled={!slotStartTime || !slotEndTime || !slotRole || parseInt(slotCount) < 1}
                data-testid="button-save-slot"
              >
                儲存
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
