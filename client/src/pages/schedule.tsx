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
import { Checkbox } from "@/components/ui/checkbox";
import {
  ChevronLeft, ChevronRight, CalendarDays, Plus, Minus, ChevronUp, ChevronDown,
  Check, AlertCircle, Trash2, Edit2, LifeBuoy, Dumbbell, UserRound,
  Sparkles, ShieldCheck, Settings2, X, Copy, Building2, Users
} from "lucide-react";
import type { Venue, Shift, ScheduleSlot, Employee, VenueShiftTemplate } from "@shared/schema";

const ROLE_ICON_MAP: Record<string, typeof LifeBuoy> = {
  "救生": LifeBuoy,
  "櫃台": UserRound,
  "櫃檯": UserRound,
  "清潔": Sparkles,
  "管理": ShieldCheck,
};

const ROLE_SHORT: Record<string, string> = {
  "救生": "救",
  "櫃台": "櫃",
  "櫃檯": "櫃",
  "清潔": "潔",
  "管理": "管",
};

const ROLE_LABELS: Record<string, string> = {
  "救生": "救生",
  "守望": "守望",
  "櫃台": "櫃台",
};

const DAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];
const ROLE_OPTIONS = ["救生", "守望", "櫃台"];

export default function SchedulePage() {
  const { activeRegion } = useRegion();
  const { toast } = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));

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
  const [shiftBatchDates, setShiftBatchDates] = useState<Set<string>>(new Set());
  const [shiftBatchMode, setShiftBatchMode] = useState(false);
  const [shiftTemplateId, setShiftTemplateId] = useState<string>("custom");
  const [shiftSelectedEmployeeIds, setShiftSelectedEmployeeIds] = useState<Set<number>>(new Set());
  const [employeeDropdownOpen, setEmployeeDropdownOpen] = useState(false);
  const [scheduleVisibleEmployeeIds, setScheduleVisibleEmployeeIds] = useState<Set<number>>(new Set());
  const [empPickerOpen, setEmpPickerOpen] = useState(false);

  const [requirementsPanelOpen, setRequirementsPanelOpen] = useState(false);
  const [reqPanelVenueId, setReqPanelVenueId] = useState<number | null>(null);
  const [reqPanelDate, setReqPanelDate] = useState<string>("");

  const [batchSlot, setBatchSlot] = useState<ScheduleSlot | null>(null);
  const [batchTargetDates, setBatchTargetDates] = useState<Set<string>>(new Set());
  const [batchTargetVenues, setBatchTargetVenues] = useState<Set<number>>(new Set());


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

  const { data: allEmployees = [], isLoading: empLoading } = useQuery<Employee[]>({
    queryKey: ["/api/employees", activeRegion],
  });
  const employees = useMemo(() => allEmployees.filter(e => e.status !== "inactive"), [allEmployees]);

  const { data: allSystemEmployees = [] } = useQuery<Employee[]>({
    queryKey: ["/api/employees-all"],
  });
  const pickerEmployees = useMemo(() => allSystemEmployees.filter(e => e.status !== "inactive"), [allSystemEmployees]);

  const { data: scheduleSlots = [], isLoading: slotsLoading } = useQuery<ScheduleSlot[]>({
    queryKey: ["/api/schedule-slots", activeRegion, dateRange.start, dateRange.end],
  });

  const { data: shifts = [] } = useQuery<Shift[]>({
    queryKey: ["/api/shifts", activeRegion, dateRange.start, dateRange.end],
  });

  const { data: shiftVenueTemplates = [] } = useQuery<VenueShiftTemplate[]>({
    queryKey: ["/api/venue-shift-templates", shiftVenueId ? parseInt(shiftVenueId) : null],
    enabled: !!shiftVenueId && shiftDialogOpen,
  });

  const filteredTemplates = useMemo(() => {
    if (!shiftDate || shiftVenueTemplates.length === 0) return [];
    const dayOfWeek = new Date(shiftDate).getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const dayType = isWeekend ? "weekend" : "weekday";
    const normalizeRole = (r: string) => r === "櫃檯" ? "櫃台" : r;
    const matched = shiftVenueTemplates.filter(t => t.dayType === dayType && normalizeRole(t.role) === normalizeRole(shiftRole));
    const seen = new Set<string>();
    return matched.filter(t => {
      const key = `${t.shiftLabel}-${t.startTime}-${t.endTime}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [shiftVenueTemplates, shiftDate, shiftRole]);

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

  const venuesWithRequirements = useMemo(() => {
    const ids = new Set<number>();
    scheduleSlots.forEach((s) => ids.add(s.venueId));
    return ids;
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

  const batchDeleteShifts = useMutation({
    mutationFn: async (data: { employeeId: number; venueId?: number; startTime?: string; endTime?: string; role?: string; targetDates: string[] }) => {
      const res = await apiRequest("POST", "/api/shifts/batch-delete", data);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries();
      toast({ title: `已刪除 ${data.deletedCount} 筆班次` });
      setShiftBatchDates(new Set());
      setShiftBatchMode(false);
    },
    onError: (err: Error) => {
      toast({ title: "批次刪除失敗", description: err.message, variant: "destructive" });
    },
  });

  const batchCreateShifts = useMutation({
    mutationFn: async (data: { employeeId: number; venueId: string; startTime: string; endTime: string; role: string; isDispatch: boolean; targetDates: string[] }) => {
      const res = await apiRequest("POST", "/api/shifts/batch", data);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries();
      const msg = `已新增 ${data.created} 筆班次`;
      const errMsg = data.errors?.length > 0 ? `（${data.errors.length} 筆因勞基法限制略過）` : "";
      toast({ title: msg + errMsg });
      setShiftBatchDates(new Set());
      setShiftBatchMode(false);
    },
    onError: (err: Error) => {
      toast({ title: "批次新增失敗", description: err.message, variant: "destructive" });
    },
  });

  const batchCopySlot = useMutation({
    mutationFn: async (data: { venueIds: number[]; startTime: string; endTime: string; role: string; requiredCount: number; targetDates: string[] }) => {
      const res = await apiRequest("POST", "/api/schedule-slots/batch-copy", data);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-slots"] });
      toast({ title: `已套用 ${data.created} 筆${data.skipped > 0 ? `（${data.skipped} 筆重複略過）` : ""}` });
      setBatchSlot(null);
      setBatchTargetDates(new Set());
      setBatchTargetVenues(new Set());
    },
    onError: (err: Error) => {
      toast({ title: "批次套用失敗", description: err.message, variant: "destructive" });
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
    setShiftRole(emp?.role === "櫃台" ? "櫃台" : emp?.role === "守望" ? "守望" : "救生");
    setShiftBatchMode(false);
    setShiftBatchDates(new Set());
    setShiftTemplateId("custom");
    setShiftSelectedEmployeeIds(new Set([employeeId]));
    setEmployeeDropdownOpen(false);
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
    setShiftTemplateId("custom");
    setShiftDialogOpen(true);
  };

  const handleSaveShift = () => {
    if (!shiftDate || !shiftVenueId || !shiftStartTime || !shiftEndTime) return;
    if (editingShift) {
      updateShift.mutate({
        id: editingShift.id,
        employeeId: shiftEmployeeId!,
        venueId: parseInt(shiftVenueId),
        date: shiftDate,
        startTime: shiftStartTime,
        endTime: shiftEndTime,
        role: shiftRole,
        isDispatch: shiftIsDispatch,
      });
      setShiftDialogOpen(false);
    } else {
      const targetEmployeeIds = shiftSelectedEmployeeIds.size > 0
        ? Array.from(shiftSelectedEmployeeIds)
        : shiftEmployeeId ? [shiftEmployeeId] : [];
      if (targetEmployeeIds.length === 0) return;

      const allDates = shiftBatchMode && shiftBatchDates.size > 0
        ? [shiftDate, ...Array.from(shiftBatchDates)]
        : [shiftDate];

      for (const empId of targetEmployeeIds) {
        if (allDates.length > 1) {
          batchCreateShifts.mutate({
            employeeId: empId,
            venueId: shiftVenueId,
            startTime: shiftStartTime,
            endTime: shiftEndTime,
            role: shiftRole,
            isDispatch: shiftIsDispatch,
            targetDates: allDates,
          });
        } else {
          createShift.mutate({
            employeeId: empId,
            venueId: parseInt(shiftVenueId),
            date: shiftDate,
            startTime: shiftStartTime,
            endTime: shiftEndTime,
            role: shiftRole,
            isDispatch: shiftIsDispatch,
          });
        }
      }
      setShiftDialogOpen(false);
    }
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
    setBatchSlot(null);
    setBatchTargetDates(new Set());
    setBatchTargetVenues(new Set());
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

  const shortageDates = useMemo(() => {
    const dateSet = new Set<string>();
    gapAnalysis.gaps.forEach((g) => dateSet.add(g.date));
    return Array.from(dateSet).sort();
  }, [gapAnalysis]);

  const employeeShiftCounts = useMemo(() => {
    const counts = new Map<number, number>();
    shifts.forEach((s) => {
      counts.set(s.employeeId, (counts.get(s.employeeId) || 0) + 1);
    });
    return counts;
  }, [shifts]);

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-50 bg-background border-b border-border/50">
        <div className="flex items-center justify-center py-2 px-4">
          <RegionTabs />
        </div>
      </div>

      <div className="sticky top-[49px] z-40 bg-background flex items-center justify-between gap-2 px-4 py-2 border-b flex-wrap">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-bold tracking-tight" data-testid="text-page-title">排班編輯器</h1>
          <span className="text-muted-foreground/40">|</span>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => setCurrentMonth((prev) => subMonths(prev, 1))}
            data-testid="button-prev-month"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="text-sm font-medium" data-testid="text-month-range">
            {format(currentMonth, "yyyy年 M月", { locale: zhTW })}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => setCurrentMonth((prev) => addMonths(prev, 1))}
            data-testid="button-next-month"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setCurrentMonth(startOfMonth(new Date()))}
            data-testid="button-today"
          >
            本月
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 text-xs" data-testid="button-pick-date">
                <CalendarDays className="h-3 w-3 mr-1" />
                選月
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
        <div className="flex items-start gap-2">
          {shortageDates.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
              <span className="text-[10px] text-red-600 dark:text-red-400 font-medium flex items-center gap-1 shrink-0">
                <AlertCircle className="h-3 w-3" />
                缺班快跳
              </span>
              {shortageDates.map((d) => (
                <button
                  key={d}
                  className="text-[10px] px-1.5 py-0.5 rounded-md bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-300 border border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/60 transition-colors cursor-pointer font-medium"
                  onClick={() => {
                    const el = scrollRef.current?.querySelector(`[data-date-col="${d}"]`);
                    if (el) el.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
                  }}
                  title={`跳至 ${d} (缺班)`}
                  data-testid={`button-jump-shortage-${d}`}
                >
                  {format(new Date(d), "M/d")}
                </button>
              ))}
            </div>
          )}

          <Popover open={empPickerOpen} onOpenChange={setEmpPickerOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={`h-7 text-xs gap-1.5 shrink-0 ${shortageDates.length === 0 ? "ml-auto" : ""}`} data-testid="button-employee-picker">
                <Users className="h-3.5 w-3.5" />
                {scheduleVisibleEmployeeIds.size === 0 ? "選擇排班人員" : `已選 ${scheduleVisibleEmployeeIds.size} 人`}
                <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[300px] p-0" align="end">
              <div className="flex items-center justify-between px-3 py-2 border-b">
                <span className="text-xs font-semibold">選擇排班人員</span>
                <div className="flex gap-1">
                  <button
                    className="text-[10px] px-2 py-0.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground"
                    onClick={() => setScheduleVisibleEmployeeIds(new Set(pickerEmployees.map(e => e.id)))}
                  >
                    全選
                  </button>
                  <button
                    className="text-[10px] px-2 py-0.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground"
                    onClick={() => setScheduleVisibleEmployeeIds(new Set())}
                  >
                    清空
                  </button>
                </div>
              </div>
              <div className="max-h-[350px] overflow-auto p-1">
                {[
                  { key: "ft-counter", label: "正職櫃台", filter: (e: Employee) => e.employmentType === "full_time" && e.role === "櫃台" },
                  { key: "ft-rescue", label: "正職救生", filter: (e: Employee) => e.employmentType === "full_time" && e.role === "救生" },
                  { key: "ft-guard", label: "正職守望", filter: (e: Employee) => e.employmentType === "full_time" && e.role === "守望" },
                  { key: "ft-coach", label: "正職教練", filter: (e: Employee) => e.employmentType === "full_time" && e.role === "教練" },
                  { key: "ft-manager", label: "正職主管職", filter: (e: Employee) => e.employmentType === "full_time" && e.role === "主管職" },
                  { key: "pt-counter", label: "兼職櫃台", filter: (e: Employee) => e.employmentType === "part_time" && e.role === "櫃台" },
                  { key: "pt-rescue", label: "兼職救生", filter: (e: Employee) => e.employmentType === "part_time" && e.role === "救生" },
                  { key: "pt-guard", label: "兼職守望", filter: (e: Employee) => e.employmentType === "part_time" && e.role === "守望" },
                  { key: "pt-coach", label: "兼職教練", filter: (e: Employee) => e.employmentType === "part_time" && e.role === "教練" },
                  { key: "pt-manager", label: "兼職主管職", filter: (e: Employee) => e.employmentType === "part_time" && e.role === "主管職" },
                ].map(group => {
                  const groupEmps = pickerEmployees.filter(group.filter);
                  if (groupEmps.length === 0) return null;
                  const allSelected = groupEmps.every(e => scheduleVisibleEmployeeIds.has(e.id));
                  const someSelected = groupEmps.some(e => scheduleVisibleEmployeeIds.has(e.id));
                  return (
                    <div key={group.key} className="mb-0.5">
                      <button
                        type="button"
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted rounded-sm"
                        onClick={() => {
                          const next = new Set(scheduleVisibleEmployeeIds);
                          if (allSelected) {
                            groupEmps.forEach(e => next.delete(e.id));
                          } else {
                            groupEmps.forEach(e => next.add(e.id));
                          }
                          setScheduleVisibleEmployeeIds(next);
                        }}
                        data-testid={`picker-group-${group.key}`}
                      >
                        <Checkbox checked={allSelected ? true : someSelected ? "indeterminate" : false} className="h-3.5 w-3.5" />
                        {group.label} ({groupEmps.length})
                      </button>
                      {groupEmps.map(emp => (
                        <button
                          key={emp.id}
                          type="button"
                          className="w-full flex items-center gap-2 pl-6 pr-2 py-1 text-sm hover:bg-muted rounded-sm"
                          onClick={() => {
                            const next = new Set(scheduleVisibleEmployeeIds);
                            if (next.has(emp.id)) next.delete(emp.id);
                            else next.add(emp.id);
                            setScheduleVisibleEmployeeIds(next);
                          }}
                          data-testid={`picker-emp-${emp.id}`}
                        >
                          <Checkbox checked={scheduleVisibleEmployeeIds.has(emp.id)} className="h-3.5 w-3.5" />
                          <span className="text-foreground">{emp.name}</span>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col relative">
        <div className="flex-1 overflow-auto" ref={scrollRef}>
          <table className="border-separate border-spacing-0 text-sm" style={{ minWidth: `${COL_LEFT_WIDTH + monthDates.length * COL_DATE_WIDTH}px` }}>
            <thead>
              <tr>
                <th
                  className="text-left p-2 border-b border-r font-medium text-muted-foreground bg-background"
                  style={{ minWidth: COL_LEFT_WIDTH, width: COL_LEFT_WIDTH, position: "sticky", top: 0, left: 0, zIndex: 35 }}
                >
                  員工/場館
                </th>
                {monthDates.map((d, i) => {
                  const isToday = format(d, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");
                  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                  return (
                    <th
                      key={i}
                      data-date-col={format(d, "yyyy-MM-dd")}
                      className={`text-center p-1.5 border-b border-r font-medium ${
                        isToday ? "bg-background" : isWeekend ? "bg-muted" : "bg-background"
                      }`}
                      style={{ minWidth: COL_DATE_WIDTH, width: COL_DATE_WIDTH, position: "sticky", top: 0, zIndex: 25 }}
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
                  const activeVenues = venues.filter((v) => venuesWithRequirements.has(v.id));
                  const VENUE_LABEL_OK = "#1a3a2a";
                  const VENUE_LABEL_SHORT = "#3a1a1a";
                  const VENUE_CELL_OK = "#1a3a2a";
                  const VENUE_CELL_SHORT = "#3a1a1a";
                  const VENUE_CELL_NONE = "#1d283a";
                  const venueRows = activeVenues.map((venue) => {
                    const hasAnyShortage = monthDates.some((d) => {
                      const key = `${venue.id}-${format(d, "yyyy-MM-dd")}`;
                      const sh = venueDateShortage.get(key);
                      return sh && sh.size > 0;
                    });
                    const labelBg = hasAnyShortage ? VENUE_LABEL_SHORT : VENUE_LABEL_OK;
                    return (
                    <tr key={`summary-${venue.id}`} style={{ height: 36 }}>
                      <td
                        className="p-2 border-b border-r text-left sticky left-0 z-[5]"
                        style={{ minWidth: COL_LEFT_WIDTH, width: COL_LEFT_WIDTH, backgroundColor: labelBg }}
                      >
                        <span className="font-medium text-xs text-white whitespace-nowrap" data-testid={`text-venue-summary-${venue.id}`}>
                          {venue.shortName}
                        </span>
                      </td>
                      {monthDates.map((d, di) => {
                        const dateStr = format(d, "yyyy-MM-dd");
                        const key = `${venue.id}-${dateStr}`;
                        const roleShortages = venueDateShortage.get(key);
                        const cellSlots = slotsByVenueDate.get(key) || [];
                        const hasRequirements = cellSlots.length > 0;
                        const cellBg = hasRequirements
                          ? (roleShortages && roleShortages.size > 0 ? VENUE_CELL_SHORT : VENUE_CELL_OK)
                          : VENUE_CELL_NONE;
                        return (
                          <td
                            key={di}
                            className="p-0.5 border-b border-r text-center align-middle overflow-hidden"
                            style={{ minWidth: COL_DATE_WIDTH, width: COL_DATE_WIDTH, maxWidth: COL_DATE_WIDTH, backgroundColor: cellBg }}
                            data-testid={`summary-cell-${venue.id}-${dateStr}`}
                          >
                            <button
                              className="w-full h-full flex items-center justify-center gap-0.5 py-0.5 rounded hover:brightness-125 transition-all cursor-pointer overflow-hidden"
                              onClick={() => openRequirementsPanel(venue.id, dateStr)}
                              data-testid={`button-req-${venue.id}-${dateStr}`}
                            >
                              {hasRequirements ? (
                                roleShortages && roleShortages.size > 0 ? (
                                  <span className="inline-flex items-center gap-0.5 text-red-300 text-[9px] font-bold truncate">
                                    {Array.from(roleShortages.entries()).map(([role, count]) => {
                                      const Icon = ROLE_ICON_MAP[role] || UserRound;
                                      return (
                                        <span key={role} className="inline-flex items-center gap-0.5">
                                          <Icon className="h-2.5 w-2.5 shrink-0" />
                                          -{count}
                                        </span>
                                      );
                                    })}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-0.5 text-green-300 text-[9px] font-bold">
                                    <Check className="h-2.5 w-2.5" />
                                    OK
                                  </span>
                                )
                              ) : (
                                <Settings2 className="h-2.5 w-2.5 text-white/30" />
                              )}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );});
                  const groups = [
                    { key: "ft-counter", label: "正職櫃台", filter: (e: Employee) => e.employmentType === "full_time" && e.role === "櫃台" },
                    { key: "ft-rescue", label: "正職救生", filter: (e: Employee) => e.employmentType === "full_time" && e.role === "救生" },
                    { key: "ft-guard", label: "正職守望", filter: (e: Employee) => e.employmentType === "full_time" && e.role === "守望" },
                    { key: "ft-coach", label: "正職教練", filter: (e: Employee) => e.employmentType === "full_time" && e.role === "教練" },
                    { key: "ft-manager", label: "正職主管職", filter: (e: Employee) => e.employmentType === "full_time" && e.role === "主管職" },
                    { key: "pt-counter", label: "兼職櫃台", filter: (e: Employee) => e.employmentType === "part_time" && e.role === "櫃台" },
                    { key: "pt-rescue", label: "兼職救生", filter: (e: Employee) => e.employmentType === "part_time" && e.role === "救生" },
                    { key: "pt-guard", label: "兼職守望", filter: (e: Employee) => e.employmentType === "part_time" && e.role === "守望" },
                    { key: "pt-coach", label: "兼職教練", filter: (e: Employee) => e.employmentType === "part_time" && e.role === "教練" },
                    { key: "pt-manager", label: "兼職主管職", filter: (e: Employee) => e.employmentType === "part_time" && e.role === "主管職" },
                  ];
                  const visibleEmployees = pickerEmployees.filter(e => scheduleVisibleEmployeeIds.has(e.id));
                  return [
                    ...venueRows,
                    ...groups.flatMap(({ key, label, filter }) => {
                    const grouped = visibleEmployees.filter(filter).sort((a, b) => {
                      const countA = employeeShiftCounts.get(a.id) || 0;
                      const countB = employeeShiftCounts.get(b.id) || 0;
                      return countB - countA;
                    });
                    if (grouped.length === 0) return [];
                    return [
                      <tr key={`group-${key}`}>
                        <td
                          className="px-2 py-1 border-b border-r sticky left-0 bg-muted z-[5] text-xs font-bold text-muted-foreground tracking-wide"
                          style={{ minWidth: COL_LEFT_WIDTH }}
                        >
                          {label} ({grouped.length})
                        </td>
                        {monthDates.map((_, di) => (
                          <td key={di} className="border-b border-r bg-muted" style={{ minWidth: COL_DATE_WIDTH }} />
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
                                const shiftDateStr = format(d, "yyyy-MM-dd");
                                const slots = slotsByVenueDate.get(`${shift.venueId}-${shiftDateStr}`) || [];
                                const sStart = shift.startTime.substring(0, 5);
                                const sEnd = shift.endTime.substring(0, 5);
                                const matchedSlot = slots.find(sl => sl.startTime.substring(0, 5) <= sStart && sl.endTime.substring(0, 5) >= sEnd) 
                                  || slots.find(sl => sl.startTime.substring(0, 5) <= sStart && sStart < sl.endTime.substring(0, 5));
                                const shiftRole = matchedSlot?.role || ROLE_LABELS[emp.role] || emp.role;
                                const roleShort = ROLE_SHORT[shiftRole] || shiftRole.slice(0, 1);
                                const isCounter = shiftRole === "櫃台" || shiftRole === "櫃檯";
                                const cardColor = shift.isDispatch
                                  ? "bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800"
                                  : isCounter
                                    ? "bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800"
                                    : "bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800";
                                return (
                                  <div
                                    key={shift.id}
                                    className={`rounded px-1 py-0.5 text-xs cursor-pointer transition-colors ${cardColor}`}
                                    onClick={() => openEditShiftDialog(shift)}
                                    data-testid={`shift-${shift.id}`}
                                  >
                                    <div className="flex items-center justify-between gap-1">
                                      <div className="font-medium leading-tight text-[11px] truncate">
                                        {venue?.shortName || "未知"}
                                      </div>
                                      <span className="text-[9px] px-0.5 rounded bg-background/50 border border-current opacity-70 shrink-0">
                                        {roleShort}
                                      </span>
                                    </div>
                                    <div className="leading-tight text-[11px] text-muted-foreground">
                                      {sStart}-{sEnd}
                                    </div>
                                    {shift.isDispatch && (
                                      <div className="text-[10px] text-purple-600 dark:text-purple-400 font-medium">派遣</div>
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
                  }),
                  ];
                })()
              )}
            </tbody>
          </table>
        </div>

      </div>

      <Dialog open={shiftDialogOpen} onOpenChange={setShiftDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              {employees.find((e) => e.id === shiftEmployeeId)?.name} <span className="text-sm font-normal text-muted-foreground">— {shiftDate ? format(new Date(shiftDate), "M月d日 (E)", { locale: zhTW }) : ""}</span>
            </DialogTitle>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {editingShift ? <Edit2 className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              <span>{editingShift ? "編輯班次" : "新增班次"}</span>
            </div>
          </DialogHeader>

          <div className="space-y-4">
            {!editingShift && (
              <div className="space-y-2">
                <Label>排班人員</Label>
                <Popover open={employeeDropdownOpen} onOpenChange={setEmployeeDropdownOpen}>
                  <PopoverTrigger asChild>
                    <button
                      className="w-full flex items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background hover:bg-accent hover:text-accent-foreground"
                      data-testid="button-select-employees"
                    >
                      <span className="truncate">
                        {shiftSelectedEmployeeIds.size === 0
                          ? "選擇人員"
                          : shiftSelectedEmployeeIds.size === 1
                            ? employees.find(e => shiftSelectedEmployeeIds.has(e.id))?.name || "1 人"
                            : `已選 ${shiftSelectedEmployeeIds.size} 人`}
                      </span>
                      <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[280px] p-0" align="start">
                    <div className="max-h-[300px] overflow-auto p-1">
                      {[
                        { key: "ft-counter", label: "正職櫃台", filter: (e: Employee) => e.employmentType === "full_time" && e.role === "櫃台" },
                        { key: "ft-rescue", label: "正職救生", filter: (e: Employee) => e.employmentType === "full_time" && e.role === "救生" },
                        { key: "ft-guard", label: "正職守望", filter: (e: Employee) => e.employmentType === "full_time" && e.role === "守望" },
                        { key: "ft-coach", label: "正職教練", filter: (e: Employee) => e.employmentType === "full_time" && e.role === "教練" },
                        { key: "ft-manager", label: "正職主管職", filter: (e: Employee) => e.employmentType === "full_time" && e.role === "主管職" },
                        { key: "pt-counter", label: "兼職櫃台", filter: (e: Employee) => e.employmentType === "part_time" && e.role === "櫃台" },
                        { key: "pt-rescue", label: "兼職救生", filter: (e: Employee) => e.employmentType === "part_time" && e.role === "救生" },
                        { key: "pt-guard", label: "兼職守望", filter: (e: Employee) => e.employmentType === "part_time" && e.role === "守望" },
                        { key: "pt-coach", label: "兼職教練", filter: (e: Employee) => e.employmentType === "part_time" && e.role === "教練" },
                        { key: "pt-manager", label: "兼職主管職", filter: (e: Employee) => e.employmentType === "part_time" && e.role === "主管職" },
                      ].map(group => {
                        const groupEmps = employees.filter(group.filter);
                        if (groupEmps.length === 0) return null;
                        const allSelected = groupEmps.every(e => shiftSelectedEmployeeIds.has(e.id));
                        return (
                          <div key={group.key} className="mb-1">
                            <button
                              type="button"
                              className="w-full flex items-center gap-2 px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted rounded-sm"
                              onClick={() => {
                                const next = new Set(shiftSelectedEmployeeIds);
                                if (allSelected) {
                                  groupEmps.forEach(e => next.delete(e.id));
                                } else {
                                  groupEmps.forEach(e => next.add(e.id));
                                }
                                setShiftSelectedEmployeeIds(next);
                              }}
                            >
                              <Checkbox checked={allSelected} className="h-3.5 w-3.5" />
                              {group.label} ({groupEmps.length})
                            </button>
                            {groupEmps.map(emp => (
                              <button
                                key={emp.id}
                                type="button"
                                className="w-full flex items-center gap-2 pl-6 pr-2 py-1.5 text-sm hover:bg-muted rounded-sm"
                                onClick={() => {
                                  const next = new Set(shiftSelectedEmployeeIds);
                                  if (next.has(emp.id)) next.delete(emp.id);
                                  else next.add(emp.id);
                                  setShiftSelectedEmployeeIds(next);
                                }}
                                data-testid={`checkbox-employee-${emp.id}`}
                              >
                                <Checkbox checked={shiftSelectedEmployeeIds.has(emp.id)} className="h-3.5 w-3.5" />
                                <span className="text-foreground">{emp.name}</span>
                              </button>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            )}

            <div className="flex gap-3">
              <div className="flex-1 space-y-2">
                <Label>場館</Label>
                <Select value={shiftVenueId} onValueChange={(v) => { setShiftVenueId(v); setShiftTemplateId("custom"); }}>
                  <SelectTrigger data-testid="select-shift-venue">
                    <SelectValue placeholder="選擇場館" />
                  </SelectTrigger>
                  <SelectContent>
                    {venues.filter((v) => venuesWithRequirements.has(v.id)).map((v) => (
                      <SelectItem key={v.id} value={v.id.toString()}>{v.shortName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1 space-y-2">
                <Label>班別</Label>
                <Select value={shiftRole} onValueChange={(v) => { setShiftRole(v); setShiftTemplateId("custom"); }}>
                  <SelectTrigger data-testid="select-shift-role">
                    <SelectValue placeholder="選擇班別" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="救生">救生</SelectItem>
                    <SelectItem value="櫃台">櫃台</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>排班範本</Label>
              <Select
                value={shiftTemplateId}
                onValueChange={(val) => {
                  setShiftTemplateId(val);
                  if (val !== "custom") {
                    const tpl = filteredTemplates.find(t => t.id.toString() === val);
                    if (tpl) {
                      setShiftStartTime(tpl.startTime);
                      setShiftEndTime(tpl.endTime);
                    }
                  }
                }}
              >
                <SelectTrigger data-testid="select-shift-template">
                  <SelectValue placeholder="選擇排班範本" />
                </SelectTrigger>
                <SelectContent>
                  {filteredTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id.toString()}>
                      {t.shiftLabel} ({t.startTime}-{t.endTime})
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">自訂時間</SelectItem>
                </SelectContent>
              </Select>
              {filteredTemplates.length === 0 && (
                <p className="text-[10px] text-muted-foreground italic">此場館尚未設定{shiftRole}的排班範本</p>
              )}
            </div>

            <div className="flex gap-3">
              <div className="flex-1 space-y-2">
                <Label>開始時間</Label>
                <Input
                  type="time"
                  value={shiftStartTime}
                  onChange={(e) => { setShiftStartTime(e.target.value); setShiftTemplateId("custom"); }}
                  data-testid="input-shift-start-time"
                />
              </div>
              <div className="flex-1 space-y-2">
                <Label>結束時間</Label>
                <Input
                  type="time"
                  value={shiftEndTime}
                  onChange={(e) => { setShiftEndTime(e.target.value); setShiftTemplateId("custom"); }}
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

            {shiftEmployeeId && (() => {
              const empShifts = shifts.filter(s => s.employeeId === shiftEmployeeId)
                .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
              return (
                <div className="rounded-lg border p-3 space-y-1.5">
                  <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" />
                    本月排班狀況 ({empShifts.length} 筆)
                  </div>
                  {empShifts.length === 0 ? (
                    <div className="text-xs text-muted-foreground/60">本月尚無排班</div>
                  ) : (
                    <div className="max-h-[120px] overflow-auto space-y-0.5">
                      {empShifts.map(s => {
                        const v = venues.find(vn => vn.id === s.venueId);
                        const isCurrentDate = s.date === shiftDate;
                        return (
                          <div
                            key={s.id}
                            className={`text-[11px] flex items-center gap-1.5 px-1.5 py-0.5 rounded ${isCurrentDate ? "bg-primary/10 font-semibold" : ""}`}
                          >
                            <span className="text-muted-foreground w-[36px] shrink-0">{format(new Date(s.date), "M/d")}</span>
                            <span className="text-muted-foreground w-[14px] shrink-0">{DAY_NAMES[new Date(s.date).getDay()]}</span>
                            <span className="truncate">{v?.shortName || "?"}</span>
                            <span className="text-muted-foreground">{s.startTime.substring(0, 5)}-{s.endTime.substring(0, 5)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Switch
                  checked={shiftBatchMode}
                  onCheckedChange={(checked) => {
                    setShiftBatchMode(checked);
                    if (!checked) setShiftBatchDates(new Set());
                  }}
                  data-testid="switch-shift-batch"
                />
                <Label className="text-sm">批次調整</Label>
                {shiftBatchMode && shiftBatchDates.size > 0 && (
                  <span className="text-xs text-primary font-medium ml-auto">
                    已選 {shiftBatchDates.size + 1} 天
                  </span>
                )}
              </div>
              {shiftBatchMode && (() => {
                const empShiftsMap = new Map<string, typeof shifts>();
                if (shiftEmployeeId) {
                  shifts.filter(s => s.employeeId === shiftEmployeeId).forEach(s => {
                    const existing = empShiftsMap.get(s.date) || [];
                    existing.push(s);
                    empShiftsMap.set(s.date, existing);
                  });
                }
                return (
                <div className="rounded-lg border p-3 space-y-2">
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" />
                    選擇其他日期同步調整：
                  </div>
                  <div className="flex gap-1 mb-1.5 flex-wrap">
                    <button
                      type="button"
                      className="text-[10px] px-2 py-0.5 rounded border border-border hover:bg-muted transition-colors"
                      onClick={() => {
                        const weekday = new Date(shiftDate).getDay();
                        const sameDays = monthDates.filter(d => d.getDay() === weekday && format(d, "yyyy-MM-dd") !== shiftDate);
                        setShiftBatchDates(new Set(sameDays.map(d => format(d, "yyyy-MM-dd"))));
                      }}
                      data-testid="button-batch-same-weekday"
                    >
                      全選同星期{DAY_NAMES[new Date(shiftDate).getDay()]}
                    </button>
                    <button
                      type="button"
                      className="text-[10px] px-2 py-0.5 rounded border border-border hover:bg-muted transition-colors"
                      onClick={() => {
                        const all = monthDates
                          .map(d => format(d, "yyyy-MM-dd"))
                          .filter(d => d !== shiftDate);
                        setShiftBatchDates(new Set(all));
                      }}
                      data-testid="button-batch-all-dates"
                    >
                      全選
                    </button>
                    <button
                      type="button"
                      className="text-[10px] px-2 py-0.5 rounded border border-border hover:bg-muted transition-colors"
                      onClick={() => {
                        const unscheduled = monthDates
                          .map(d => format(d, "yyyy-MM-dd"))
                          .filter(d => d !== shiftDate && !empShiftsMap.has(d));
                        setShiftBatchDates(new Set(unscheduled));
                      }}
                      data-testid="button-batch-empty-dates"
                    >
                      全選空白日
                    </button>
                    <button
                      type="button"
                      className="text-[10px] px-2 py-0.5 rounded border border-border hover:bg-muted transition-colors"
                      onClick={() => setShiftBatchDates(new Set())}
                      data-testid="button-batch-clear"
                    >
                      清除
                    </button>
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {monthDates.map((md) => {
                      const mdStr = format(md, "yyyy-MM-dd");
                      const isCurrent = mdStr === shiftDate;
                      const isSelected = shiftBatchDates.has(mdStr);
                      const isWeekend = md.getDay() === 0 || md.getDay() === 6;
                      const dateShifts = empShiftsMap.get(mdStr) || [];
                      const hasShift = dateShifts.length > 0;
                      return (
                        <button
                          key={mdStr}
                          type="button"
                          disabled={isCurrent}
                          className={`relative text-[10px] py-1.5 rounded text-center transition-all ${
                            isCurrent
                              ? "bg-primary text-primary-foreground font-bold cursor-default"
                              : isSelected
                                ? "bg-blue-500 text-white font-bold"
                                : hasShift
                                  ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700 font-medium hover:bg-emerald-200 dark:hover:bg-emerald-800/50"
                                  : isWeekend
                                    ? "bg-muted/50 hover:bg-muted text-muted-foreground"
                                    : "bg-background hover:bg-muted border border-border/50"
                          }`}
                          onClick={() => {
                            const next = new Set(shiftBatchDates);
                            if (next.has(mdStr)) next.delete(mdStr);
                            else next.add(mdStr);
                            setShiftBatchDates(next);
                          }}
                          title={hasShift ? dateShifts.map(s => {
                            const v = venues.find(vn => vn.id === s.venueId);
                            return `${v?.shortName || "?"} ${s.startTime.substring(0, 5)}-${s.endTime.substring(0, 5)}`;
                          }).join(", ") : undefined}
                          data-testid={`batch-shift-date-${mdStr}`}
                        >
                          {format(md, "d")}
                          {hasShift && !isCurrent && !isSelected && (
                            <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-emerald-500" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground pt-1">
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-emerald-100 dark:bg-emerald-900/40 border border-emerald-300 dark:border-emerald-700" />已排班</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-blue-500" />已勾選</span>
                  </div>
                </div>
                );
              })()}
            </div>
          </div>

          <DialogFooter className="flex-row gap-2 justify-between sm:justify-between">
            <div className="flex gap-2">
              {editingShift && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (shiftBatchMode && shiftBatchDates.size > 0) {
                      const allDates = [shiftDate, ...Array.from(shiftBatchDates)];
                      batchDeleteShifts.mutate({
                        employeeId: shiftEmployeeId!,
                        venueId: editingShift.venueId,
                        startTime: editingShift.startTime,
                        endTime: editingShift.endTime,
                        role: editingShift.role || undefined,
                        targetDates: allDates,
                      });
                    } else {
                      deleteShift.mutate(editingShift.id);
                    }
                    setShiftDialogOpen(false);
                  }}
                  disabled={batchDeleteShifts.isPending}
                  data-testid="button-delete-shift"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  {shiftBatchMode && shiftBatchDates.size > 0 ? `批次刪除 (${shiftBatchDates.size + 1})` : "刪除"}
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShiftDialogOpen(false)} data-testid="button-cancel-shift">
                取消
              </Button>
              <Button
                onClick={handleSaveShift}
                disabled={!shiftVenueId || !shiftStartTime || !shiftEndTime || batchCreateShifts.isPending}
                data-testid="button-save-shift"
              >
                {shiftBatchMode && shiftBatchDates.size > 0
                  ? batchCreateShifts.isPending ? "調整中..." : `批次調整 (${shiftBatchDates.size + 1}天)`
                  : "儲存"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={slotDialogOpen} onOpenChange={setSlotDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editingSlot ? <Edit2 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              設定需求時段
            </DialogTitle>
            <DialogDescription>
              {venues.find((v) => v.id === editingSlotVenueId)?.shortName} — {editingSlotDate ? format(new Date(editingSlotDate), "M月d日 (E)", { locale: zhTW }) : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">時段</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="time"
                  value={slotStartTime}
                  onChange={(e) => setSlotStartTime(e.target.value)}
                  className="flex-1"
                  data-testid="input-slot-start-time"
                />
                <span className="text-muted-foreground text-sm">至</span>
                <Input
                  type="time"
                  value={slotEndTime}
                  onChange={(e) => setSlotEndTime(e.target.value)}
                  className="flex-1"
                  data-testid="input-slot-end-time"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">職位</Label>
              <div className="flex bg-muted rounded-lg p-1" data-testid="toggle-slot-role">
                <button
                  type="button"
                  className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${
                    slotRole === "救生"
                      ? "bg-red-500 text-white shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setSlotRole("救生")}
                  data-testid="toggle-role-rescue"
                >
                  <LifeBuoy className="h-3.5 w-3.5 inline mr-1" />
                  救生
                </button>
                <button
                  type="button"
                  className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${
                    slotRole === "櫃台" || slotRole === "櫃檯"
                      ? "bg-blue-500 text-white shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setSlotRole("櫃台")}
                  data-testid="toggle-role-counter"
                >
                  <UserRound className="h-3.5 w-3.5 inline mr-1" />
                  櫃台
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">需求人數</Label>
              <div className="flex items-center justify-center gap-4 bg-muted rounded-lg p-3">
                <button
                  type="button"
                  className="h-10 w-10 rounded-full bg-background border border-border flex items-center justify-center hover:bg-accent transition-colors disabled:opacity-30"
                  onClick={() => setSlotCount(String(Math.max(1, parseInt(slotCount) - 1)))}
                  disabled={parseInt(slotCount) <= 1}
                  data-testid="button-slot-count-minus"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="text-3xl font-bold w-12 text-center tabular-nums" data-testid="text-slot-count">
                  {slotCount}
                </span>
                <button
                  type="button"
                  className="h-10 w-10 rounded-full bg-background border border-border flex items-center justify-center hover:bg-accent transition-colors"
                  onClick={() => setSlotCount(String(parseInt(slotCount) + 1))}
                  data-testid="button-slot-count-plus"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
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

      {requirementsPanelOpen && (
        <div className="fixed inset-0 z-50 flex justify-end" data-testid="requirements-panel-overlay">
          <div className="absolute inset-0 bg-black/50" onClick={() => { setRequirementsPanelOpen(false); setBatchSlot(null); }} />
          <div className="relative w-full max-w-sm bg-background border-l shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <h2 className="text-base font-bold flex items-center gap-2">
                  <Settings2 className="h-4 w-4" />
                  場館需求設定
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {venues.find((v) => v.id === reqPanelVenueId)?.shortName} — {reqPanelDate ? format(new Date(reqPanelDate), "M月d日 (E)", { locale: zhTW }) : ""}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  className="h-8 w-8 rounded-md flex items-center justify-center hover:bg-muted transition-colors"
                  onClick={() => { setRequirementsPanelOpen(false); setBatchSlot(null); }}
                  data-testid="button-close-panel"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {reqPanelVenueId && reqPanelDate && (() => {
                const cellSlots = slotsByVenueDate.get(`${reqPanelVenueId}-${reqPanelDate}`) || [];
                return cellSlots.length > 0 ? (
                  <>
                    {cellSlots.map((slot) => {
                      const venueDateShifts = shiftsByVenueDate.get(`${slot.venueId}-${slot.date}`) || [];
                      const assignedCount = venueDateShifts.filter((sh) => shiftOverlapsSlot(sh, slot)).length;
                      const shortage = slot.requiredCount - assignedCount;
                      const isFull = shortage <= 0;
                      const isRescue = slot.role === "救生";
                      const isGuard = slot.role === "守望";
                      const borderColor = isRescue ? "border-l-red-500" : isGuard ? "border-l-amber-500" : "border-l-blue-500";
                      return (
                        <div
                          key={slot.id}
                          className={`rounded-lg border-l-4 p-3 bg-muted/30 ${borderColor}`}
                          data-testid={`req-slot-${slot.id}`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                              <div className="text-xs text-muted-foreground flex items-center gap-1">
                                {isRescue ? <LifeBuoy className="h-3 w-3" /> : isGuard ? <LifeBuoy className="h-3 w-3" /> : <UserRound className="h-3 w-3" />}
                                {slot.role}
                                {(slot as any)._fromTemplate && (
                                  <span className="text-blue-500 text-[9px] border border-blue-400 dark:border-blue-700 rounded px-1 ml-1">範本</span>
                                )}
                              </div>
                              <div className="text-sm font-mono font-medium">
                                {slot.startTime.substring(0, 5)} - {slot.endTime.substring(0, 5)}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {isFull ? (
                                <span className="bg-green-500/20 text-green-600 dark:text-green-400 px-2 py-0.5 rounded-full text-xs font-bold border border-green-500/30">
                                  已滿
                                </span>
                              ) : (
                                <span className="bg-red-500/20 text-red-600 dark:text-red-400 px-2 py-0.5 rounded-full text-xs font-bold border border-red-500/30">
                                  缺 {shortage}
                                </span>
                              )}
                              <span className="text-xs text-muted-foreground">{slot.requiredCount}人</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 mt-2 pt-2 border-t border-border/50">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs px-2"
                              onClick={() => openEditSlotDialog(slot)}
                              data-testid={`button-edit-req-${slot.id}`}
                            >
                              <Edit2 className="h-3 w-3 mr-1" />
                              編輯
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs px-2"
                              onClick={() => {
                                setBatchSlot(batchSlot?.id === slot.id ? null : slot);
                                setBatchTargetDates(new Set());
                                setBatchTargetVenues(new Set());
                              }}
                              data-testid={`button-batch-req-${slot.id}`}
                            >
                              <Copy className="h-3 w-3 mr-1" />
                              套用
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs px-2 text-destructive hover:text-destructive"
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
                              <Trash2 className="h-3 w-3 mr-1" />
                              刪除
                            </Button>
                          </div>
                          {batchSlot?.id === slot.id && (
                            <div className="mt-3 pt-3 border-t border-border/50 space-y-3">
                              <div className="space-y-1.5">
                                <div className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                                  <Building2 className="h-3 w-3" />
                                  選擇目標場館：
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {venues.map((v) => {
                                    const isSource = v.id === slot.venueId;
                                    const isSelected = batchTargetVenues.has(v.id);
                                    return (
                                      <button
                                        key={v.id}
                                        type="button"
                                        className={`text-[10px] px-2 py-1 rounded-md border transition-all ${
                                          isSource
                                            ? "bg-primary/10 text-primary border-primary/30 font-bold"
                                            : isSelected
                                              ? "bg-blue-500 text-white border-blue-500 font-bold"
                                              : "bg-background border-border hover:bg-muted"
                                        }`}
                                        onClick={() => {
                                          if (isSource) return;
                                          const next = new Set(batchTargetVenues);
                                          if (next.has(v.id)) next.delete(v.id);
                                          else next.add(v.id);
                                          setBatchTargetVenues(next);
                                        }}
                                        data-testid={`batch-venue-${v.id}`}
                                      >
                                        {v.shortName}
                                        {isSource && " ✓"}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                              <div className="space-y-1.5">
                                <div className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                                  <CalendarDays className="h-3 w-3" />
                                  選擇目標日期：
                                </div>
                                <div className="grid grid-cols-7 gap-1">
                                  {monthDates.map((md) => {
                                    const mdStr = format(md, "yyyy-MM-dd");
                                    const isCurrent = mdStr === reqPanelDate && batchTargetVenues.size === 0;
                                    const isSelected = batchTargetDates.has(mdStr);
                                    const isWeekend = md.getDay() === 0 || md.getDay() === 6;
                                    return (
                                      <button
                                        key={mdStr}
                                        type="button"
                                        disabled={isCurrent}
                                        className={`text-[10px] py-1.5 rounded text-center transition-all ${
                                          isCurrent
                                            ? "bg-muted text-muted-foreground/40 cursor-not-allowed"
                                            : isSelected
                                              ? "bg-blue-500 text-white font-bold"
                                              : isWeekend
                                                ? "bg-muted/50 hover:bg-muted text-muted-foreground"
                                                : "bg-background hover:bg-muted border border-border/50"
                                        }`}
                                        onClick={() => {
                                          const next = new Set(batchTargetDates);
                                          if (next.has(mdStr)) next.delete(mdStr);
                                          else next.add(mdStr);
                                          setBatchTargetDates(next);
                                        }}
                                        data-testid={`batch-date-${mdStr}`}
                                      >
                                        {format(md, "d")}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="flex-1 h-8 text-xs"
                                  onClick={() => { setBatchSlot(null); setBatchTargetDates(new Set()); setBatchTargetVenues(new Set()); }}
                                >
                                  取消
                                </Button>
                                <Button
                                  size="sm"
                                  className="flex-1 h-8 text-xs"
                                  disabled={batchTargetDates.size === 0 || batchCopySlot.isPending}
                                  onClick={() => {
                                    const allVenueIds = [slot.venueId, ...Array.from(batchTargetVenues)];
                                    batchCopySlot.mutate({
                                      venueIds: allVenueIds,
                                      startTime: slot.startTime,
                                      endTime: slot.endTime,
                                      role: slot.role,
                                      requiredCount: slot.requiredCount,
                                      targetDates: Array.from(batchTargetDates),
                                    });
                                  }}
                                  data-testid="button-batch-confirm"
                                >
                                  {batchCopySlot.isPending ? "套用中..." : `確認套用 (${batchTargetVenues.size + 1}館 × ${batchTargetDates.size}日)`}
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                ) : (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    尚未設定需求
                  </div>
                );
              })()}
            </div>

            <div className="p-4 border-t">
              <button
                className="w-full py-2.5 border-2 border-dashed border-border rounded-lg text-muted-foreground hover:border-primary hover:text-primary transition-colors text-sm"
                onClick={() => {
                  if (reqPanelVenueId && reqPanelDate) {
                    openNewSlotDialog(reqPanelVenueId, reqPanelDate);
                  }
                }}
                data-testid="button-add-requirement"
              >
                <Plus className="h-3.5 w-3.5 inline mr-1" />
                新增需求時段
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
