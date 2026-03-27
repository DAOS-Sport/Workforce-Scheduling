import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval } from "date-fns";
import { zhTW } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
  Sparkles, ShieldCheck, Settings2, X, Copy, Building2, Users, Search, ArrowRightLeft,
  GraduationCap, Award, Briefcase, Monitor, Eye, Clipboard, ClipboardPaste, FileSpreadsheet,
  CheckCircle2, AlertTriangle
} from "lucide-react";
import { GoogleSheetsImportDialog } from "@/components/GoogleSheetsImportDialog";
import type { Venue, Shift, ScheduleSlot, Employee, VenueShiftTemplate, Region, DispatchShift } from "@shared/schema";
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragStartEvent, type DragEndEvent } from "@dnd-kit/core";
import { useDraggable, useDroppable } from "@dnd-kit/core";

interface ShiftClipboard {
  venueId: number;
  startTime: string;
  endTime: string;
  role: string;
  isDispatch: boolean;
  employeeId: number;
  sourceShiftId?: number;
}

const ROLE_ICON_MAP: Record<string, typeof LifeBuoy> = {
  "救生": LifeBuoy,
  "教練": GraduationCap,
  "指導員": Award,
  "PT": Dumbbell,
  "行政": Briefcase,
  "櫃台": UserRound,
  "櫃檯": UserRound,
  "資訊班": Monitor,
  "守望": Eye,
  "清潔": Sparkles,
  "管理": ShieldCheck,
};

const ROLE_SHORT: Record<string, string> = {
  "救生": "救",
  "教練": "教",
  "指導員": "指",
  "PT": "PT",
  "行政": "行",
  "櫃台": "櫃",
  "櫃檯": "櫃",
  "資訊班": "資",
  "守望": "望",
  "清潔": "潔",
  "管理": "管",
  "休假": "休",
  "特休": "特",
  "病假": "病",
  "事假": "事",
  "喪假": "喪",
  "公假": "公",
  "生理假": "生",
  "國定假": "國",
};

const ROLE_LABELS: Record<string, string> = {
  "救生": "救生",
  "教練": "教練",
  "指導員": "指導員",
  "PT": "PT",
  "行政": "行政",
  "櫃台": "櫃台",
  "資訊班": "資訊班",
  "守望": "守望",
};

const LEAVE_TYPES = ["休假", "特休", "病假", "事假", "喪假", "公假", "生理假", "國定假"];

const LEAVE_COLORS: Record<string, string> = {
  "休假": "bg-slate-100 dark:bg-slate-800/40 border border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400",
  "特休": "bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 text-green-600 dark:text-green-400",
  "病假": "bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-500 dark:text-red-400",
  "事假": "bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-400",
  "喪假": "bg-gray-100 dark:bg-gray-800/40 border border-gray-400 dark:border-gray-600 text-gray-600 dark:text-gray-400",
  "公假": "bg-cyan-50 dark:bg-cyan-950/30 border border-cyan-200 dark:border-cyan-800 text-cyan-600 dark:text-cyan-400",
  "生理假": "bg-pink-50 dark:bg-pink-950/30 border border-pink-200 dark:border-pink-800 text-pink-500 dark:text-pink-400",
  "國定假": "bg-red-100 dark:bg-red-950/50 border border-red-400 dark:border-red-700 text-red-700 dark:text-red-300",
};

interface RoleColorConfig { card: string; badge: string; dot: string; text: string; }
const ROLE_COLORS: Record<string, RoleColorConfig> = {
  "救生":  { card: "bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800",    badge: "bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300",    dot: "bg-blue-500",   text: "text-blue-700 dark:text-blue-300" },
  "守望":  { card: "bg-cyan-50 dark:bg-cyan-950/30 border border-cyan-200 dark:border-cyan-800",    badge: "bg-cyan-100 dark:bg-cyan-900/60 text-cyan-700 dark:text-cyan-300",    dot: "bg-cyan-500",   text: "text-cyan-700 dark:text-cyan-300" },
  "教練":  { card: "bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800", badge: "bg-violet-100 dark:bg-violet-900/60 text-violet-700 dark:text-violet-300", dot: "bg-violet-500", text: "text-violet-700 dark:text-violet-300" },
  "指導員":{ card: "bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800", badge: "bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300", dot: "bg-indigo-500", text: "text-indigo-700 dark:text-indigo-300" },
  "PT":    { card: "bg-pink-50 dark:bg-pink-950/30 border border-pink-200 dark:border-pink-800",    badge: "bg-pink-100 dark:bg-pink-900/60 text-pink-700 dark:text-pink-300",    dot: "bg-pink-500",   text: "text-pink-700 dark:text-pink-300" },
  "行政":  { card: "bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700", badge: "bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300", dot: "bg-slate-400",  text: "text-slate-600 dark:text-slate-300" },
  "櫃台":  { card: "bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800", badge: "bg-orange-100 dark:bg-orange-900/60 text-orange-700 dark:text-orange-300", dot: "bg-orange-500", text: "text-orange-700 dark:text-orange-300" },
  "櫃檯":  { card: "bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800", badge: "bg-orange-100 dark:bg-orange-900/60 text-orange-700 dark:text-orange-300", dot: "bg-orange-500", text: "text-orange-700 dark:text-orange-300" },
  "資訊班":{ card: "bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800",  badge: "bg-green-100 dark:bg-green-900/60 text-green-700 dark:text-green-300",  dot: "bg-green-500",  text: "text-green-700 dark:text-green-300" },
  "清潔":  { card: "bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800", badge: "bg-yellow-100 dark:bg-yellow-900/60 text-yellow-700 dark:text-yellow-300", dot: "bg-yellow-500", text: "text-yellow-700 dark:text-yellow-300" },
  "管理":  { card: "bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700",    badge: "bg-gray-100 dark:bg-gray-700/60 text-gray-600 dark:text-gray-300",    dot: "bg-gray-400",   text: "text-gray-600 dark:text-gray-300" },
};
const DISPATCH_ROLE_COLOR: RoleColorConfig = { card: "bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800", badge: "bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300", dot: "bg-purple-500", text: "text-purple-700 dark:text-purple-300" };
const DEFAULT_ROLE_COLOR: RoleColorConfig = ROLE_COLORS["救生"];
function getRoleColor(role: string, isDispatch = false): RoleColorConfig {
  if (isDispatch) return DISPATCH_ROLE_COLOR;
  return ROLE_COLORS[role] || DEFAULT_ROLE_COLOR;
}

const DAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];
const ROLE_OPTIONS = ["救生", "教練", "指導員", "PT", "行政", "櫃台", "資訊班", "守望"];

const TAIWAN_HOLIDAYS: Record<string, string> = {
  // 2024
  "2024-01-01": "元旦",
  "2024-02-08": "除夕",
  "2024-02-09": "春節",
  "2024-02-10": "春節",
  "2024-02-11": "春節",
  "2024-02-12": "春節",
  "2024-02-13": "春節補假",
  "2024-02-14": "春節補假",
  "2024-02-28": "和平紀念日",
  "2024-04-04": "兒童節",
  "2024-04-05": "清明節",
  "2024-05-01": "勞動節",
  "2024-06-10": "端午節",
  "2024-09-17": "中秋節",
  "2024-10-10": "國慶日",
  // 2025
  "2025-01-01": "元旦",
  "2025-01-23": "彈性放假",
  "2025-01-24": "彈性放假",
  "2025-01-27": "除夕",
  "2025-01-28": "春節",
  "2025-01-29": "春節",
  "2025-01-30": "春節",
  "2025-01-31": "春節",
  "2025-02-04": "春節補假",
  "2025-02-28": "和平紀念日",
  "2025-04-03": "兒童節補假",
  "2025-04-04": "兒童節清明",
  "2025-05-01": "勞動節",
  "2025-05-30": "彈性放假",
  "2025-05-31": "端午節",
  "2025-10-06": "中秋補假",
  "2025-10-07": "中秋節",
  "2025-10-10": "國慶日",
  // 2026
  "2026-01-01": "元旦",
  "2026-01-02": "彈性放假",
  "2026-02-16": "除夕",
  "2026-02-17": "春節",
  "2026-02-18": "春節",
  "2026-02-19": "春節",
  "2026-02-20": "春節",
  "2026-02-28": "和平紀念日",
  "2026-03-02": "和平紀念日補假",
  "2026-04-04": "兒童節",
  "2026-04-05": "清明節",
  "2026-04-06": "兒童節清明補假",
  "2026-05-01": "勞動節",
  "2026-06-19": "端午節",
  "2026-09-25": "中秋節",
  "2026-10-10": "國慶日",
};

function DraggableShiftCard({ id, children, isDragging }: { id: number; children: React.ReactNode; isDragging: boolean }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 50 } : undefined}
      className={isDragging ? "opacity-30" : ""}
    >
      {children}
    </div>
  );
}

function DroppableCell({ id, children, className, style, "data-testid": testId }: { id: string; children: React.ReactNode; className?: string; style?: React.CSSProperties; "data-testid"?: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <td
      ref={setNodeRef}
      className={`${className || ""} ${isOver ? "ring-2 ring-inset ring-primary/40" : ""}`}
      style={style}
      data-testid={testId}
    >
      {children}
    </td>
  );
}

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
  const [scheduleVisibleEmployeeIds, setScheduleVisibleEmployeeIds] = useState<Set<number>>(() => {
    try {
      const saved = localStorage.getItem(`schedule_visible_${activeRegion}`);
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const [empPickerOpen, setEmpPickerOpen] = useState(false);
  const [empPickerSearch, setEmpPickerSearch] = useState("");
  const [crossRegionEmployeeIds, setCrossRegionEmployeeIds] = useState<Set<number>>(() => {
    try {
      const saved = localStorage.getItem(`schedule_cross_${activeRegion}`);
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const [neiQinEmployeeIds, setNeiQinEmployeeIds] = useState<Set<number>>(new Set());
  const [crossRegionDialogOpen, setCrossRegionDialogOpen] = useState(false);
  const [crossRegionSearch, setCrossRegionSearch] = useState("");
  const [crossRegionTab, setCrossRegionTab] = useState("");

  const [requirementsPanelOpen, setRequirementsPanelOpen] = useState(false);
  const [reqPanelVenueId, setReqPanelVenueId] = useState<number | null>(null);
  const [reqPanelDate, setReqPanelDate] = useState<string>("");

  const [batchSlot, setBatchSlot] = useState<ScheduleSlot | null>(null);
  const [batchTargetDates, setBatchTargetDates] = useState<Set<string>>(new Set());
  const [batchTargetVenues, setBatchTargetVenues] = useState<Set<number>>(new Set());

  const [dispatchDialogOpen, setDispatchDialogOpen] = useState(false);
  const [editingDispatch, setEditingDispatch] = useState<DispatchShift | null>(null);
  const [dispatchName, setDispatchName] = useState("");
  const [dispatchDate, setDispatchDate] = useState("");
  const [dispatchVenueId, setDispatchVenueId] = useState<string>("");
  const [dispatchStartTime, setDispatchStartTime] = useState("06:30");
  const [dispatchEndTime, setDispatchEndTime] = useState("16:00");
  const [dispatchCompany, setDispatchCompany] = useState("");
  const [dispatchPhone, setDispatchPhone] = useState("");
  const [dispatchRole, setDispatchRole] = useState("救生");
  const [dispatchNotes, setDispatchNotes] = useState("");
  const [dispatchFromCell, setDispatchFromCell] = useState(false);
  const [dispatchLinkedEmployeeId, setDispatchLinkedEmployeeId] = useState<number | null>(null);
  const [dispatchBatchMode, setDispatchBatchMode] = useState(false);
  const [dispatchBatchDates, setDispatchBatchDates] = useState<Set<string>>(new Set());
  const [dispatchAddNameDialogOpen, setDispatchAddNameDialogOpen] = useState(false);
  const [dispatchAddNameInput, setDispatchAddNameInput] = useState("");
  const [dispatchSectionCollapsed, setDispatchSectionCollapsed] = useState(false);
  const [pendingDispatchNames, setPendingDispatchNames] = useState<string[]>([]);
  const [inlineDispatchInput, setInlineDispatchInput] = useState("");
  const inlineDispatchInputRef = useRef<HTMLInputElement>(null);
  const [customHighlightedDates, setCustomHighlightedDates] = useState<Set<string>>(new Set());

  const [shiftClipboard, setShiftClipboard] = useState<ShiftClipboard | null>(null);
  const [draggedShiftId, setDraggedShiftId] = useState<number | null>(null);
  const [colWidths, setColWidths] = useState<number[]>([]);
  const [colLeftWidth, setColLeftWidth] = useState(88);
  const resizingRef = useRef<{ index: number; startX: number; startWidth: number } | null>(null);
  const resizingLeftRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [dragConfirmTarget, setDragConfirmTarget] = useState<{ shiftId: number; targetDate: string; targetEmpId: number } | null>(null);
  const [sheetsImportOpen, setSheetsImportOpen] = useState(false);

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

  useEffect(() => {
    setColWidths(monthDates.map(() => COL_DATE_WIDTH));
  }, [monthDates.length]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (resizingLeftRef.current) {
        const { startX, startWidth } = resizingLeftRef.current;
        const newWidth = Math.max(60, startWidth + (e.clientX - startX));
        setColLeftWidth(newWidth);
      } else if (resizingRef.current) {
        const { index, startX, startWidth } = resizingRef.current;
        const newWidth = Math.max(52, startWidth + (e.clientX - startX));
        setColWidths(prev => { const next = [...prev]; next[index] = newWidth; return next; });
      }
    };
    const handleMouseUp = () => {
      resizingRef.current = null;
      resizingLeftRef.current = null;
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent, index: number) => {
    e.preventDefault();
    resizingRef.current = { index, startX: e.clientX, startWidth: colWidths[index] ?? COL_DATE_WIDTH };
  }, [colWidths]);

  const handleLeftResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingLeftRef.current = { startX: e.clientX, startWidth: colLeftWidth };
  }, [colLeftWidth]);

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

  const { data: regionsData = [] } = useQuery<Region[]>({
    queryKey: ["/api/regions"],
  });

  const regionCodeToId = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of regionsData) map.set(r.code, r.id);
    return map;
  }, [regionsData]);

  const crossRegionEmployees = useMemo(() =>
    allSystemEmployees.filter(e => (crossRegionEmployeeIds.has(e.id) || neiQinEmployeeIds.has(e.id)) && e.status !== "inactive"),
    [allSystemEmployees, crossRegionEmployeeIds, neiQinEmployeeIds]
  );

  const pickerEmployees = useMemo(() => {
    const regionEmpIds = new Set(employees.map(e => e.id));
    const extras = crossRegionEmployees.filter(e => !regionEmpIds.has(e.id));
    return [...employees, ...extras];
  }, [employees, crossRegionEmployees]);

  useEffect(() => {
    try {
      const savedVisible = localStorage.getItem(`schedule_visible_${activeRegion}`);
      setScheduleVisibleEmployeeIds(savedVisible ? new Set(JSON.parse(savedVisible)) : new Set());
      const savedCross = localStorage.getItem(`schedule_cross_${activeRegion}`);
      setCrossRegionEmployeeIds(savedCross ? new Set(JSON.parse(savedCross)) : new Set());
    } catch {
      setScheduleVisibleEmployeeIds(new Set());
      setCrossRegionEmployeeIds(new Set());
    }
  }, [activeRegion]);

  useEffect(() => {
    localStorage.setItem(`schedule_visible_${activeRegion}`, JSON.stringify([...scheduleVisibleEmployeeIds]));
  }, [scheduleVisibleEmployeeIds, activeRegion]);

  useEffect(() => {
    localStorage.setItem(`schedule_cross_${activeRegion}`, JSON.stringify([...crossRegionEmployeeIds]));
  }, [crossRegionEmployeeIds, activeRegion]);

  useEffect(() => {
    if (activeRegion === "D" || allSystemEmployees.length === 0 || regionsData.length === 0) {
      setNeiQinEmployeeIds(new Set());
      return;
    }
    const nqRegionId = regionCodeToId.get("D");
    if (!nqRegionId) return;
    const ids = new Set<number>();
    allSystemEmployees.forEach(e => {
      if (e.status !== "inactive" && (e.regionId === nqRegionId || e.department === "營運管理處")) ids.add(e.id);
    });
    setNeiQinEmployeeIds(ids);
    setScheduleVisibleEmployeeIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.add(id));
      return next;
    });
  }, [allSystemEmployees, activeRegion, regionsData, regionCodeToId]);

  const { data: scheduleSlots = [], isLoading: slotsLoading } = useQuery<ScheduleSlot[]>({
    queryKey: ["/api/schedule-slots", activeRegion, dateRange.start, dateRange.end],
  });

  const { data: shifts = [], isLoading: shiftsLoading } = useQuery<Shift[]>({
    queryKey: ["/api/shifts", activeRegion, dateRange.start, dateRange.end],
  });

  const { data: dispatchShiftsData = [] } = useQuery<DispatchShift[]>({
    queryKey: ["/api/dispatch-shifts", activeRegion, dateRange.start, dateRange.end],
  });

  const { data: customHighlightConfig } = useQuery<{ key: string; value: string | null }>({
    queryKey: ["/api/system-config/custom_highlighted_dates"],
  });

  useEffect(() => {
    if (!customHighlightConfig?.value) {
      setCustomHighlightedDates(new Set());
      return;
    }
    try {
      const parsed = JSON.parse(customHighlightConfig.value);
      if (Array.isArray(parsed)) setCustomHighlightedDates(new Set(parsed));
    } catch { setCustomHighlightedDates(new Set()); }
  }, [customHighlightConfig]);

  const saveCustomHighlightMutation = useMutation({
    mutationFn: async (dates: string[]) => {
      const res = await apiRequest("POST", "/api/system-config/custom_highlighted_dates", { value: JSON.stringify(dates) });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system-config/custom_highlighted_dates"] });
    },
  });

  const toggleCustomHighlight = (dateKey: string) => {
    setCustomHighlightedDates(prev => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      saveCustomHighlightMutation.mutate([...next]);
      return next;
    });
  };

  const dispatchShiftsByDate = useMemo(() => {
    const map = new Map<string, DispatchShift[]>();
    dispatchShiftsData.forEach((ds) => {
      const key = ds.date;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ds);
    });
    return map;
  }, [dispatchShiftsData]);

  const dispatchShiftsByVenueDate = useMemo(() => {
    const map = new Map<string, DispatchShift[]>();
    dispatchShiftsData.forEach((ds) => {
      if (!ds.venueId) return;
      const key = `${ds.venueId}-${ds.date}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ds);
    });
    return map;
  }, [dispatchShiftsData]);

  const dispatchNames = useMemo(() => {
    const names = new Set<string>();
    dispatchShiftsData.forEach(ds => names.add(ds.dispatchName));
    return Array.from(names).sort();
  }, [dispatchShiftsData]);

  useEffect(() => {
    if (pendingDispatchNames.length === 0) return;
    const realSet = new Set(dispatchNames);
    setPendingDispatchNames(prev => prev.filter(n => !realSet.has(n)));
  }, [dispatchNames]);

  useEffect(() => {
    if (empLoading) return;
    const regionEmpIds = new Set(employees.map(e => e.id));
    const shiftEmpIds = new Set(shifts.map(s => s.employeeId));
    const crossIds = new Set<number>();
    shiftEmpIds.forEach(id => {
      if (!regionEmpIds.has(id)) crossIds.add(id);
    });
    setCrossRegionEmployeeIds(prev => {
      const next = new Set(prev);
      regionEmpIds.forEach(id => next.delete(id));
      crossIds.forEach(id => next.add(id));
      return next;
    });
    if (shifts.length > 0) {
      setScheduleVisibleEmployeeIds(prev => {
        const next = new Set(prev);
        shiftEmpIds.forEach(id => next.add(id));
        return next;
      });
    }
  }, [shifts, employees, empLoading]);

  const empVenueMap = useMemo(() => {
    const map = new Map<number, Set<string>>();
    for (const s of shifts) {
      const v = venues.find(v => v.id === s.venueId);
      if (!v) continue;
      if (!map.has(s.employeeId)) map.set(s.employeeId, new Set());
      map.get(s.employeeId)!.add(v.shortName);
    }
    return map;
  }, [shifts, venues]);

  const { data: shiftVenueTemplates = [] } = useQuery<VenueShiftTemplate[]>({
    queryKey: ["/api/venue-shift-templates", shiftVenueId ? parseInt(shiftVenueId) : null],
    enabled: !!shiftVenueId && shiftDialogOpen,
  });

  const precheckParams = useMemo(() => {
    if (!shiftDialogOpen || !shiftDate || !shiftStartTime || !shiftEndTime || !shiftEmployeeId) return null;
    const LEAVE_TYPES = ["休假", "特休", "病假", "事假", "喪假", "公假", "生理假", "國定假"];
    if (LEAVE_TYPES.includes(shiftRole)) return null;
    return { employeeId: shiftEmployeeId, date: shiftDate, startTime: shiftStartTime, endTime: shiftEndTime, shiftIdToExclude: editingShift?.id || null };
  }, [shiftDialogOpen, shiftDate, shiftStartTime, shiftEndTime, shiftEmployeeId, shiftRole, editingShift]);

  const { data: fourWeekPrecheck } = useQuery<{ warnings: { type: string; message: string }[] }>({
    queryKey: ["/api/shifts/four-week-precheck", precheckParams],
    queryFn: async () => {
      if (!precheckParams) return { warnings: [] };
      const res = await apiRequest("POST", "/api/shifts/four-week-precheck", precheckParams);
      return res.json();
    },
    enabled: !!precheckParams,
  });
  const fourWeekDialogWarnings = fourWeekPrecheck?.warnings || [];

  const filteredTemplates = useMemo(() => {
    if (!shiftDate || shiftVenueTemplates.length === 0) return [];
    const dayOfWeek = new Date(shiftDate).getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const dayType = isWeekend ? "weekend" : "weekday";
    const matched = shiftVenueTemplates.filter(t => t.dayType === dayType);
    const seen = new Set<string>();
    return matched.filter(t => {
      const key = `${t.shiftLabel}-${t.startTime}-${t.endTime}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [shiftVenueTemplates, shiftDate, shiftRole]);

  const { data: allVenues = [] } = useQuery<Venue[]>({
    queryKey: ["/api/venues-all"],
  });

  const venueMap = useMemo(() => {
    const map = new Map<number, Venue>();
    allVenues.forEach((v) => map.set(v.id, v));
    venues.forEach((v) => map.set(v.id, v));
    return map;
  }, [venues, allVenues]);

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

  const dispatchOverlapsSlot = (ds: DispatchShift, slot: ScheduleSlot) => {
    if (!ds.startTime || !ds.endTime) return false;
    const shStart = timeToMin(ds.startTime);
    const shEnd = timeToMin(ds.endTime);
    const slStart = timeToMin(slot.startTime);
    const slEnd = timeToMin(slot.endTime);
    const overlapStart = Math.max(shStart, slStart);
    const overlapEnd = Math.min(shEnd, slEnd);
    const overlap = overlapEnd - overlapStart;
    const slotDuration = slEnd - slStart;
    return slotDuration > 0 && overlap >= slotDuration * 0.5;
  };

  const venueDateShortage = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    scheduleSlots.forEach((slot) => {
      const key = `${slot.venueId}-${slot.date}`;
      const venueDateShifts = shiftsByVenueDate.get(key) || [];
      const dispatchForKey = dispatchShiftsByVenueDate.get(key) || [];
      const assignedCount =
        venueDateShifts.filter((sh) => shiftOverlapsSlot(sh, slot)).length +
        dispatchForKey.filter((ds) => dispatchOverlapsSlot(ds, slot)).length;
      const shortage = slot.requiredCount - assignedCount;
      if (shortage > 0) {
        if (!map.has(key)) map.set(key, new Map());
        const roleMap = map.get(key)!;
        roleMap.set(slot.role, (roleMap.get(slot.role) || 0) + shortage);
      }
    });
    return map;
  }, [scheduleSlots, shiftsByVenueDate, dispatchShiftsByVenueDate]);

  const gapAnalysis = useMemo(() => {
    const gaps: { venueId: number; venueName: string; date: string; startTime: string; endTime: string; role: string; required: number; assigned: number; shortage: number }[] = [];
    let totalShortage = 0;
    scheduleSlots.forEach((slot) => {
      const venue = venues.find((v) => v.id === slot.venueId);
      const key = `${slot.venueId}-${slot.date}`;
      const venueDateShifts = shiftsByVenueDate.get(key) || [];
      const dispatchForKey = dispatchShiftsByVenueDate.get(key) || [];
      const assignedCount =
        venueDateShifts.filter((sh) => shiftOverlapsSlot(sh, slot)).length +
        dispatchForKey.filter((ds) => dispatchOverlapsSlot(ds, slot)).length;
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
  }, [scheduleSlots, shiftsByVenueDate, dispatchShiftsByVenueDate, venues]);

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
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      if (result?.warnings && result.warnings.length > 0) {
        const warnMsgs = result.warnings.map((w: any) => w.message).join("\n");
        toast({ title: "班次已新增（有警告）", description: warnMsgs, variant: "destructive" });
      } else {
        toast({ title: "班次已新增" });
      }
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
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      if (result?.warnings && result.warnings.length > 0) {
        const warnMsgs = result.warnings.map((w: any) => w.message).join("\n");
        toast({ title: "班次已更新（有警告）", description: warnMsgs, variant: "destructive" });
      } else {
        toast({ title: "班次已更新" });
      }
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
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      toast({ title: "班次已刪除" });
    },
  });

  interface DispatchShiftPayload {
    regionCode: string;
    venueId: number | null;
    date: string;
    startTime: string;
    endTime: string;
    dispatchName: string;
    dispatchCompany: string | null;
    dispatchPhone: string | null;
    role: string;
    notes: string | null;
    linkedEmployeeId?: number | null;
  }

  const createDispatchShift = useMutation<unknown, Error, DispatchShiftPayload>({
    mutationFn: async (data) => {
      const res = await apiRequest("POST", "/api/dispatch-shifts", data);
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch-shifts"] });
      const currentMonthStr = format(currentMonth, "yyyy-MM");
      const savedDate = variables.date;
      if (savedDate && !savedDate.startsWith(currentMonthStr)) {
        const [y, m] = savedDate.split("-");
        toast({ title: "派遣班次已儲存", description: `日期在 ${y} 年 ${m} 月，請切換月份查看` });
      } else {
        toast({ title: "派遣班次已新增" });
      }
      setDispatchDialogOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "新增失敗", description: err.message, variant: "destructive" });
    },
  });

  const updateDispatchShift = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const res = await apiRequest("PATCH", `/api/dispatch-shifts/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch-shifts"] });
      toast({ title: "派遣班次已更新" });
      setDispatchDialogOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "更新失敗", description: err.message, variant: "destructive" });
    },
  });

  const deleteDispatchShift = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/dispatch-shifts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch-shifts"] });
      toast({ title: "派遣班次已刪除" });
      setDispatchDialogOpen(false);
    },
  });

  const batchCreateDispatchShifts = useMutation({
    mutationFn: async (data: { regionCode: string; dates: string[]; venueId: number | null; startTime: string; endTime: string; dispatchName: string; dispatchCompany: string | null; dispatchPhone: string | null; role: string; notes: string | null; linkedEmployeeId: number | null }) => {
      const res = await apiRequest("POST", "/api/dispatch-shifts/batch-create", data);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch-shifts"] });
      toast({ title: `已新增 ${data.created} 筆派遣班次` });
      setDispatchDialogOpen(false);
      setDispatchBatchDates(new Set());
      setDispatchBatchMode(false);
    },
    onError: (err: Error) => {
      toast({ title: "批次新增失敗", description: err.message, variant: "destructive" });
    },
  });

  const batchDeleteShifts = useMutation({
    mutationFn: async (data: { employeeId: number; venueId?: number; startTime?: string; endTime?: string; role?: string; targetDates: string[] }) => {
      const res = await apiRequest("POST", "/api/shifts/batch-delete", data);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      const msg = `已新增 ${data.created} 筆班次`;
      const errMsg = data.errors?.length > 0 ? `（${data.errors.length} 筆因勞基法限制略過）` : "";
      if (data.warnings?.length > 0) {
        toast({ title: msg + errMsg + "（有警告）", description: data.warnings.join("\n"), variant: "destructive" });
      } else {
        toast({ title: msg + errMsg });
      }
      setShiftBatchDates(new Set());
      setShiftBatchMode(false);
    },
    onError: (err: Error) => {
      toast({ title: "批次新增失敗", description: err.message, variant: "destructive" });
    },
  });

  const batchUpdateShifts = useMutation({
    mutationFn: async (data: {
      currentShiftId: number;
      employeeId: number;
      targetDates: string[];
      venueId: string;
      startTime: string;
      endTime: string;
      role: string;
      isDispatch: boolean;
      matchVenueId: number;
      matchStartTime: string;
      matchEndTime: string;
      matchRole: string;
    }) => {
      const res = await apiRequest("POST", "/api/shifts/batch-update", data);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      const errMsg = data.errors?.length > 0 ? `（${data.errors.length} 天因排班規則已略過）` : "";
      if (data.warnings?.length > 0) {
        toast({ title: `已更新 ${data.updated} 筆班次` + errMsg, description: data.warnings.join("\n"), variant: data.errors?.length > 0 ? "destructive" : "default" });
      } else if (data.errors?.length > 0) {
        toast({ title: `已更新 ${data.updated} 筆班次` + errMsg, description: data.errors.join("\n"), variant: "destructive" });
      } else {
        toast({ title: `已更新 ${data.updated} 筆班次` });
      }
      setShiftBatchDates(new Set());
      setShiftBatchMode(false);
    },
    onError: (err: Error) => {
      toast({ title: "批次更新失敗", description: err.message, variant: "destructive" });
    },
  });

  const copyFromPrevious = useMutation({
    mutationFn: async (data: { regionCode: string; targetYear: number; targetMonth: number }) => {
      const res = await apiRequest("POST", "/api/shifts/copy-from-previous", data);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      toast({ title: data.message || `已複製 ${data.created} 筆班表` });
    },
    onError: (err: Error) => {
      toast({ title: "複製失敗", description: err.message, variant: "destructive" });
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

  const openNewDispatchDialog = (dateStr: string, prefillName?: string, fromCell = false) => {
    setEditingDispatch(null);
    setDispatchFromCell(fromCell);
    setDispatchDate(dateStr);
    setDispatchName(prefillName || "");
    setDispatchVenueId(venues.length > 0 ? venues[0].id.toString() : "");
    setDispatchStartTime("06:30");
    setDispatchEndTime("16:00");
    setDispatchCompany("");
    setDispatchPhone("");
    setDispatchRole("救生");
    setDispatchNotes("");
    setDispatchLinkedEmployeeId(null);
    setDispatchBatchMode(false);
    setDispatchBatchDates(new Set());
    setDispatchDialogOpen(true);
  };

  const openEditDispatchDialog = (ds: DispatchShift) => {
    setEditingDispatch(ds);
    setDispatchFromCell(false);
    setDispatchDate(ds.date);
    setDispatchName(ds.dispatchName);
    setDispatchVenueId(ds.venueId?.toString() || "");
    setDispatchStartTime(ds.startTime.substring(0, 5));
    setDispatchEndTime(ds.endTime.substring(0, 5));
    setDispatchCompany(ds.dispatchCompany || "");
    setDispatchPhone(ds.dispatchPhone || "");
    setDispatchRole(ds.role || "救生");
    setDispatchNotes(ds.notes || "");
    setDispatchLinkedEmployeeId(ds.linkedEmployeeId || null);
    setDispatchBatchMode(false);
    setDispatchBatchDates(new Set());
    setDispatchDialogOpen(true);
  };

  const handleSaveDispatch = () => {
    if (!dispatchName || !dispatchStartTime || !dispatchEndTime) return;
    const basePayload = {
      regionCode: activeRegion,
      venueId: dispatchVenueId ? parseInt(dispatchVenueId) : null,
      startTime: dispatchStartTime,
      endTime: dispatchEndTime,
      dispatchName: dispatchName,
      dispatchCompany: dispatchCompany || null,
      dispatchPhone: dispatchPhone || null,
      role: dispatchRole,
      notes: dispatchNotes || null,
      linkedEmployeeId: dispatchLinkedEmployeeId,
    };
    if (editingDispatch) {
      updateDispatchShift.mutate({ id: editingDispatch.id, date: dispatchDate, ...basePayload });
    } else if (dispatchBatchMode && dispatchBatchDates.size > 0) {
      batchCreateDispatchShifts.mutate({ ...basePayload, dates: [...dispatchBatchDates] });
    } else {
      if (!dispatchDate) return;
      createDispatchShift.mutate({ ...basePayload, date: dispatchDate });
    }
  };

  const openNewShiftDialog = (employeeId: number, dateStr: string) => {
    const emp = employees.find((e) => e.id === employeeId);
    setShiftEmployeeId(employeeId);
    setShiftDate(dateStr);
    setEditingShift(null);
    setShiftVenueId(venues.length > 0 ? venues[0].id.toString() : "");
    setShiftStartTime("06:30");
    setShiftEndTime("16:00");
    setShiftIsDispatch(false);
    setShiftRole(emp?.role && ROLE_OPTIONS.includes(emp.role) ? emp.role : "救生");
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
    const isLeave = LEAVE_TYPES.includes(shiftRole);
    const effectiveVenueId = isLeave ? (shiftVenueId || "1") : shiftVenueId;
    const effectiveStart = isLeave ? "00:00" : shiftStartTime;
    const effectiveEnd = isLeave ? "00:00" : shiftEndTime;

    if (!shiftDate) return;
    if (!isLeave && (!effectiveVenueId || !shiftStartTime || !shiftEndTime)) return;

    if (editingShift) {
      if (shiftBatchMode && shiftBatchDates.size > 0) {
        batchUpdateShifts.mutate({
          currentShiftId: editingShift.id,
          employeeId: shiftEmployeeId!,
          targetDates: Array.from(shiftBatchDates),
          venueId: effectiveVenueId,
          startTime: effectiveStart,
          endTime: effectiveEnd,
          role: shiftRole,
          isDispatch: isLeave ? false : shiftIsDispatch,
          matchVenueId: editingShift.venueId,
          matchStartTime: editingShift.startTime.substring(0, 5),
          matchEndTime: editingShift.endTime.substring(0, 5),
          matchRole: editingShift.role,
        });
      } else {
        updateShift.mutate({
          id: editingShift.id,
          employeeId: shiftEmployeeId!,
          venueId: parseInt(effectiveVenueId),
          date: shiftDate,
          startTime: effectiveStart,
          endTime: effectiveEnd,
          role: shiftRole,
          isDispatch: isLeave ? false : shiftIsDispatch,
        });
      }
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
        const isCrossRegion = crossRegionEmployeeIds.has(empId);
        const dispatch = isLeave ? false : (shiftIsDispatch || isCrossRegion);
        if (allDates.length > 1) {
          batchCreateShifts.mutate({
            employeeId: empId,
            venueId: effectiveVenueId,
            startTime: effectiveStart,
            endTime: effectiveEnd,
            role: shiftRole,
            isDispatch: dispatch,
            targetDates: allDates,
          });
        } else {
          createShift.mutate({
            employeeId: empId,
            venueId: parseInt(effectiveVenueId),
            date: shiftDate,
            startTime: effectiveStart,
            endTime: effectiveEnd,
            role: shiftRole,
            isDispatch: dispatch,
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

  const COL_DATE_WIDTH = 76;
  const COL_LEFT_WIDTH = colLeftWidth;

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const id = Number(event.active.id);
    if (!isNaN(id)) setDraggedShiftId(id);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setDraggedShiftId(null);
    const shiftId = Number(event.active.id);
    if (!event.over || isNaN(shiftId)) return;
    const overId = String(event.over.id);
    const match = overId.match(/^drop-(\d+)-(.+)$/);
    if (!match) return;
    const targetEmpId = Number(match[1]);
    const targetDate = match[2];
    const draggedShift = shifts.find(s => s.id === shiftId);
    if (!draggedShift) return;
    if (draggedShift.employeeId !== targetEmpId) {
      toast({ title: "不支援跨員工移動", description: "只能在同一員工的日期之間移動班卡", variant: "destructive" });
      return;
    }
    if (draggedShift.date === targetDate) return;
    const existingOnTarget = shiftsByEmployeeDate.get(`${targetEmpId}-${targetDate}`) || [];
    if (existingOnTarget.length > 0) {
      setDragConfirmTarget({ shiftId, targetDate, targetEmpId });
    } else {
      updateShift.mutate({ id: shiftId, date: targetDate, venueId: draggedShift.venueId, startTime: draggedShift.startTime, endTime: draggedShift.endTime, role: draggedShift.role, isDispatch: draggedShift.isDispatch || false });
    }
  }, [shifts, shiftsByEmployeeDate, updateShift, toast]);

  const handleCopyShift = useCallback((shift: Shift) => {
    setShiftClipboard({
      venueId: shift.venueId,
      startTime: shift.startTime,
      endTime: shift.endTime,
      role: shift.role,
      isDispatch: shift.isDispatch || false,
      employeeId: shift.employeeId,
      sourceShiftId: shift.id,
    });
    toast({ title: "已複製班卡", description: `${shift.startTime.substring(0,5)}-${shift.endTime.substring(0,5)} [${shift.role}]` });
  }, [toast]);

  const handlePasteShift = useCallback((targetEmpId: number, targetDate: string) => {
    if (!shiftClipboard) return;
    if (shiftClipboard.employeeId !== targetEmpId) {
      toast({ title: "不支援跨員工貼上", description: "只能將班卡貼至同一員工的其他日期", variant: "destructive" });
      return;
    }
    const existingShifts = shiftsByEmployeeDate.get(`${targetEmpId}-${targetDate}`) || [];
    if (existingShifts.length > 0) {
      updateShift.mutate({ id: existingShifts[0].id, venueId: shiftClipboard.venueId, startTime: shiftClipboard.startTime, endTime: shiftClipboard.endTime, role: shiftClipboard.role, isDispatch: shiftClipboard.isDispatch });
    } else {
      createShift.mutate({ employeeId: targetEmpId, venueId: shiftClipboard.venueId, date: targetDate, startTime: shiftClipboard.startTime, endTime: shiftClipboard.endTime, role: shiftClipboard.role, isDispatch: shiftClipboard.isDispatch });
    }
  }, [shiftClipboard, shiftsByEmployeeDate, updateShift, createShift, toast]);

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
      <div className="sticky top-0 z-50 bg-background border-b border-border/50 flex items-center gap-2 px-4 py-2 flex-wrap">
        <div className="flex items-center gap-2 shrink-0">
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
        </div>
        <div className="flex-1 flex justify-center">
          <RegionTabs />
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

          {shiftClipboard && (
            <button
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors shrink-0"
              onClick={() => setShiftClipboard(null)}
              title="清除剪貼簿"
              data-testid="button-clear-clipboard"
            >
              <Clipboard className="h-3 w-3" />
              已複製 [{shiftClipboard.role}] {shiftClipboard.startTime.substring(0,5)}-{shiftClipboard.endTime.substring(0,5)}
              <X className="h-2.5 w-2.5 opacity-60" />
            </button>
          )}

          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5 shrink-0"
            onClick={() => setSheetsImportOpen(true)}
            data-testid="button-sheets-import"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            匯入班表
          </Button>

          <Popover open={empPickerOpen} onOpenChange={setEmpPickerOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={`h-7 text-xs gap-1.5 shrink-0 ${shortageDates.length === 0 && !shiftClipboard ? "ml-auto" : ""}`} data-testid="button-employee-picker">
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
              <div className="px-2 py-1.5 border-b">
                <input
                  type="text"
                  placeholder="輸入姓名搜尋..."
                  value={empPickerSearch}
                  onChange={(e) => setEmpPickerSearch(e.target.value)}
                  className="w-full h-7 px-2 text-xs rounded border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  autoFocus
                  data-testid="input-employee-picker-search"
                />
              </div>
              <div className="max-h-[350px] overflow-auto p-1">
                {(() => {
                  const searchTerm = empPickerSearch.trim().toLowerCase();
                  const filteredPickerEmployees = searchTerm
                    ? pickerEmployees.filter(e => e.name.toLowerCase().includes(searchTerm))
                    : pickerEmployees;

                  if (searchTerm && filteredPickerEmployees.length === 0) {
                    return <div className="px-3 py-4 text-xs text-muted-foreground text-center">找不到符合的人員</div>;
                  }

                  if (searchTerm) {
                    return (
                      <div>
                        {filteredPickerEmployees.map(emp => (
                          <button
                            key={emp.id}
                            type="button"
                            className="w-full flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-muted rounded-sm"
                            onClick={() => {
                              const next = new Set(scheduleVisibleEmployeeIds);
                              if (next.has(emp.id)) next.delete(emp.id);
                              else next.add(emp.id);
                              setScheduleVisibleEmployeeIds(next);
                            }}
                            data-testid={`picker-emp-${emp.id}`}
                          >
                            <Checkbox checked={scheduleVisibleEmployeeIds.has(emp.id)} className="h-3.5 w-3.5" />
                            <span className="text-foreground flex-1 text-left">{emp.name}</span>
                            {neiQinEmployeeIds.has(emp.id) ? (
                              <span className="text-[9px] px-1 py-0 rounded bg-blue-500/15 text-blue-500 leading-4 shrink-0">內勤</span>
                            ) : crossRegionEmployeeIds.has(emp.id) && (
                              <span className="text-[9px] px-1 py-0 rounded bg-orange-500/15 text-orange-500 leading-4 shrink-0">支援</span>
                            )}
                          </button>
                        ))}
                      </div>
                    );
                  }

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
                  return groups.map(group => {
                    const groupEmps = pickerEmployees.filter(e => group.filter(e) && !neiQinEmployeeIds.has(e.id));
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
                            <span className="text-foreground flex-1 text-left">{emp.name}</span>
                            {neiQinEmployeeIds.has(emp.id) ? (
                              <span className="text-[9px] px-1 py-0 rounded bg-blue-500/15 text-blue-500 leading-4 shrink-0">內勤</span>
                            ) : crossRegionEmployeeIds.has(emp.id) && (
                              <span className="text-[9px] px-1 py-0 rounded bg-orange-500/15 text-orange-500 leading-4 shrink-0">支援</span>
                            )}
                            {empVenueMap.has(emp.id) && (
                              <span className="flex gap-0.5 flex-wrap justify-end">
                                {[...empVenueMap.get(emp.id)!].map(vn => (
                                  <span key={vn} className="text-[9px] px-1 py-0 rounded bg-primary/10 text-primary leading-4">{vn}</span>
                                ))}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    );
                  });
                })()}
                {neiQinEmployeeIds.size > 0 && (() => {
                  const nqEmps = pickerEmployees.filter(e => neiQinEmployeeIds.has(e.id));
                  if (nqEmps.length === 0) return null;
                  const allSelected = nqEmps.every(e => scheduleVisibleEmployeeIds.has(e.id));
                  const someSelected = nqEmps.some(e => scheduleVisibleEmployeeIds.has(e.id));
                  return (
                    <div className="mb-0.5">
                      <button type="button"
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-muted rounded-sm"
                        onClick={() => {
                          const next = new Set(scheduleVisibleEmployeeIds);
                          if (allSelected) nqEmps.forEach(e => next.delete(e.id));
                          else nqEmps.forEach(e => next.add(e.id));
                          setScheduleVisibleEmployeeIds(next);
                        }}
                        data-testid="picker-group-neiqin"
                      >
                        <Checkbox checked={allSelected ? true : someSelected ? "indeterminate" : false} className="h-3.5 w-3.5" />
                        內勤人員 ({nqEmps.length})
                      </button>
                      {nqEmps.map(emp => (
                        <button key={emp.id} type="button"
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
                          <span className="text-foreground flex-1 text-left">{emp.name}</span>
                          <span className="text-[9px] px-1 py-0 rounded bg-blue-500/15 text-blue-500 leading-4 shrink-0">{emp.role || "內勤"}</span>
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
              <div className="border-t px-3 py-2">
                <button
                  className="w-full flex items-center justify-center gap-1.5 text-xs text-orange-500 hover:text-orange-400 py-1"
                  onClick={() => {
                    setEmpPickerOpen(false);
                    setEmpPickerSearch("");
                    const otherRegions = regionsData.filter(r => r.code !== activeRegion);
                    setCrossRegionTab(otherRegions[0]?.code || "");
                    setCrossRegionSearch("");
                    setCrossRegionDialogOpen(true);
                  }}
                  data-testid="button-cross-region"
                >
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                  跨區支援
                </button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col relative">
        {shifts.length === 0 && !shiftsLoading && (
          <div className="mx-2 mb-2 rounded-lg border border-dashed border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20 p-3 flex items-center justify-between gap-3">
            <div className="text-sm text-amber-800 dark:text-amber-200 flex items-center gap-2">
              <Copy className="h-4 w-4 shrink-0" />
              <span>本月尚無排班，是否從上個月複製班表？</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40"
              disabled={copyFromPrevious.isPending}
              onClick={() => {
                const targetYear = currentMonth.getFullYear();
                const targetMonth = currentMonth.getMonth() + 1;
                copyFromPrevious.mutate({ regionCode: activeRegion, targetYear, targetMonth });
              }}
              data-testid="button-copy-previous-month"
            >
              {copyFromPrevious.isPending ? "複製中..." : "從上月複製"}
            </Button>
          </div>
        )}
        <div className="flex-1 overflow-auto" ref={scrollRef}>
          <DndContext sensors={dndSensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <table className="border-separate border-spacing-0 text-sm" style={{ minWidth: `${COL_LEFT_WIDTH + (colWidths.length === monthDates.length ? colWidths.reduce((a, w) => a + w, 0) : monthDates.length * COL_DATE_WIDTH)}px` }}>
            <thead>
              <tr>
                <th
                  className="text-left px-1.5 py-1 border-b border-r font-medium text-muted-foreground bg-background text-xs relative select-none"
                  style={{ minWidth: COL_LEFT_WIDTH, width: COL_LEFT_WIDTH, position: "sticky", top: 0, left: 0, zIndex: 35 }}
                >
                  員工/場館
                  <div
                    className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/40 transition-colors z-10"
                    onMouseDown={handleLeftResizeMouseDown}
                  />
                </th>
                {monthDates.map((d, i) => {
                  const dateKey = format(d, "yyyy-MM-dd");
                  const isToday = dateKey === format(new Date(), "yyyy-MM-dd");
                  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                  const holiday = TAIWAN_HOLIDAYS[dateKey];
                  const isCustomHighlight = customHighlightedDates.has(dateKey);
                  const colW = colWidths[i] ?? COL_DATE_WIDTH;
                  const headerBg = isCustomHighlight
                    ? (holiday ? "bg-orange-100 dark:bg-orange-900/30 ring-1 ring-inset ring-yellow-400/60 dark:ring-yellow-600/40" : "bg-orange-100 dark:bg-orange-900/30")
                    : holiday ? "bg-yellow-100 dark:bg-yellow-900/30"
                    : isToday ? "bg-background"
                    : isWeekend ? "bg-yellow-100 dark:bg-yellow-900/30" : "bg-background";
                  return (
                    <th
                      key={i}
                      data-date-col={dateKey}
                      className={`text-center p-1.5 border-b border-r font-medium relative select-none ${headerBg}`}
                      style={{ minWidth: colW, width: colW, position: "sticky", top: 0, zIndex: 25 }}
                      data-testid={`date-header-${dateKey}`}
                    >
                      <div className={`text-xs ${isCustomHighlight ? "text-orange-700 dark:text-orange-400" : isWeekend || holiday ? "text-destructive/70" : "text-muted-foreground"}`}>
                        週{DAY_NAMES[d.getDay()]}
                      </div>
                      <div className={`text-xs ${isToday ? "text-primary font-semibold" : ""}`}>
                        {format(d, "M/d")}
                      </div>
                      {holiday && (
                        <div className="text-[9px] leading-tight text-red-500 dark:text-red-400 font-medium truncate mt-0.5" title={holiday}>
                          {holiday}
                        </div>
                      )}
                      <button
                        className={`mt-0.5 text-[9px] leading-none transition-colors ${isCustomHighlight ? "text-orange-500 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-200" : "text-muted-foreground/30 hover:text-orange-400"}`}
                        onClick={() => toggleCustomHighlight(dateKey)}
                        title={isCustomHighlight ? "取消橘色標記" : "標記為特殊日期"}
                        data-testid={`button-highlight-${dateKey}`}
                      >
                        {isCustomHighlight ? "★" : "☆"}
                      </button>
                      <div
                        className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/40 transition-colors z-10"
                        onMouseDown={(e) => { e.stopPropagation(); handleResizeMouseDown(e, i); }}
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={`skel-${i}`}>
                    <td className="p-2 border-b border-r sticky left-0 bg-background z-[5]" style={{ minWidth: COL_LEFT_WIDTH, width: COL_LEFT_WIDTH, maxWidth: COL_LEFT_WIDTH }}>
                      <Skeleton className="h-5 w-20" />
                    </td>
                    {Array.from({ length: Math.min(monthDates.length, 10) }).map((_, j) => (
                      <td key={j} className="p-1 border-b border-r" style={{ minWidth: colWidths[j] ?? COL_DATE_WIDTH }}>
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
                        className="px-1.5 py-1 border-b border-r text-left sticky left-0 z-[5]"
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
                            style={{ minWidth: colWidths[di] ?? COL_DATE_WIDTH, width: colWidths[di] ?? COL_DATE_WIDTH, maxWidth: colWidths[di] ?? COL_DATE_WIDTH, backgroundColor: cellBg }}
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
                          className="px-1.5 py-0.5 border-b border-r sticky left-0 bg-muted z-[5] text-xs font-bold text-muted-foreground tracking-wide"
                          style={{ minWidth: COL_LEFT_WIDTH, width: COL_LEFT_WIDTH, maxWidth: COL_LEFT_WIDTH }}
                        >
                          {label} ({grouped.length})
                        </td>
                        {monthDates.map((_, di) => (
                          <td key={di} className="border-b border-r bg-muted" style={{ minWidth: colWidths[di] ?? COL_DATE_WIDTH }} />
                        ))}
                      </tr>,
                      ...grouped.map((emp) => (
                  <tr key={emp.id} className="group" data-testid={`row-employee-${emp.id}`}>
                    <td
                      className="px-1.5 py-1 border-b border-r sticky left-0 bg-background z-[5] overflow-hidden"
                      style={{ minWidth: COL_LEFT_WIDTH, width: COL_LEFT_WIDTH, maxWidth: COL_LEFT_WIDTH }}
                    >
                      <div className="flex items-center gap-1">
                        {emp.role && ROLE_ICON_MAP[emp.role] && (() => {
                          const Icon = ROLE_ICON_MAP[emp.role!];
                          return <Icon className="h-3 w-3 text-muted-foreground shrink-0" />;
                        })()}
                        <span className="font-medium text-xs truncate" data-testid={`text-employee-name-${emp.id}`}>
                          {emp.name}
                        </span>
                        {neiQinEmployeeIds.has(emp.id) ? (
                          <span className="text-[9px] px-1 py-0 rounded bg-blue-500/15 text-blue-500 leading-4 shrink-0">內勤</span>
                        ) : crossRegionEmployeeIds.has(emp.id) && (
                          <span className="text-[9px] px-1 py-0 rounded bg-orange-500/15 text-orange-500 leading-4 shrink-0">支援</span>
                        )}
                      </div>
                    </td>
                    {monthDates.map((d, di) => {
                      const dateStr = format(d, "yyyy-MM-dd");
                      const cellShifts = shiftsByEmployeeDate.get(`${emp.id}-${dateStr}`) || [];
                      const isToday = dateStr === format(new Date(), "yyyy-MM-dd");
                      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                      const isHoliday = !!TAIWAN_HOLIDAYS[dateStr];
                      const isCellCustom = customHighlightedDates.has(dateStr);
                      const dropId = `drop-${emp.id}-${dateStr}`;
                      const canPaste = !!shiftClipboard && shiftClipboard.employeeId === emp.id;

                      return (
                        <DroppableCell key={di} id={dropId} className={`p-0.5 border-b border-r relative align-top ${
                          isCellCustom ? "bg-orange-50 dark:bg-orange-950/20 border-b-orange-300 dark:border-b-orange-700" :
                          isToday ? "bg-primary/5" : isHoliday ? "bg-yellow-100/60 dark:bg-yellow-900/20" : isWeekend ? "bg-yellow-100/60 dark:bg-yellow-900/20" : ""
                        }`} style={{ minWidth: colWidths[di] ?? COL_DATE_WIDTH, width: colWidths[di] ?? COL_DATE_WIDTH }} data-testid={`cell-${emp.id}-${dateStr}`}>
                          {cellShifts.length > 0 ? (
                            <div className="space-y-0.5">
                              {cellShifts.map((shift) => {
                                const venue = venueMap.get(shift.venueId);
                                const shiftDateStr = format(d, "yyyy-MM-dd");
                                const slots = slotsByVenueDate.get(`${shift.venueId}-${shiftDateStr}`) || [];
                                const sStart = shift.startTime.substring(0, 5);
                                const sEnd = shift.endTime.substring(0, 5);
                                const isLeave = LEAVE_TYPES.includes(shift.role);
                                const matchedSlot = slots.find(sl => sl.startTime.substring(0, 5) <= sStart && sl.endTime.substring(0, 5) >= sEnd) 
                                  || slots.find(sl => sl.startTime.substring(0, 5) <= sStart && sStart < sl.endTime.substring(0, 5));
                                const shiftRole = isLeave ? shift.role : (shift.role || matchedSlot?.role || ROLE_LABELS[emp.role] || emp.role);
                                const roleShort = ROLE_SHORT[shiftRole] || shiftRole.slice(0, 1);
                                const roleColor = isLeave
                                  ? null
                                  : getRoleColor(shiftRole, shift.isDispatch ?? false);
                                const cardColor = isLeave
                                  ? (LEAVE_COLORS[shift.role] || LEAVE_COLORS["休假"])
                                  : roleColor!.card;
                                const isDragging = draggedShiftId === shift.id;

                                if (isLeave) {
                                  return (
                                    <DraggableShiftCard key={shift.id} id={shift.id} isDragging={isDragging}>
                                      <div
                                        className={`rounded-md px-1.5 py-1 text-[10px] cursor-pointer transition-all hover:shadow-sm ${cardColor} ${isDragging ? "opacity-30" : ""}`}
                                        onClick={() => openEditShiftDialog(shift)}
                                        data-testid={`shift-${shift.id}`}
                                      >
                                        <div className="flex items-center justify-between gap-0.5">
                                          <span className="font-semibold leading-tight truncate">{shift.role}</span>
                                          <button
                                            className="shrink-0 text-muted-foreground/40 hover:text-muted-foreground/80 transition-colors"
                                            onClick={(e) => { e.stopPropagation(); handleCopyShift(shift); }}
                                            title="複製班卡"
                                            data-testid={`button-copy-shift-${shift.id}`}
                                          >
                                            <Copy className="h-2.5 w-2.5" />
                                          </button>
                                        </div>
                                      </div>
                                    </DraggableShiftCard>
                                  );
                                }

                                return (
                                  <DraggableShiftCard key={shift.id} id={shift.id} isDragging={isDragging}>
                                    <div
                                      className={`rounded-md px-1.5 py-1 text-[10px] cursor-pointer transition-all hover:shadow-sm ${cardColor} ${isDragging ? "opacity-30" : ""}`}
                                      onClick={() => openEditShiftDialog(shift)}
                                      data-testid={`shift-${shift.id}`}
                                    >
                                      <div className="flex items-center justify-between gap-0.5 mb-0.5">
                                        <div className="font-semibold leading-tight truncate flex-1 text-[11px]">
                                          {venue?.shortName || "未知"}
                                        </div>
                                        <div className="flex items-center gap-0.5 shrink-0">
                                          <span className={`text-[8px] font-bold px-1 py-0 rounded-full leading-4 ${roleColor!.badge}`}>
                                            {roleShort}
                                          </span>
                                          <button
                                            className="text-muted-foreground/40 hover:text-muted-foreground/80 transition-colors"
                                            onClick={(e) => { e.stopPropagation(); handleCopyShift(shift); }}
                                            title="複製班卡"
                                            data-testid={`button-copy-shift-${shift.id}`}
                                          >
                                            <Copy className="h-2.5 w-2.5" />
                                          </button>
                                        </div>
                                      </div>
                                      <div className="leading-tight text-muted-foreground text-[10px]">
                                        {sStart}–{sEnd}
                                      </div>
                                      {shift.isDispatch && (
                                        <div className="text-[9px] text-purple-600 dark:text-purple-400 font-medium mt-0.5">派遣</div>
                                      )}
                                    </div>
                                  </DraggableShiftCard>
                                );
                              })}
                              <div className="flex items-center gap-0.5">
                                <button
                                  className="flex-1 flex items-center justify-center py-0.5 text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
                                  onClick={() => openNewShiftDialog(emp.id, dateStr)}
                                  data-testid={`button-add-shift-${emp.id}-${dateStr}`}
                                >
                                  <Plus className="h-3 w-3" />
                                </button>
                                {canPaste && (
                                  <button
                                    className="flex items-center justify-center py-0.5 px-0.5 text-green-500/60 hover:text-green-600 transition-colors"
                                    onClick={() => handlePasteShift(emp.id, dateStr)}
                                    title="貼上班卡"
                                    data-testid={`button-paste-shift-${emp.id}-${dateStr}`}
                                  >
                                    <ClipboardPaste className="h-3 w-3" />
                                  </button>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center h-[36px]">
                              <button
                                className="flex-1 flex items-center justify-center h-full text-muted-foreground/30 hover:text-muted-foreground/60 hover:bg-muted/30 transition-colors rounded cursor-pointer"
                                onClick={() => openNewShiftDialog(emp.id, dateStr)}
                                data-testid={`button-add-shift-${emp.id}-${dateStr}`}
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                              {canPaste && (
                                <button
                                  className="flex items-center justify-center h-full px-0.5 text-green-500/50 hover:text-green-600 transition-colors"
                                  onClick={() => handlePasteShift(emp.id, dateStr)}
                                  title="貼上班卡"
                                  data-testid={`button-paste-shift-${emp.id}-${dateStr}`}
                                >
                                  <ClipboardPaste className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          )}
                        </DroppableCell>
                      );
                    })}
                  </tr>
                )),
                    ];
                  }),
                  ];
                })()
              )}
              <tr data-testid="dispatch-section-header">
                <td
                  className="px-2 py-1.5 border-b border-r sticky left-0 bg-purple-50 dark:bg-purple-950/30 z-[5] cursor-pointer select-none"
                  style={{ minWidth: COL_LEFT_WIDTH, width: COL_LEFT_WIDTH, maxWidth: COL_LEFT_WIDTH }}
                >
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setDispatchSectionCollapsed(!dispatchSectionCollapsed)} className="flex items-center gap-1">
                      {dispatchSectionCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-purple-600" /> : <ChevronDown className="h-3.5 w-3.5 text-purple-600" />}
                      <span className="text-xs font-bold text-purple-700 dark:text-purple-400 tracking-wide">派遣人員 ({dispatchNames.length})</span>
                    </button>
                    <button
                      className="ml-auto flex items-center gap-0.5 px-1.5 py-0.5 rounded text-purple-500 hover:text-purple-700 hover:bg-purple-100/60 dark:hover:bg-purple-900/30 dark:hover:text-purple-300 transition-colors text-[11px] font-medium"
                      onClick={() => openNewDispatchDialog(format(new Date(), "yyyy-MM-dd"), "", false)}
                      data-testid="button-add-dispatch-new"
                      title="快速新增派遣班次（可選任意日期）"
                    >
                      <Plus className="h-3 w-3" />
                      快速新增
                    </button>
                  </div>
                </td>
                {monthDates.map((d, di) => {
                  const dateStr = format(d, "yyyy-MM-dd");
                  const dayDispatches = dispatchShiftsByDate.get(dateStr) || [];
                  const isDispatchHeaderCustom = customHighlightedDates.has(dateStr);
                  return (
                    <td key={di} className={`border-b border-r text-center ${isDispatchHeaderCustom ? "bg-orange-100/60 dark:bg-orange-950/30" : "bg-purple-50/50 dark:bg-purple-950/20"}`} style={{ minWidth: COL_DATE_WIDTH }}>
                      {dispatchSectionCollapsed && dayDispatches.length > 0 && (
                        <span className="text-[10px] text-purple-600 dark:text-purple-400 font-medium">{dayDispatches.length}人</span>
                      )}
                    </td>
                  );
                })}
              </tr>
              {!dispatchSectionCollapsed && (() => {
                const allNames = [...dispatchNames, ...pendingDispatchNames.filter(n => !dispatchNames.includes(n))];
                const renderDispatchRow = (name: string, isPending: boolean) => (
                  <tr key={`dispatch-${name}`} className="group" data-testid={`row-dispatch-${name}`}>
                    <td
                      className="p-2 border-b border-r sticky left-0 bg-background z-[5] overflow-hidden"
                      style={{ minWidth: COL_LEFT_WIDTH, width: COL_LEFT_WIDTH, maxWidth: COL_LEFT_WIDTH }}
                    >
                      <div className="flex items-center gap-1.5">
                        <ArrowRightLeft className={`h-3.5 w-3.5 shrink-0 ${isPending ? "text-purple-300 dark:text-purple-700" : "text-purple-500"}`} />
                        <span className={`font-medium text-sm whitespace-nowrap ${isPending ? "text-purple-400 dark:text-purple-600 italic" : "text-purple-700 dark:text-purple-400"}`} data-testid={`text-dispatch-name-${name}`}>
                          {name}
                        </span>
                        <span className="text-[9px] px-1 py-0 rounded bg-purple-500/15 text-purple-500 leading-4 shrink-0">派遣</span>
                        {isPending && (
                          <button
                            className="ml-auto text-purple-300/60 hover:text-red-400 transition-colors"
                            onClick={() => setPendingDispatchNames(prev => prev.filter(n => n !== name))}
                            title="移除此列"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </td>
                    {monthDates.map((d, di) => {
                      const dateStr = format(d, "yyyy-MM-dd");
                      const cellDispatches = isPending
                        ? []
                        : (dispatchShiftsByDate.get(dateStr) || []).filter(ds => ds.dispatchName === name);
                      const isToday = dateStr === format(new Date(), "yyyy-MM-dd");
                      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                      const isHolidayCell = !!TAIWAN_HOLIDAYS[dateStr];
                      const isDispatchCellCustom = customHighlightedDates.has(dateStr);
                      return (
                        <td
                          key={di}
                          className={`p-0.5 border-b border-r relative align-top ${
                            isDispatchCellCustom ? "bg-orange-50 dark:bg-orange-950/20" :
                            isToday ? "bg-primary/5" : isHolidayCell ? "bg-yellow-100/60 dark:bg-yellow-900/20" : isWeekend ? "bg-yellow-100/60 dark:bg-yellow-900/20" : ""
                          }`}
                          style={{ minWidth: colWidths[di] ?? COL_DATE_WIDTH, width: colWidths[di] ?? COL_DATE_WIDTH }}
                          data-testid={`cell-dispatch-${name}-${dateStr}`}
                        >
                          {cellDispatches.length > 0 ? (
                            <div className="space-y-0.5">
                              {cellDispatches.map((ds) => {
                                const venue = ds.venueId ? venueMap.get(ds.venueId) : null;
                                const sStart = ds.startTime.substring(0, 5);
                                const sEnd = ds.endTime.substring(0, 5);
                                const roleShort = ROLE_SHORT[ds.role] || ds.role.slice(0, 1);
                                return (
                                  <div
                                    key={ds.id}
                                    className="rounded-md px-1.5 py-1 text-xs cursor-pointer transition-all hover:shadow-sm bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800"
                                    onClick={() => openEditDispatchDialog(ds)}
                                    data-testid={`dispatch-shift-${ds.id}`}
                                    title={`${ds.dispatchCompany ? ds.dispatchCompany + " | " : ""}${ds.dispatchPhone || ""}`}
                                  >
                                    <div className="flex items-center justify-between gap-1 mb-0.5">
                                      <div className="font-semibold leading-tight text-[11px] truncate text-purple-700 dark:text-purple-300">
                                        {venue?.shortName || "未指定"}
                                      </div>
                                      <span className={`text-[8px] font-bold px-1 py-0 rounded-full leading-4 shrink-0 ${getRoleColor(ds.role).badge}`}>
                                        {roleShort}
                                      </span>
                                    </div>
                                    <div className="leading-tight text-[10px] text-muted-foreground">
                                      {sStart}–{sEnd}
                                    </div>
                                    {ds.dispatchCompany && (
                                      <div className="text-[9px] text-purple-600 dark:text-purple-400 font-medium truncate mt-0.5">{ds.dispatchCompany}</div>
                                    )}
                                  </div>
                                );
                              })}
                              <button
                                className="w-full flex items-center justify-center py-0.5 text-purple-400/40 hover:text-purple-500/70 transition-colors"
                                onClick={() => openNewDispatchDialog(dateStr, name, true)}
                                data-testid={`button-add-dispatch-${name}-${dateStr}`}
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            </div>
                          ) : (
                            <button
                              className="flex items-center justify-center w-full h-[40px] text-purple-300/30 hover:text-purple-400/60 hover:bg-purple-50/30 dark:hover:bg-purple-950/20 transition-colors rounded cursor-pointer"
                              onClick={() => openNewDispatchDialog(dateStr, name, true)}
                              data-testid={`button-add-dispatch-${name}-${dateStr}`}
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
                return (
                  <>
                    {allNames.map(name => renderDispatchRow(name, pendingDispatchNames.includes(name) && !dispatchNames.includes(name)))}
                    <tr data-testid="row-dispatch-inline-add">
                      <td
                        className="p-1.5 border-b border-r sticky left-0 bg-background z-[5] overflow-hidden"
                        style={{ minWidth: COL_LEFT_WIDTH, width: COL_LEFT_WIDTH, maxWidth: COL_LEFT_WIDTH }}
                      >
                        <div className="flex items-center gap-1">
                          <Plus className="h-3.5 w-3.5 text-purple-300 shrink-0" />
                          <input
                            ref={inlineDispatchInputRef}
                            type="text"
                            value={inlineDispatchInput}
                            onChange={e => setInlineDispatchInput(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === "Enter") {
                                const name = inlineDispatchInput.trim();
                                if (name && !dispatchNames.includes(name) && !pendingDispatchNames.includes(name)) {
                                  setPendingDispatchNames(prev => [...prev, name]);
                                }
                                setInlineDispatchInput("");
                              } else if (e.key === "Escape") {
                                setInlineDispatchInput("");
                              }
                            }}
                            placeholder="輸入姓名後按 Enter 新增一列..."
                            className="flex-1 text-xs bg-transparent border-none outline-none text-purple-600 dark:text-purple-400 placeholder:text-purple-300/40 dark:placeholder:text-purple-700/60 min-w-0"
                            data-testid="input-dispatch-inline-name"
                          />
                        </div>
                      </td>
                      {monthDates.map((_, di) => (
                        <td key={di} className="border-b border-r bg-transparent" style={{ minWidth: colWidths[di] ?? COL_DATE_WIDTH, width: colWidths[di] ?? COL_DATE_WIDTH }} />
                      ))}
                    </tr>
                  </>
                );
              })()}
            </tbody>
          </table>
          <DragOverlay>
            {draggedShiftId ? (() => {
              const s = shifts.find(sh => sh.id === draggedShiftId);
              if (!s) return null;
              const v = venueMap.get(s.venueId);
              return (
                <div className="rounded px-1 py-0.5 text-[10px] bg-blue-200 dark:bg-blue-800 border border-blue-400 shadow-lg opacity-90 cursor-grabbing w-[68px]">
                  <div className="font-medium truncate">{v?.shortName || "?"}</div>
                  <div className="text-muted-foreground">{s.startTime.substring(0,5)}-{s.endTime.substring(0,5)}</div>
                </div>
              );
            })() : null}
          </DragOverlay>
          </DndContext>
        </div>

      </div>

      <Dialog open={!!dragConfirmTarget} onOpenChange={() => setDragConfirmTarget(null)}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>覆蓋確認</DialogTitle>
            <DialogDescription>目標日期已有班次，是否覆蓋？</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setDragConfirmTarget(null)}>取消</Button>
            <Button onClick={() => {
              if (!dragConfirmTarget) return;
              const draggedShift = shifts.find(s => s.id === dragConfirmTarget.shiftId);
              if (draggedShift) {
                const existing = shiftsByEmployeeDate.get(`${dragConfirmTarget.targetEmpId}-${dragConfirmTarget.targetDate}`) || [];
                if (existing.length > 0) {
                  updateShift.mutate({ id: existing[0].id, venueId: draggedShift.venueId, startTime: draggedShift.startTime, endTime: draggedShift.endTime, role: draggedShift.role, isDispatch: draggedShift.isDispatch || false });
                  deleteShift.mutate(dragConfirmTarget.shiftId);
                } else {
                  updateShift.mutate({ id: dragConfirmTarget.shiftId, date: dragConfirmTarget.targetDate, venueId: draggedShift.venueId, startTime: draggedShift.startTime, endTime: draggedShift.endTime, role: draggedShift.role, isDispatch: draggedShift.isDispatch || false });
                }
              }
              setDragConfirmTarget(null);
            }}>覆蓋</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dispatchDialogOpen} onOpenChange={setDispatchDialogOpen}>
        <DialogContent className="sm:max-w-md" data-testid="dispatch-shift-dialog">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-purple-700 dark:text-purple-400">
              {editingDispatch
                ? <>編輯派遣班次 <span className="text-sm font-normal text-muted-foreground ml-1">— {editingDispatch.dispatchName}</span></>
                : "新增派遣班次"
              }
            </DialogTitle>
            <DialogDescription className="text-purple-600/70">
              不受勞基法限制；時間與場館依實際安排填入。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>派遣人員姓名 *</Label>
              <Input
                value={dispatchName}
                onChange={(e) => {
                  const v = e.target.value;
                  setDispatchName(v);
                  const matched = allSystemEmployees.find(emp => emp.name === v.trim() && emp.status === "active");
                  setDispatchLinkedEmployeeId(matched ? matched.id : null);
                }}
                placeholder="輸入派遣人員姓名"
                data-testid="input-dispatch-name"
              />
              {(() => {
                if (!dispatchName.trim()) return null;
                if (dispatchLinkedEmployeeId) {
                  const emp = allSystemEmployees.find(e => e.id === dispatchLinkedEmployeeId);
                  return (
                    <div className="flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded px-2 py-1" data-testid="dispatch-linked-employee-badge">
                      <CheckCircle2 className="h-3 w-3 shrink-0" />
                      <span>已連結在職員工 · {emp?.role} · {emp?.employeeCode}</span>
                      <button className="ml-auto text-green-500 hover:text-green-700" onClick={() => setDispatchLinkedEmployeeId(null)} title="取消連結">×</button>
                    </div>
                  );
                }
                const partials = allSystemEmployees.filter(e => e.status === "active" && e.name.includes(dispatchName.trim()) && e.name !== dispatchName.trim());
                if (partials.length > 0) {
                  return (
                    <div className="text-xs text-muted-foreground rounded px-2 py-1 bg-muted/40">
                      相似：{partials.slice(0,3).map(e => (
                        <button key={e.id} className="text-primary underline mr-1" onClick={() => { setDispatchName(e.name); setDispatchLinkedEmployeeId(e.id); }}>{e.name}</button>
                      ))}
                    </div>
                  );
                }
                return null;
              })()}
            </div>
            {!editingDispatch && (
              <div className="flex items-center justify-between">
                <Label className="text-sm">批次排班模式</Label>
                <Switch
                  checked={dispatchBatchMode}
                  onCheckedChange={(v) => { setDispatchBatchMode(v); setDispatchBatchDates(new Set()); }}
                  data-testid="switch-dispatch-batch-mode"
                />
              </div>
            )}
            {!dispatchBatchMode || editingDispatch ? (
              <div className="space-y-2">
                <Label>日期 *</Label>
                <Input
                  type="date"
                  value={dispatchDate}
                  onChange={(e) => setDispatchDate(e.target.value)}
                  data-testid="input-dispatch-date"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label>選擇日期（批次） *</Label>
                <div className="rounded-md border p-2 max-h-40 overflow-y-auto" data-testid="dispatch-batch-date-picker">
                  <div className="grid grid-cols-7 gap-0.5">
                    {monthDates.map((d) => {
                      const dKey = format(d, "yyyy-MM-dd");
                      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                      const selected = dispatchBatchDates.has(dKey);
                      return (
                        <button
                          key={dKey}
                          type="button"
                          onClick={() => {
                            setDispatchBatchDates(prev => {
                              const next = new Set(prev);
                              if (next.has(dKey)) next.delete(dKey);
                              else next.add(dKey);
                              return next;
                            });
                          }}
                          data-testid={`dispatch-batch-date-${dKey}`}
                          className={`text-[11px] rounded py-0.5 text-center transition-colors ${selected ? "bg-purple-600 text-white font-bold" : isWeekend ? "text-destructive/70 hover:bg-muted" : "hover:bg-muted"}`}
                        >
                          {format(d, "d")}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {dispatchBatchDates.size > 0 && (
                  <p className="text-xs text-muted-foreground">已選 {dispatchBatchDates.size} 天</p>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>場館</Label>
                <Select value={dispatchVenueId} onValueChange={setDispatchVenueId}>
                  <SelectTrigger data-testid="select-dispatch-venue">
                    <SelectValue placeholder="選擇場館" />
                  </SelectTrigger>
                  <SelectContent>
                    {venues.map((v) => (
                      <SelectItem key={v.id} value={v.id.toString()} data-testid={`select-dispatch-venue-${v.id}`}>
                        {v.shortName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>班別</Label>
                <Select value={dispatchRole} onValueChange={setDispatchRole}>
                  <SelectTrigger data-testid="select-dispatch-role">
                    <SelectValue>
                      {dispatchRole && (() => {
                        const rc = ROLE_COLORS[dispatchRole];
                        return (
                          <span className="flex items-center gap-1.5">
                            {rc && <span className={`inline-block w-2 h-2 rounded-full ${rc.dot} shrink-0`} />}
                            {dispatchRole}
                          </span>
                        );
                      })()}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((r) => {
                      const rc = ROLE_COLORS[r];
                      return (
                        <SelectItem key={r} value={r}>
                          <span className="flex items-center gap-2">
                            <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${rc?.dot || "bg-gray-400"}`} />
                            {r}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>開始時間 *</Label>
                <Input
                  type="time"
                  value={dispatchStartTime}
                  onChange={(e) => setDispatchStartTime(e.target.value)}
                  data-testid="input-dispatch-start-time"
                />
              </div>
              <div className="space-y-2">
                <Label>結束時間 *</Label>
                <Input
                  type="time"
                  value={dispatchEndTime}
                  onChange={(e) => setDispatchEndTime(e.target.value)}
                  data-testid="input-dispatch-end-time"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>派遣公司</Label>
                <Input
                  value={dispatchCompany}
                  onChange={(e) => setDispatchCompany(e.target.value)}
                  placeholder="公司名稱（選填）"
                  data-testid="input-dispatch-company"
                />
              </div>
              <div className="space-y-2">
                <Label>聯絡電話</Label>
                <Input
                  value={dispatchPhone}
                  onChange={(e) => setDispatchPhone(e.target.value)}
                  placeholder="電話（選填）"
                  data-testid="input-dispatch-phone"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>備註</Label>
              <Input
                value={dispatchNotes}
                onChange={(e) => setDispatchNotes(e.target.value)}
                placeholder="其他備註（選填）"
                data-testid="input-dispatch-notes"
              />
            </div>
          </div>
          <DialogFooter className="flex justify-between">
            <div>
              {editingDispatch && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => deleteDispatchShift.mutate(editingDispatch.id)}
                  disabled={deleteDispatchShift.isPending}
                  data-testid="button-delete-dispatch"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  刪除
                </Button>
              )}
            </div>
            <Button
              onClick={handleSaveDispatch}
              disabled={
                !dispatchName || !dispatchStartTime || !dispatchEndTime ||
                (!editingDispatch && !dispatchBatchMode && !dispatchDate) ||
                (!editingDispatch && dispatchBatchMode && dispatchBatchDates.size === 0) ||
                createDispatchShift.isPending || updateDispatchShift.isPending || batchCreateDispatchShifts.isPending
              }
              data-testid="button-save-dispatch"
            >
              {editingDispatch ? "更新" : dispatchBatchMode ? `批次新增（${dispatchBatchDates.size}天）` : "新增"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dispatchAddNameDialogOpen} onOpenChange={setDispatchAddNameDialogOpen}>
        <DialogContent className="sm:max-w-sm" data-testid="dispatch-add-name-dialog">
          <DialogHeader>
            <DialogTitle className="text-purple-700 dark:text-purple-400">新增派遣人員</DialogTitle>
            <DialogDescription>輸入姓名後系統自動核對在職員工名單，再至日期欄位安排班次。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="dispatch-add-name-input">派遣人員姓名</Label>
              <Input
                id="dispatch-add-name-input"
                autoFocus
                value={dispatchAddNameInput}
                onChange={(e) => setDispatchAddNameInput(e.target.value)}
                placeholder="輸入姓名"
                data-testid="input-dispatch-add-name"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const n = dispatchAddNameInput.trim();
                    if (n && !dispatchNames.includes(n)) {
                      setPendingDispatchNames(prev => [...prev, n]);
                    }
                    setDispatchAddNameDialogOpen(false);
                  }
                }}
              />
            </div>
            {(() => {
              const trimmed = dispatchAddNameInput.trim();
              if (!trimmed) return null;
              const matchedEmployee = employees.find(e => e.name === trimmed && e.status === "active");
              const partialMatches = employees.filter(e => e.status === "active" && e.name.includes(trimmed) && e.name !== trimmed);
              if (matchedEmployee) {
                return (
                  <div className="flex items-center gap-2 rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 px-3 py-2 text-sm text-green-700 dark:text-green-400" data-testid="dispatch-name-match-found">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <div>
                      <span className="font-medium">{matchedEmployee.name}</span>
                      <span className="text-xs ml-2 opacity-75">{matchedEmployee.role} · {matchedEmployee.employeeCode}</span>
                    </div>
                  </div>
                );
              }
              if (partialMatches.length > 0) {
                return (
                  <div className="rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-sm" data-testid="dispatch-name-partial-match">
                    <div className="text-xs text-blue-600 dark:text-blue-400 mb-1">相似姓名：</div>
                    <div className="flex flex-wrap gap-1">
                      {partialMatches.slice(0, 5).map(e => (
                        <button
                          key={e.id}
                          onClick={() => setDispatchAddNameInput(e.name)}
                          className="text-xs px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900 transition-colors"
                          data-testid={`dispatch-name-suggestion-${e.id}`}
                        >
                          {e.name}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              }
              return (
                <div className="flex items-center gap-2 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-700 dark:text-amber-400" data-testid="dispatch-name-not-found">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>非在職員工名單，仍可加入</span>
                </div>
              );
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDispatchAddNameDialogOpen(false)}>取消</Button>
            <Button
              className="bg-purple-600 hover:bg-purple-700 text-white"
              onClick={() => {
                const n = dispatchAddNameInput.trim();
                if (n && !dispatchNames.includes(n)) {
                  setPendingDispatchNames(prev => [...prev, n]);
                }
                setDispatchAddNameDialogOpen(false);
              }}
              disabled={!dispatchAddNameInput.trim()}
              data-testid="button-confirm-add-dispatch-name"
            >
              加入名單
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                            ? pickerEmployees.find(e => shiftSelectedEmployeeIds.has(e.id))?.name || "1 人"
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
                        const groupEmps = pickerEmployees.filter(group.filter);
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
                                {neiQinEmployeeIds.has(emp.id) ? (
                                  <span className="text-[9px] px-1 py-0 rounded bg-blue-500/15 text-blue-500 leading-4">內勤</span>
                                ) : crossRegionEmployeeIds.has(emp.id) && (
                                  <span className="text-[9px] px-1 py-0 rounded bg-orange-500/15 text-orange-500 leading-4">支援</span>
                                )}
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
                <Select value={shiftRole} onValueChange={(v) => { setShiftRole(v); setShiftTemplateId("custom"); if (LEAVE_TYPES.includes(v)) { setShiftStartTime("00:00"); setShiftEndTime("00:00"); setShiftVenueId(""); } }}>
                  <SelectTrigger data-testid="select-shift-role">
                    <SelectValue placeholder="選擇班別">
                      {shiftRole && !["---work-separator","---leave-separator"].includes(shiftRole) && (() => {
                        const rc = ROLE_COLORS[shiftRole];
                        return (
                          <span className="flex items-center gap-1.5">
                            {rc && <span className={`inline-block w-2 h-2 rounded-full ${rc.dot} shrink-0`} />}
                            {shiftRole}
                          </span>
                        );
                      })()}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="---work-separator" disabled><span className="text-xs text-muted-foreground">── 工作班別 ──</span></SelectItem>
                    {ROLE_OPTIONS.map(r => {
                      const rc = ROLE_COLORS[r];
                      return (
                        <SelectItem key={r} value={r}>
                          <span className="flex items-center gap-2">
                            <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${rc?.dot || "bg-gray-400"}`} />
                            {r}
                          </span>
                        </SelectItem>
                      );
                    })}
                    <SelectItem value="---leave-separator" disabled><span className="text-xs text-muted-foreground">── 假別 ──</span></SelectItem>
                    {LEAVE_TYPES.map(lt => (
                      <SelectItem key={lt} value={lt}>{lt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {!LEAVE_TYPES.includes(shiftRole) && (
              <>
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
              </>
            )}

            {LEAVE_TYPES.includes(shiftRole) && (
              <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30 p-3 text-center">
                <p className="text-sm text-muted-foreground">{shiftRole}不需要設定時間與場館</p>
              </div>
            )}

            {(() => {
              const isLeavePreview = LEAVE_TYPES.includes(shiftRole);
              const previewVenue = venues.find((v) => v.id.toString() === shiftVenueId);
              const previewRoleColor = isLeavePreview ? null : getRoleColor(shiftRole, shiftIsDispatch);
              const previewCardColor = isLeavePreview
                ? (LEAVE_COLORS[shiftRole] || LEAVE_COLORS["休假"])
                : previewRoleColor!.card;
              const previewShort = ROLE_SHORT[shiftRole] || shiftRole.slice(0, 1);
              return (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">預覽</Label>
                  <div className={`rounded-md px-2 py-1.5 text-[11px] w-fit min-w-[80px] ${previewCardColor}`}>
                    {isLeavePreview ? (
                      <div className="font-semibold">{shiftRole}</div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between gap-1 mb-0.5">
                          <div className="font-semibold">{previewVenue?.shortName || "—"}</div>
                          <span className={`text-[8px] font-bold px-1 py-0 rounded-full leading-4 ${previewRoleColor!.badge}`}>{previewShort}</span>
                        </div>
                        <div className="text-muted-foreground">{shiftStartTime || "--:--"}–{shiftEndTime || "--:--"}</div>
                        {shiftIsDispatch && <div className="text-[9px] text-purple-600 dark:text-purple-400 font-medium mt-0.5">派遣</div>}
                      </>
                    )}
                  </div>
                </div>
              );
            })()}

            {shiftClipboard && (
              <div className="flex items-center gap-2 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 px-3 py-2">
                <Clipboard className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" />
                <span className="text-xs text-green-700 dark:text-green-400 flex-1">
                  剪貼簿：{venueMap.get(shiftClipboard.venueId)?.shortName || "?"} {shiftClipboard.startTime.substring(0,5)}-{shiftClipboard.endTime.substring(0,5)} [{shiftClipboard.role}]
                </span>
                <button
                  type="button"
                  className="text-[10px] px-2 py-0.5 rounded bg-green-600 text-white hover:bg-green-700 transition-colors shrink-0"
                  onClick={() => {
                    setShiftVenueId(shiftClipboard.venueId.toString());
                    setShiftStartTime(shiftClipboard.startTime.substring(0, 5));
                    setShiftEndTime(shiftClipboard.endTime.substring(0, 5));
                    setShiftRole(shiftClipboard.role);
                    setShiftIsDispatch(shiftClipboard.isDispatch);
                    setShiftTemplateId("custom");
                  }}
                  data-testid="button-load-clipboard"
                >
                  套用至此批次
                </button>
              </div>
            )}

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

          {fourWeekDialogWarnings.length > 0 && (
            <div className="rounded-lg border p-3 space-y-1" data-testid="four-week-dialog-warnings">
              {fourWeekDialogWarnings.map((w, i) => (
                <div key={i} className={`flex items-start gap-2 text-xs ${w.type === "four_week_176h" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>{w.message}</span>
                </div>
              ))}
            </div>
          )}

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
                disabled={!shiftVenueId || !shiftStartTime || !shiftEndTime || batchCreateShifts.isPending || batchUpdateShifts.isPending || updateShift.isPending}
                data-testid="button-save-shift"
              >
                {shiftBatchMode && shiftBatchDates.size > 0
                  ? (batchCreateShifts.isPending || batchUpdateShifts.isPending)
                    ? "更新中..."
                    : `批次${editingShift ? "更新" : "調整"} (${shiftBatchDates.size + 1}天)`
                  : updateShift.isPending ? "儲存中..." : "儲存"}
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
              <Select value={slotRole} onValueChange={setSlotRole}>
                <SelectTrigger data-testid="toggle-slot-role">
                  <SelectValue placeholder="選擇職位" />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map(r => {
                    const Icon = ROLE_ICON_MAP[r] || UserRound;
                    return (
                      <SelectItem key={r} value={r}>
                        <span className="flex items-center gap-1.5">
                          <Icon className="h-3.5 w-3.5" />
                          {r}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
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
                      const _slotKey = `${slot.venueId}-${slot.date}`;
                      const venueDateShifts = shiftsByVenueDate.get(_slotKey) || [];
                      const _dispatchForSlot = dispatchShiftsByVenueDate.get(_slotKey) || [];
                      const assignedCount =
                        venueDateShifts.filter((sh) => shiftOverlapsSlot(sh, slot)).length +
                        _dispatchForSlot.filter((ds) => dispatchOverlapsSlot(ds, slot)).length;
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

      <Dialog open={crossRegionDialogOpen} onOpenChange={setCrossRegionDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4 text-orange-500" />
              跨區支援人員
            </DialogTitle>
            <DialogDescription>從其他區域選擇支援人員加入排班</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex gap-1 border-b pb-2">
              {regionsData.filter(r => r.code !== activeRegion).map(r => (
                <button
                  key={r.code}
                  className={`text-xs px-3 py-1.5 rounded-md transition-colors ${crossRegionTab === r.code ? "bg-orange-500/15 text-orange-500 font-medium" : "text-muted-foreground hover:bg-muted"}`}
                  onClick={() => setCrossRegionTab(r.code)}
                  data-testid={`cross-region-tab-${r.code}`}
                >
                  {r.name}
                </button>
              ))}
            </div>

            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="搜尋姓名..."
                value={crossRegionSearch}
                onChange={(e) => setCrossRegionSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
                data-testid="input-cross-region-search"
              />
            </div>

            <div className="max-h-[300px] overflow-auto border rounded-md p-1">
              {(() => {
                const regionEmps = allSystemEmployees
                  .filter(e => {
                    const regionId = regionCodeToId.get(crossRegionTab);
                    return regionId && e.regionId === regionId && e.status !== "inactive"
                      && ["救生", "守望", "櫃台", "教練", "主管職"].includes(e.role);
                  })
                  .filter(e => !crossRegionSearch || e.name.includes(crossRegionSearch));

                if (regionEmps.length === 0) {
                  return <div className="text-center py-6 text-muted-foreground text-sm">此區域無可選員工</div>;
                }

                const groups = [
                  { label: "正職", filter: (e: Employee) => e.employmentType === "full_time" },
                  { label: "兼職", filter: (e: Employee) => e.employmentType === "part_time" },
                ];

                return groups.map(group => {
                  const groupEmps = regionEmps.filter(group.filter);
                  if (groupEmps.length === 0) return null;
                  return (
                    <div key={group.label} className="mb-1">
                      <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                        {group.label} ({groupEmps.length})
                      </div>
                      {groupEmps.map(emp => {
                        const isSelected = crossRegionEmployeeIds.has(emp.id);
                        return (
                          <button
                            key={emp.id}
                            type="button"
                            className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-sm transition-colors ${isSelected ? "bg-orange-500/10" : "hover:bg-muted"}`}
                            onClick={() => {
                              const next = new Set(crossRegionEmployeeIds);
                              if (next.has(emp.id)) next.delete(emp.id);
                              else next.add(emp.id);
                              setCrossRegionEmployeeIds(next);
                            }}
                            data-testid={`cross-region-emp-${emp.id}`}
                          >
                            <Checkbox checked={isSelected} className="h-3.5 w-3.5" />
                            <span className="text-foreground flex-1 text-left">{emp.name}</span>
                            <span className="text-[10px] text-muted-foreground">{emp.role}</span>
                          </button>
                        );
                      })}
                    </div>
                  );
                });
              })()}
            </div>

            {crossRegionEmployeeIds.size > 0 && (
              <div className="text-xs text-orange-500 flex items-center gap-1">
                <ArrowRightLeft className="h-3 w-3" />
                已選 {crossRegionEmployeeIds.size} 位跨區支援人員（排班自動標記為派遣）
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCrossRegionDialogOpen(false)}>
              完成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <GoogleSheetsImportDialog
        open={sheetsImportOpen}
        onOpenChange={setSheetsImportOpen}
        currentYear={currentMonth.getFullYear()}
        currentMonth={currentMonth.getMonth() + 1}
      />
    </div>
  );
}
