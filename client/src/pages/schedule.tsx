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
import { Switch } from "@/components/ui/switch";
import { RegionTabs } from "@/components/region-tabs";
import { useRegion } from "@/lib/region-context";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft, ChevronRight, CalendarDays, Plus, ChevronUp, ChevronDown,
  Check, AlertCircle, Trash2, Edit2, LifeBuoy, Dumbbell, UserRound,
  Sparkles, ShieldCheck, Settings2
} from "lucide-react";
import type { Venue, Shift, ScheduleSlot, Employee } from "@shared/schema";

const ROLE_ICON_MAP: Record<string, typeof LifeBuoy> = {
  "救生": LifeBuoy,
  "教練": Dumbbell,
  "櫃台": UserRound,
  "櫃檯": UserRound,
  "清潔": Sparkles,
  "管理": ShieldCheck,
};

const ROLE_SHORT: Record<string, string> = {
  "救生": "救",
  "教練": "練",
  "櫃台": "櫃",
  "櫃檯": "櫃",
  "清潔": "潔",
  "管理": "管",
};

const ROLE_LABELS: Record<string, string> = {
  pt: "救生",
  lifeguard: "救生",
  counter: "櫃台",
  cleaning: "清潔",
  manager: "管理",
  "救生": "救生",
  "櫃台": "櫃台",
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
  const [editingSlotVenueId, setEditingSlotVenueId] = useState<number | null>(null);
  const [editingSlotDate, setEditingSlotDate] = useState<string>("");
  const [editingSlot, setEditingSlot] = useState<ScheduleSlot | null>(null);
  const [slotStartTime, setSlotStartTime] = useState("06:30");
  const [slotEndTime, setSlotEndTime] = useState("16:00");
  const [slotRole, setSlotRole] = useState("救生");
  const [slotCount, setSlotCount] = useState("1");

  const [shiftDialogOpen, setShiftDialogOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [shiftEmployeeId, setShiftEmployeeId] = useState<number | null>(null);
  const [shiftDate, setShiftDate] = useState<string>("");
  const [shiftVenueId, setShiftVenueId] = useState<string>("");
  const [shiftStartTime, setShiftStartTime] = useState("06:30");
  const [shiftEndTime, setShiftEndTime] = useState("16:00");
  const [shiftIsDispatch, setShiftIsDispatch] = useState(false);
  const [shiftRole, setShiftRole] = useState<string>("救生");

  const [requirementsPanelOpen, setRequirementsPanelOpen] = useState(false);
  const [reqPanelVenueId, setReqPanelVenueId] = useState<number | null>(null);
  const [reqPanelDate, setReqPanelDate] = useState<string>("");

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

  const { data: employees = [], isLoading: empLoading } = useQuery<Employee[]>({
    queryKey: ["/api/employees", activeRegion],
  });

  const { data: scheduleSlots = [], isLoading: slotsLoading } = useQuery<ScheduleSlot[]>({
    queryKey: ["/api/schedule-slots", activeRegion, dateRange.start, dateRange.end],
  });

  const { data: shifts = [] } = useQuery<Shift[]>({
    queryKey: ["/api/shifts", activeRegion, dateRange.start, dateRange.end],
  });

  const venueMap = useMemo(() => {
    const map = new Map<number, Venue>();
    venues.forEach((v) => map.set(v.id, v));
    return map;
  }, [venues]);

  const shiftsByEmployeeDate = useMemo(() => {
    const map = new Map<string, Shift[]>();
    shifts.forEach((s) => {
      const key = `${s.employeeId}-${s.date}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    });
    return map;
  }, [shifts]);

  const shiftsByVenueDate = useMemo(() => {
    const map = new Map<string, Shift[]>();
    shifts.forEach((s) => {
      const key = `${s.venueId}-${s.date}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    });
    return map;
  }, [shifts]);

  const slotsByVenueDate = useMemo(() => {
    const map = new Map<string, ScheduleSlot[]>();
    scheduleSlots.forEach((s) => {
      const key = `${s.venueId}-${s.date}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    });
    return map;
  }, [scheduleSlots]);

  const timeToMin = (t: string) => {
    const [h, m] = t.substring(0, 5).split(":").map(Number);
    return h * 60 + m;
  };

  const shiftOverlapsSlot = (sh: Shift, slot: ScheduleSlot) => {
    const shStart = timeToMin(sh.startTime);
    const shEnd = timeToMin(sh.endTime);
    const slStart = timeToMin(slot.startTime);
    const slEnd = timeToMin(slot.endTime);
    const overlapStart = Math.max(shStart, slStart);
    const overlapEnd = Math.min(shEnd, slEnd);
    const overlap = overlapEnd - overlapStart;
    const slotDuration = slEnd - slStart;
    return overlap >= slotDuration * 0.5;
  };

  const venueDateShortage = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    scheduleSlots.forEach((slot) => {
      const key = `${slot.venueId}-${slot.date}`;
      const venueDateShifts = shiftsByVenueDate.get(key) || [];
      const assignedCount = venueDateShifts.filter((sh) => shiftOverlapsSlot(sh, slot)).length;
      const shortage = slot.requiredCount - assignedCount;
      if (shortage > 0) {
        if (!map.has(key)) map.set(key, new Map());
        const roleMap = map.get(key)!;
        roleMap.set(slot.role, (roleMap.get(slot.role) || 0) + shortage);
      }
    });
    return map;
  }, [scheduleSlots, shiftsByVenueDate]);

  const gapAnalysis = useMemo(() => {
    const gaps: { venueId: number; venueName: string; date: string; startTime: string; endTime: string; role: string; required: number; assigned: number; shortage: number }[] = [];
    let totalShortage = 0;
    scheduleSlots.forEach((slot) => {
      const venue = venues.find((v) => v.id === slot.venueId);
      const venueDateShifts = shiftsByVenueDate.get(`${slot.venueId}-${slot.date}`) || [];
      const assignedCount = venueDateShifts.filter((sh) => shiftOverlapsSlot(sh, slot)).length;
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

  const createShift = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/shifts", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({ title: "班次已新增" });
    },
    onError: (err: Error) => {
      toast({ title: "新增失敗", description: err.message, variant: "destructive" });
    },
  });

  const updateShift = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const res = await apiRequest("PATCH", `/api/shifts/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({ title: "班次已更新" });
    },
    onError: (err: Error) => {
      toast({ title: "更新失敗", description: err.message, variant: "destructive" });
    },
  });

  const deleteShift = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/shifts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({ title: "班次已刪除" });
    },
  });

  const openNewShiftDialog = (employeeId: number, dateStr: string) => {
    const emp = employees.find((e) => e.id === employeeId);
    setShiftEmployeeId(employeeId);
    setShiftDate(dateStr);
    setEditingShift(null);
    setShiftVenueId(venues.length > 0 ? venues[0].id.toString() : "");
    setShiftStartTime("06:30");
    setShiftEndTime("16:00");
    setShiftIsDispatch(false);
    setShiftRole(emp?.role === "櫃台" ? "櫃台" : "救生");
    setShiftDialogOpen(true);
  };

  const openEditShiftDialog = (shift: Shift) => {
    setShiftEmployeeId(shift.employeeId);
    setShiftDate(shift.date);
    setEditingShift(shift);
    setShiftVenueId(shift.venueId.toString());
    setShiftStartTime(shift.startTime.substring(0, 5));
    setShiftEndTime(shift.endTime.substring(0, 5));
    setShiftIsDispatch(shift.isDispatch || false);
    setShiftRole(shift.role || "救生");
    setShiftDialogOpen(true);
  };

  const handleSaveShift = () => {
    if (!shiftEmployeeId || !shiftDate || !shiftVenueId || !shiftStartTime || !shiftEndTime) return;
    const payload = {
      employeeId: shiftEmployeeId,
      venueId: parseInt(shiftVenueId),
      date: shiftDate,
      startTime: shiftStartTime,
      endTime: shiftEndTime,
      role: shiftRole,
      isDispatch: shiftIsDispatch,
    };
    if (editingShift) {
      updateShift.mutate({ id: editingShift.id, ...payload });
    } else {
      createShift.mutate(payload);
    }
    setShiftDialogOpen(false);
  };

  const openNewSlotDialog = (venueId: number, dateStr: string) => {
    setEditingSlotVenueId(venueId);
    setEditingSlotDate(dateStr);
    setEditingSlot(null);
    setSlotStartTime("06:30");
    setSlotEndTime("16:00");
    setSlotRole("救生");
    setSlotCount("1");
    setSlotDialogOpen(true);
  };

  const openEditSlotDialog = (slot: ScheduleSlot) => {
    setEditingSlotVenueId(slot.venueId);
    setEditingSlotDate(slot.date);
    setEditingSlot(slot);
    setSlotStartTime(slot.startTime);
    setSlotEndTime(slot.endTime);
    setSlotRole(slot.role);
    setSlotCount(slot.requiredCount.toString());
    setSlotDialogOpen(true);
  };

  const handleSaveSlot = async () => {
    if (!editingSlotVenueId || !editingSlotDate || !slotStartTime || !slotEndTime) return;
    const count = parseInt(slotCount) || 1;
    if (editingSlot && editingSlot.id > 0) {
      updateSlot.mutate({
        id: editingSlot.id,
        venueId: editingSlotVenueId,
        date: editingSlotDate,
        startTime: slotStartTime,
        endTime: slotEndTime,
        role: slotRole,
        requiredCount: count,
      });
    } else {
      if (editingSlot && editingSlot.id < 0) {
        try {
          await apiRequest("POST", "/api/schedule-slots/materialize", {
            venueId: editingSlotVenueId,
            date: editingSlotDate,
          });
        } catch {}
      }
      createSlot.mutate({
        venueId: editingSlotVenueId,
        date: editingSlotDate,
        startTime: slotStartTime,
        endTime: slotEndTime,
        role: slotRole,
        requiredCount: count,
      });
    }
    setSlotDialogOpen(false);
  };

  const openRequirementsPanel = (venueId: number, dateStr: string) => {
    setReqPanelVenueId(venueId);
    setReqPanelDate(dateStr);
    setRequirementsPanelOpen(true);
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

  const isLoading = venLoading || empLoading || slotsLoading;

  const COL_LEFT_WIDTH = 140;
  const COL_DATE_WIDTH = 130;

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-5 border-b border-border/50">
        <div>
          <h1 className="text-xl font-bold tracking-tight" data-testid="text-page-title">排班編輯器</h1>
          <p className="text-sm text-muted-foreground mt-0.5">員工排班管理 — 設定需求、指派班次、即時偵測缺班</p>
        </div>
        <RegionTabs />
      </div>

      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b flex-wrap">
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
          <table className="border-collapse text-sm" style={{ minWidth: `${COL_LEFT_WIDTH + monthDates.length * COL_DATE_WIDTH}px` }}>
            <thead className="sticky top-0 z-20">
              <tr>
                <th
                  className="text-left p-2 border-b border-r font-medium text-muted-foreground bg-background sticky left-0 z-30"
                  style={{ minWidth: COL_LEFT_WIDTH, width: COL_LEFT_WIDTH }}
                >
                  員工
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
                      style={{ minWidth: COL_DATE_WIDTH, width: COL_DATE_WIDTH }}
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
              {venues.map((venue, vi) => {
                const stickyTop = 52 + vi * 28;
                return (
                <tr key={`summary-${venue.id}`} className="sticky z-[15] bg-muted/40" style={{ top: stickyTop }}>
                  <th
                    className="p-1 border-b border-r sticky left-0 z-[25] bg-muted/40 text-left"
                    style={{ minWidth: COL_LEFT_WIDTH, width: COL_LEFT_WIDTH }}
                  >
                    <span className="font-medium text-xs text-muted-foreground whitespace-nowrap" data-testid={`text-venue-summary-${venue.id}`}>
                      {venue.shortName}
                    </span>
                  </th>
                  {monthDates.map((d, di) => {
                    const dateStr = format(d, "yyyy-MM-dd");
                    const key = `${venue.id}-${dateStr}`;
                    const roleShortages = venueDateShortage.get(key);
                    const cellSlots = slotsByVenueDate.get(key) || [];
                    const isToday = dateStr === format(new Date(), "yyyy-MM-dd");
                    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                    const hasRequirements = cellSlots.length > 0;

                    return (
                      <th
                        key={di}
                        className={`p-0.5 border-b border-r text-center align-middle font-normal ${
                          isToday ? "bg-primary/5" : isWeekend ? "bg-muted/30" : "bg-muted/40"
                        }`}
                        style={{ minWidth: COL_DATE_WIDTH, width: COL_DATE_WIDTH }}
                        data-testid={`summary-cell-${venue.id}-${dateStr}`}
                      >
                        {hasRequirements ? (
                          <button
                            className="w-full flex items-center justify-center gap-1 flex-wrap text-[10px] py-0.5 rounded hover:bg-muted/50 transition-colors cursor-pointer"
                            onClick={() => openRequirementsPanel(venue.id, dateStr)}
                            data-testid={`button-req-${venue.id}-${dateStr}`}
                          >
                            {roleShortages && roleShortages.size > 0 ? (
                              Array.from(roleShortages.entries()).map(([role, count]) => {
                                const Icon = ROLE_ICON_MAP[role] || UserRound;
                                const short = ROLE_SHORT[role] || role;
                                return (
                                  <span key={role} className="inline-flex items-center gap-0.5 text-red-600 dark:text-red-400 font-medium">
                                    <Icon className="h-2.5 w-2.5" />
                                    {short}-{count}
                                  </span>
                                );
                              })
                            ) : (
                              <span className="text-green-600 dark:text-green-400">
                                <Check className="h-3 w-3 inline" />
                              </span>
                            )}
                          </button>
                        ) : (
                          <button
                            className="w-full flex items-center justify-center py-0.5 text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors cursor-pointer"
                            onClick={() => openRequirementsPanel(venue.id, dateStr)}
                            data-testid={`button-req-${venue.id}-${dateStr}`}
                          >
                            <Settings2 className="h-2.5 w-2.5" />
                          </button>
                        )}
                      </th>
                    );
                  })}
                </tr>
                );
              })}
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={`skel-${i}`}>
                    <td className="p-2 border-b border-r sticky left-0 bg-background z-[5]" style={{ minWidth: COL_LEFT_WIDTH }}>
                      <Skeleton className="h-5 w-20" />
                    </td>
                    {Array.from({ length: Math.min(monthDates.length, 10) }).map((_, j) => (
                      <td key={j} className="p-1 border-b border-r" style={{ minWidth: COL_DATE_WIDTH }}>
                        <Skeleton className="h-10 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : employees.length === 0 ? (
                <tr>
                  <td colSpan={monthDates.length + 1} className="text-center py-12 text-muted-foreground">
                    此區域尚無員工
                  </td>
                </tr>
              ) : (
                (() => {
                  const groups = [
                    { key: "ft-counter", label: "正職櫃台", filter: (e: Employee) => e.employmentType === "full_time" && e.role === "櫃台" },
                    { key: "pt-counter", label: "兼職櫃台", filter: (e: Employee) => e.employmentType === "part_time" && e.role === "櫃台" },
                    { key: "ft-rescue", label: "正職救生", filter: (e: Employee) => e.employmentType === "full_time" && e.role === "救生" },
                    { key: "pt-rescue", label: "兼職救生", filter: (e: Employee) => e.employmentType === "part_time" && e.role === "救生" },
                  ];
                  return groups.flatMap(({ key, label, filter }) => {
                    const grouped = employees.filter(filter);
                    if (grouped.length === 0) return [];
                    return [
                      <tr key={`group-${key}`}>
                        <td
                          className="px-2 py-1 border-b border-r sticky left-0 bg-muted/50 z-[5] text-xs font-bold text-muted-foreground tracking-wide"
                          style={{ minWidth: COL_LEFT_WIDTH }}
                        >
                          {label} ({grouped.length})
                        </td>
                        {monthDates.map((_, di) => (
                          <td key={di} className="border-b border-r bg-muted/50" style={{ minWidth: COL_DATE_WIDTH }} />
                        ))}
                      </tr>,
                      ...grouped.map((emp) => (
                  <tr key={emp.id} className="group" data-testid={`row-employee-${emp.id}`}>
                    <td
                      className="p-2 border-b border-r sticky left-0 bg-background z-[5]"
                      style={{ minWidth: COL_LEFT_WIDTH, width: COL_LEFT_WIDTH }}
                    >
                      <div className="flex items-center gap-1.5">
                        {emp.role && ROLE_ICON_MAP[emp.role] && (() => {
                          const Icon = ROLE_ICON_MAP[emp.role!];
                          return <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
                        })()}
                        <span className="font-medium text-sm whitespace-nowrap" data-testid={`text-employee-name-${emp.id}`}>
                          {emp.name}
                        </span>
                      </div>
                    </td>
                    {monthDates.map((d, di) => {
                      const dateStr = format(d, "yyyy-MM-dd");
                      const cellShifts = shiftsByEmployeeDate.get(`${emp.id}-${dateStr}`) || [];
                      const isToday = dateStr === format(new Date(), "yyyy-MM-dd");
                      const isWeekend = d.getDay() === 0 || d.getDay() === 6;

                      return (
                        <td
                          key={di}
                          className={`p-0.5 border-b border-r relative align-top ${
                            isToday ? "bg-primary/5" : isWeekend ? "bg-muted/20" : ""
                          }`}
                          style={{ minWidth: COL_DATE_WIDTH, width: COL_DATE_WIDTH }}
                          data-testid={`cell-${emp.id}-${dateStr}`}
                        >
                          {cellShifts.length > 0 ? (
                            <div className="space-y-0.5">
                              {cellShifts.map((shift) => {
                                const venue = venueMap.get(shift.venueId);
                                return (
                                  <div
                                    key={shift.id}
                                    className={`rounded px-1 py-0.5 text-xs cursor-pointer transition-colors ${
                                      shift.isDispatch
                                        ? "bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800"
                                        : "bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800"
                                    }`}
                                    onClick={() => openEditShiftDialog(shift)}
                                    data-testid={`shift-${shift.id}`}
                                  >
                                    <div className="flex items-center justify-between gap-1">
                                      <div className="font-medium leading-tight text-[11px] truncate">
                                        {venue?.shortName || "未知"}
                                      </div>
                                      {(() => {
                                        const dateStr = format(d, "yyyy-MM-dd");
                                        const slots = slotsByVenueDate.get(`${shift.venueId}-${dateStr}`) || [];
                                        const sStart = shift.startTime.substring(0, 5);
                                        const sEnd = shift.endTime.substring(0, 5);
                                        const matchedSlot = slots.find(sl => sl.startTime.substring(0, 5) <= sStart && sl.endTime.substring(0, 5) >= sEnd) 
                                          || slots.find(sl => sl.startTime.substring(0, 5) <= sStart && sStart < sl.endTime.substring(0, 5));
                                        const role = matchedSlot?.role || ROLE_LABELS[emp.role] || emp.role;
                                        const short = ROLE_SHORT[role] || role.slice(0, 1);
                                        return (
                                          <span className="text-[9px] px-0.5 rounded bg-background/50 border border-current opacity-70 shrink-0">
                                            {short}
                                          </span>
                                        );
                                      })()}
                                    </div>
                                    <div className="leading-tight text-[11px] text-muted-foreground">
                                      {shift.startTime.substring(0, 5)}-{shift.endTime.substring(0, 5)}
                                    </div>
                                    {shift.isDispatch && (
                                      <div className="text-[10px] text-orange-600 dark:text-orange-400 font-medium">派遣</div>
                                    )}
                                  </div>
                                );
                              })}
                              <button
                                className="w-full flex items-center justify-center py-0.5 text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
                                onClick={() => openNewShiftDialog(emp.id, dateStr)}
                                data-testid={`button-add-shift-${emp.id}-${dateStr}`}
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            </div>
                          ) : (
                            <button
                              className="flex items-center justify-center w-full h-[40px] text-muted-foreground/30 hover:text-muted-foreground/60 hover:bg-muted/30 transition-colors rounded cursor-pointer"
                              onClick={() => openNewShiftDialog(emp.id, dateStr)}
                              data-testid={`button-add-shift-${emp.id}-${dateStr}`}
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                )),
                    ];
                  });
                })()
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

      <Dialog open={shiftDialogOpen} onOpenChange={setShiftDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editingShift ? <Edit2 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {editingShift ? "編輯班次" : "新增班次"}
            </DialogTitle>
            <DialogDescription>
              {employees.find((e) => e.id === shiftEmployeeId)?.name} — {shiftDate ? format(new Date(shiftDate), "M月d日 (E)", { locale: zhTW }) : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>場館</Label>
              <Select value={shiftVenueId} onValueChange={setShiftVenueId}>
                <SelectTrigger data-testid="select-shift-venue">
                  <SelectValue placeholder="選擇場館" />
                </SelectTrigger>
                <SelectContent>
                  {venues.map((v) => (
                    <SelectItem key={v.id} value={v.id.toString()}>{v.shortName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>班別</Label>
              <Select value={shiftRole} onValueChange={setShiftRole}>
                <SelectTrigger data-testid="select-shift-role">
                  <SelectValue placeholder="選擇班別" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="救生">救生</SelectItem>
                  <SelectItem value="櫃台">櫃台</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-3">
              <div className="flex-1 space-y-2">
                <Label>開始時間</Label>
                <Input
                  type="time"
                  value={shiftStartTime}
                  onChange={(e) => setShiftStartTime(e.target.value)}
                  data-testid="input-shift-start-time"
                />
              </div>
              <div className="flex-1 space-y-2">
                <Label>結束時間</Label>
                <Input
                  type="time"
                  value={shiftEndTime}
                  onChange={(e) => setShiftEndTime(e.target.value)}
                  data-testid="input-shift-end-time"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Switch
                checked={shiftIsDispatch}
                onCheckedChange={setShiftIsDispatch}
                data-testid="switch-shift-dispatch"
              />
              <Label>派遣人員</Label>
            </div>

            <div className="rounded-md bg-muted/30 p-3 text-xs text-muted-foreground">
              預覽：{venues.find((v) => v.id.toString() === shiftVenueId)?.shortName || "—"} {shiftStartTime}-{shiftEndTime} [{shiftRole}]
              {shiftIsDispatch && " (派遣)"}
            </div>
          </div>

          <DialogFooter className="flex-row gap-2 justify-between sm:justify-between">
            <div>
              {editingShift && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    deleteShift.mutate(editingShift.id);
                    setShiftDialogOpen(false);
                  }}
                  data-testid="button-delete-shift"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  刪除
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShiftDialogOpen(false)} data-testid="button-cancel-shift">
                取消
              </Button>
              <Button
                onClick={handleSaveShift}
                disabled={!shiftVenueId || !shiftStartTime || !shiftEndTime}
                data-testid="button-save-shift"
              >
                儲存
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={slotDialogOpen} onOpenChange={setSlotDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editingSlot ? <Edit2 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {editingSlot ? "編輯需求時段" : "新增需求時段"}
            </DialogTitle>
            <DialogDescription>
              {venues.find((v) => v.id === editingSlotVenueId)?.shortName} — {editingSlotDate ? format(new Date(editingSlotDate), "M月d日 (E)", { locale: zhTW }) : ""}
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

      <Dialog open={requirementsPanelOpen} onOpenChange={setRequirementsPanelOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              場館需求設定
            </DialogTitle>
            <DialogDescription>
              {venues.find((v) => v.id === reqPanelVenueId)?.shortName} — {reqPanelDate ? format(new Date(reqPanelDate), "M月d日 (E)", { locale: zhTW }) : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {reqPanelVenueId && reqPanelDate && (() => {
              const cellSlots = slotsByVenueDate.get(`${reqPanelVenueId}-${reqPanelDate}`) || [];
              return cellSlots.length > 0 ? (
                <div className="space-y-2">
                  {cellSlots.map((slot) => {
                    const venueDateShifts = shiftsByVenueDate.get(`${slot.venueId}-${slot.date}`) || [];
                    const assignedCount = venueDateShifts.filter((sh) => shiftOverlapsSlot(sh, slot)).length;
                    const shortage = slot.requiredCount - assignedCount;
                    const isFull = shortage <= 0;
                    const RoleIcon = ROLE_ICON_MAP[slot.role] || UserRound;
                    return (
                      <div
                        key={slot.id}
                        className={`flex items-center justify-between gap-2 rounded-md px-3 py-2 border ${
                          isFull
                            ? "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30"
                            : "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30"
                        }`}
                        data-testid={`req-slot-${slot.id}`}
                      >
                        <div className="flex items-center gap-2 text-sm">
                          <RoleIcon className="h-3.5 w-3.5" />
                          <span className="font-medium">{slot.startTime}-{slot.endTime}</span>
                          <span>{slot.role} {slot.requiredCount}人</span>
                          {(slot as any)._fromTemplate && (
                            <span className="text-blue-500 text-[10px] border border-blue-300 dark:border-blue-700 rounded px-1">範本</span>
                          )}
                          {isFull ? (
                            <span className="text-green-600 dark:text-green-400 text-xs">已滿</span>
                          ) : (
                            <span className="text-red-600 dark:text-red-400 text-xs font-bold">缺{shortage}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => openEditSlotDialog(slot)}
                            data-testid={`button-edit-req-${slot.id}`}
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={async () => {
                              if (slot.id > 0) {
                                deleteSlot.mutate(slot.id);
                              } else {
                                try {
                                  await apiRequest("POST", "/api/schedule-slots/materialize", {
                                    venueId: slot.venueId,
                                    date: slot.date,
                                    excludeTemplateIds: [{ startTime: slot.startTime, endTime: slot.endTime, role: slot.role }],
                                  });
                                  queryClient.invalidateQueries({ queryKey: ["/api/schedule-slots"] });
                                  toast({ title: "需求已刪除" });
                                } catch {
                                  toast({ title: "操作失敗", variant: "destructive" });
                                }
                              }
                            }}
                            data-testid={`button-delete-req-${slot.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">尚未設定需求</p>
              );
            })()}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (reqPanelVenueId && reqPanelDate) {
                  openNewSlotDialog(reqPanelVenueId, reqPanelDate);
                }
              }}
              data-testid="button-add-requirement"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              新增需求時段
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
