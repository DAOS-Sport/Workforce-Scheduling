import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, startOfMonth, endOfMonth, eachDayOfInterval } from "date-fns";
import { zhTW } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RegionTabs } from "@/components/region-tabs";
import { useRegion } from "@/lib/region-context";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CalendarDays, Settings, Save, ChevronLeft, ChevronRight, CalendarOff } from "lucide-react";
import type { Employee, Region } from "@shared/schema";

interface ShiftAvailability {
  id: number;
  employeeId: number;
  date: string;
  entryType: string;
  startTime: string | null;
  endTime: string | null;
  note: string | null;
}

interface AvailWindowEntry { openFrom: string; openUntil: string; }
interface AvailabilityWindow {
  targetYearMonth: string;
  windows: AvailWindowEntry[];
}

const DAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];

export default function AvailabilityPage() {
  const { activeRegion } = useRegion();
  const { toast } = useToast();

  const now = new Date();
  const defaultNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const [viewYearMonth, setViewYearMonth] = useState(format(defaultNextMonth, "yyyy-MM"));

  const [windowForm, setWindowForm] = useState<AvailabilityWindow>({
    targetYearMonth: format(defaultNextMonth, "yyyy-MM"),
    windows: [
      { openFrom: format(now, "yyyy-MM-dd"), openUntil: format(new Date(now.getFullYear(), now.getMonth() + 1, 0), "yyyy-MM-dd") },
      { openFrom: "", openUntil: "" },
    ],
  });
  const [windowLoaded, setWindowLoaded] = useState(false);
  const [holidaySet, setHolidaySet] = useState<Set<string>>(new Set());

  const { data: regionsData = [] } = useQuery<Region[]>({ queryKey: ["/api/regions"] });

  const regionId = useMemo(() => {
    const r = regionsData.find(r => r.code === activeRegion);
    return r?.id;
  }, [regionsData, activeRegion]);

  const { data: employees = [], isLoading: empLoading } = useQuery<Employee[]>({
    queryKey: ["/api/employees", activeRegion],
    enabled: !!activeRegion,
  });
  const activeEmployees = useMemo(() => employees.filter(e => e.status !== "inactive"), [employees]);

  const { data: availabilities = [], isLoading: availLoading } = useQuery<ShiftAvailability[]>({
    queryKey: ["/api/availabilities", activeRegion, viewYearMonth],
    queryFn: async () => {
      const params = new URLSearchParams({ yearMonth: viewYearMonth });
      if (activeRegion) params.set("regionCode", activeRegion);
      const res = await fetch(`/api/availabilities?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: windowConfigData } = useQuery<{ key: string; value: string } | null>({
    queryKey: ["/api/system-config/availability_window"],
    queryFn: async () => {
      const res = await fetch("/api/system-config/availability_window");
      if (!res.ok) return null;
      return res.json();
    },
  });

  const { data: holidayConfigData } = useQuery<{ key: string; value: string | null } | null>({
    queryKey: ["/api/system-config/monthly_holidays"],
    queryFn: async () => {
      const res = await fetch("/api/system-config/monthly_holidays");
      if (!res.ok) return null;
      return res.json();
    },
  });

  useEffect(() => {
    if (windowConfigData?.value && !windowLoaded) {
      try {
        const parsed = JSON.parse(windowConfigData.value);
        let wins: AvailWindowEntry[] = parsed.windows ?? [];
        // Backward compat: old flat format
        if (!parsed.windows && parsed.openFrom) {
          wins = [{ openFrom: parsed.openFrom, openUntil: parsed.openUntil }];
        }
        while (wins.length < 2) wins.push({ openFrom: "", openUntil: "" });
        setWindowForm({ targetYearMonth: parsed.targetYearMonth, windows: wins.slice(0, 2) });
        setWindowLoaded(true);
      } catch {}
    }
  }, [windowConfigData, windowLoaded]);

  function updateWindow(idx: number, field: "openFrom" | "openUntil", value: string) {
    setWindowForm(prev => {
      const wins = [...prev.windows];
      wins[idx] = { ...wins[idx], [field]: value };
      return { ...prev, windows: wins };
    });
  }

  useEffect(() => {
    try {
      const map = holidayConfigData?.value ? JSON.parse(holidayConfigData.value) as Record<string, string[]> : {};
      setHolidaySet(new Set(map[windowForm.targetYearMonth] ?? []));
    } catch { setHolidaySet(new Set()); }
  }, [holidayConfigData, windowForm.targetYearMonth]);

  const holidayMonthDates = useMemo(() => {
    const [y, m] = windowForm.targetYearMonth.split("-").map(Number);
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0);
    return eachDayOfInterval({ start, end });
  }, [windowForm.targetYearMonth]);

  const EMPTY_WIN: AvailWindowEntry = { openFrom: "", openUntil: "" };
  const safeWindows: AvailWindowEntry[] = [
    windowForm.windows?.[0] ?? EMPTY_WIN,
    windowForm.windows?.[1] ?? EMPTY_WIN,
  ];

  const saveWindowMutation = useMutation({
    mutationFn: async (form: AvailabilityWindow) => {
      await apiRequest("POST", "/api/system-config/availability_window", {
        value: JSON.stringify(form),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system-config/availability_window"] });
      toast({ title: "開放設定已儲存" });
    },
    onError: () => {
      toast({ title: "儲存失敗", variant: "destructive" });
    },
  });

  const saveHolidayMutation = useMutation({
    mutationFn: async (dates: string[]) => {
      let existing: Record<string, string[]> = {};
      try { existing = holidayConfigData?.value ? JSON.parse(holidayConfigData.value) : {}; } catch {}
      existing[windowForm.targetYearMonth] = dates;
      await apiRequest("POST", "/api/system-config/monthly_holidays", { value: JSON.stringify(existing) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system-config/monthly_holidays"] });
      toast({ title: "休館日已儲存" });
    },
    onError: () => toast({ title: "儲存失敗", variant: "destructive" }),
  });

  function toggleHoliday(dateStr: string) {
    setHolidaySet(prev => {
      const next = new Set(prev);
      if (next.has(dateStr)) next.delete(dateStr); else next.add(dateStr);
      return next;
    });
  }

  const monthDates = useMemo(() => {
    const [y, m] = viewYearMonth.split("-").map(Number);
    const start = startOfMonth(new Date(y, m - 1, 1));
    const end = endOfMonth(start);
    return eachDayOfInterval({ start, end });
  }, [viewYearMonth]);

  const availByEmpDate = useMemo(() => {
    const map = new Map<string, ShiftAvailability[]>();
    availabilities.forEach(a => {
      const key = `${a.employeeId}-${a.date}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    });
    return map;
  }, [availabilities]);

  function prevMonth() {
    const [y, m] = viewYearMonth.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    setViewYearMonth(format(d, "yyyy-MM"));
  }

  function nextMonth() {
    const [y, m] = viewYearMonth.split("-").map(Number);
    const d = new Date(y, m, 1);
    setViewYearMonth(format(d, "yyyy-MM"));
  }

  const COL_WIDTH = 52;
  const EMP_COL_WIDTH = 90;

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      <div className="flex items-center gap-3">
        <CalendarDays className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">排班意願管理</h1>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Settings className="h-4 w-4" />
            意願填寫開放設定
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
              <div className="space-y-1">
                <Label className="text-xs">目標填寫月份</Label>
                <Input
                  type="month"
                  value={windowForm.targetYearMonth}
                  onChange={e => setWindowForm(prev => ({ ...prev, targetYearMonth: e.target.value }))}
                  className="h-8 text-sm"
                  data-testid="input-target-year-month"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">第一段 開放開始</Label>
                <Input
                  type="date"
                  value={safeWindows[0].openFrom}
                  onChange={e => updateWindow(0, "openFrom", e.target.value)}
                  className="h-8 text-sm"
                  data-testid="input-open-from-1"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">第一段 開放截止</Label>
                <Input
                  type="date"
                  value={safeWindows[0].openUntil}
                  onChange={e => updateWindow(0, "openUntil", e.target.value)}
                  className="h-8 text-sm"
                  data-testid="input-open-until-1"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
              <div className="flex items-center">
                <span className="text-[11px] text-muted-foreground">第二段（選填）</span>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">第二段 開放開始</Label>
                <Input
                  type="date"
                  value={safeWindows[1].openFrom}
                  onChange={e => updateWindow(1, "openFrom", e.target.value)}
                  className="h-8 text-sm"
                  data-testid="input-open-from-2"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">第二段 開放截止</Label>
                <Input
                  type="date"
                  value={safeWindows[1].openUntil}
                  onChange={e => updateWindow(1, "openUntil", e.target.value)}
                  className="h-8 text-sm"
                  data-testid="input-open-until-2"
                />
              </div>
            </div>
          </div>
          <Button
            size="sm"
            className="mt-3 h-8 text-xs gap-1.5"
            onClick={() => saveWindowMutation.mutate(windowForm)}
            disabled={saveWindowMutation.isPending}
            data-testid="button-save-window"
          >
            <Save className="h-3.5 w-3.5" />
            儲存設定
          </Button>
          <p className="text-[11px] text-muted-foreground mt-2">
            員工僅可在「開放期間」內，透過員工入口填寫「{windowForm.targetYearMonth}」的排班意願。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <CalendarOff className="h-4 w-4" />
            國定假日／休館日設定
            <span className="text-xs font-normal text-muted-foreground ml-1">（{windowForm.targetYearMonth}）</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-[11px] text-muted-foreground mb-3">
            點擊日期標記為休館日，員工當日無法填寫排班意願。紅色為已選休館日。
          </p>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {holidayMonthDates.map(d => {
              const dateStr = format(d, "yyyy-MM-dd");
              const isHol = holidaySet.has(dateStr);
              const isWeekend = d.getDay() === 0 || d.getDay() === 6;
              return (
                <button
                  key={dateStr}
                  onClick={() => toggleHoliday(dateStr)}
                  className={`px-2 py-1 rounded-md text-xs font-medium border transition-all ${
                    isHol
                      ? "bg-red-500 border-red-500 text-white"
                      : isWeekend
                      ? "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100"
                      : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                  data-testid={`button-holiday-${dateStr}`}
                >
                  {d.getDate()}
                  {["日", "一", "二", "三", "四", "五", "六"][d.getDay()]}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => saveHolidayMutation.mutate(Array.from(holidaySet))}
              disabled={saveHolidayMutation.isPending}
              data-testid="button-save-holidays"
            >
              <Save className="h-3.5 w-3.5" />
              儲存休館日
            </Button>
            {holidaySet.size > 0 && (
              <span className="text-[11px] text-muted-foreground">
                已選 <span className="font-semibold text-red-600">{holidaySet.size}</span> 天休館日
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <button className="p-1 rounded-md hover:bg-muted transition-colors" onClick={prevMonth} data-testid="button-prev-month">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="font-semibold text-sm font-mono" data-testid="text-view-month">
              {format(new Date(viewYearMonth + "-01"), "yyyy年 M月", { locale: zhTW })} 意願彙整
            </span>
            <button className="p-1 rounded-md hover:bg-muted transition-colors" onClick={nextMonth} data-testid="button-next-month">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <RegionTabs />
        </div>

        {(empLoading || availLoading) ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : activeEmployees.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">此區域無員工資料</div>
        ) : (
          <div
            className="border rounded-lg overflow-auto"
            style={{
              WebkitOverflowScrolling: "touch",
              touchAction: "pan-x pan-y",
              overscrollBehavior: "contain",
              maxHeight: "65vh",
            }}
          >
            <table className="border-collapse text-xs" style={{ minWidth: "max-content" }}>
              <thead>
                <tr>
                  <th className="sticky top-0 left-0 z-30 bg-muted/95 backdrop-blur-sm px-2 py-2 text-left font-semibold border-b border-r" style={{ minWidth: EMP_COL_WIDTH, width: EMP_COL_WIDTH }}>
                    員工
                  </th>
                  {monthDates.map((d, i) => {
                    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                    return (
                      <th key={i}
                        className={`sticky top-0 z-20 border-b border-r px-1 py-1 text-center font-medium backdrop-blur-sm ${isWeekend ? "bg-amber-50/95 dark:bg-amber-950/80" : "bg-muted/95"}`}
                        style={{ minWidth: COL_WIDTH, width: COL_WIDTH }}>
                        <div className="text-[10px] text-muted-foreground">{DAY_NAMES[d.getDay()]}</div>
                        <div>{d.getDate()}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {activeEmployees.map(emp => (
                  <tr key={emp.id} className="hover:bg-muted/20">
                    <td className="sticky left-0 z-10 bg-background px-2 py-1 border-b border-r font-medium whitespace-nowrap" style={{ minWidth: EMP_COL_WIDTH }}>
                      <div className="flex items-center gap-1">
                        <span className={`text-[9px] px-1 py-0 rounded font-bold shrink-0 ${emp.employmentType === "part_time" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
                          {emp.employmentType === "part_time" ? "兼" : "正"}
                        </span>
                        <div className="text-[11px] font-semibold truncate" title={emp.name}>{emp.name}</div>
                      </div>
                    </td>
                    {monthDates.map((d, i) => {
                      const dateStr = format(d, "yyyy-MM-dd");
                      const slots = availByEmpDate.get(`${emp.id}-${dateStr}`) || [];
                      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                      return (
                        <td key={i} className={`border-b border-r px-0.5 py-0.5 align-top ${isWeekend ? "bg-amber-50/50 dark:bg-amber-950/10" : ""}`}
                          style={{ minWidth: COL_WIDTH }} data-testid={`avail-cell-${emp.id}-${dateStr}`}>
                          {slots.length > 0 ? (
                            <div className="space-y-0.5">
                              {slots.map(s => (
                                s.entryType === "off_request" ? (
                                  <div key={s.id} className={`rounded px-1 py-0.5 text-[10px] leading-tight font-bold text-center border ${s.note === "特休" ? "bg-orange-100 border-orange-200 text-orange-700 dark:bg-orange-900/40 dark:border-orange-700 dark:text-orange-300" : s.note === "事假" ? "bg-blue-100 border-blue-200 text-blue-700 dark:bg-blue-900/40 dark:border-blue-700 dark:text-blue-300" : "bg-red-100 border-red-200 text-red-700 dark:bg-red-900/40 dark:border-red-700 dark:text-red-300"}`}>
                                    {s.note || "休"}
                                  </div>
                                ) : (
                                  <div key={s.id} className="rounded bg-purple-100 dark:bg-purple-900/40 border border-purple-200 dark:border-purple-700 px-1 py-0.5 text-[10px] text-purple-700 dark:text-purple-300 leading-tight">
                                    {s.startTime ? s.startTime.slice(0, 5) : ""}–{s.endTime ? s.endTime.slice(0, 5) : ""}
                                  </div>
                                )
                              ))}
                            </div>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center gap-4 text-[11px] text-muted-foreground flex-wrap">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-purple-100 border border-purple-200" />
            <span>紫色：可上班時段（兼職）</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-red-100 border border-red-200" />
            <span>紅色「休」：希望休假（正職）</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] px-1 py-0 rounded font-bold bg-amber-100 text-amber-700">兼</span>
            <span>兼職</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] px-1 py-0 rounded font-bold bg-blue-100 text-blue-700">正</span>
            <span>正職</span>
          </div>
        </div>
      </div>
    </div>
  );
}
