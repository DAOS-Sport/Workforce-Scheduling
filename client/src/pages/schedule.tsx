import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval } from "date-fns";
import { zhTW } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RegionTabs } from "@/components/region-tabs";
import { ShiftCellEditor } from "@/components/shift-cell-editor";
import { useRegion } from "@/lib/region-context";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, ChevronRight, CalendarDays, Plus, ChevronUp, ChevronDown, Check, AlertCircle } from "lucide-react";
import type { Employee, Venue, Shift, VenueRequirement } from "@shared/schema";

const DAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];

interface VenueDaySummary {
  venueId: number;
  venueName: string;
  dateStr: string;
  totalShortage: number;
  details: { timeSlot: string; required: number; assigned: number; shortage: number }[];
}

export default function SchedulePage() {
  const { activeRegion } = useRegion();
  const { toast } = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedShift, setSelectedShift] = useState<Shift | undefined>();
  const [drawerOpen, setDrawerOpen] = useState(false);

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

  const { data: employees = [], isLoading: empLoading } = useQuery<Employee[]>({
    queryKey: ["/api/employees", activeRegion],
  });

  const { data: venues = [], isLoading: venLoading } = useQuery<Venue[]>({
    queryKey: ["/api/venues", activeRegion],
  });

  const { data: shifts = [], isLoading: shiftLoading } = useQuery<Shift[]>({
    queryKey: ["/api/shifts", activeRegion, dateRange.start, dateRange.end],
  });

  const { data: requirements = [] } = useQuery<VenueRequirement[]>({
    queryKey: ["/api/venue-requirements", activeRegion],
  });

  const activeEmployees = useMemo(
    () => employees.filter((e) => e.status === "active"),
    [employees]
  );

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

  const venueSummaryMap = useMemo(() => {
    const map = new Map<string, VenueDaySummary>();
    monthDates.forEach((d) => {
      const dateStr = format(d, "yyyy-MM-dd");
      const dayOfWeek = d.getDay();
      const dayReqs = requirements.filter((r) => r.dayOfWeek === dayOfWeek);
      dayReqs.forEach((req) => {
        const venue = venueMap.get(req.venueId);
        if (!venue) return;
        const assignedCount = shifts.filter(
          (s) =>
            s.date === dateStr &&
            s.venueId === req.venueId &&
            s.startTime <= req.startTime &&
            s.endTime >= req.endTime
        ).length;
        const shortage = req.requiredCount - assignedCount;
        const key = `${req.venueId}-${dateStr}`;
        if (!map.has(key)) {
          map.set(key, {
            venueId: req.venueId,
            venueName: venue.shortName,
            dateStr,
            totalShortage: 0,
            details: [],
          });
        }
        const entry = map.get(key)!;
        entry.totalShortage += Math.max(0, shortage);
        entry.details.push({
          timeSlot: `${req.startTime.substring(0, 5)}-${req.endTime.substring(0, 5)}`,
          required: req.requiredCount,
          assigned: assignedCount,
          shortage,
        });
      });
    });
    return map;
  }, [monthDates, requirements, shifts, venueMap]);

  const summaryVenues = useMemo(() => {
    const ids = new Set<number>();
    requirements.forEach((r) => ids.add(r.venueId));
    return venues.filter((v) => ids.has(v.id));
  }, [venues, requirements]);

  const totalShortageCount = useMemo(() => {
    let total = 0;
    venueSummaryMap.forEach((s) => { total += s.totalShortage; });
    return total;
  }, [venueSummaryMap]);

  const detailedVacancies = useMemo(() => {
    const result: { venueName: string; date: string; timeSlot: string; shortage: number }[] = [];
    venueSummaryMap.forEach((s) => {
      s.details.forEach((d) => {
        if (d.shortage > 0) {
          result.push({
            venueName: s.venueName,
            date: s.dateStr,
            timeSlot: d.timeSlot,
            shortage: d.shortage,
          });
        }
      });
    });
    return result;
  }, [venueSummaryMap]);

  const createShift = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/shifts", data);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      if (data.warnings && data.warnings.length > 0) {
        toast({ title: "排班已儲存（含警告）", description: data.warnings[0].message, variant: "destructive" });
      } else {
        toast({ title: "排班已儲存" });
      }
    },
    onError: (err: Error) => {
      toast({ title: "排班失敗", description: err.message, variant: "destructive" });
    },
  });

  const updateShift = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const res = await apiRequest("PATCH", `/api/shifts/${id}`, data);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      if (data.warnings && data.warnings.length > 0) {
        toast({ title: "排班已更新（含警告）", description: data.warnings[0].message, variant: "destructive" });
      } else {
        toast({ title: "排班已更新" });
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
      toast({ title: "排班已刪除" });
    },
  });

  const handleCellClick = (employee: Employee, dateStr: string, shift?: Shift) => {
    setSelectedEmployee(employee);
    setSelectedDate(dateStr);
    setSelectedShift(shift);
    setEditorOpen(true);
  };

  const handleSaveShift = (data: any) => {
    if (selectedShift) {
      updateShift.mutate({ id: selectedShift.id, ...data, employeeId: selectedEmployee!.id, date: selectedDate });
    } else {
      createShift.mutate({ ...data, employeeId: selectedEmployee!.id, date: selectedDate });
    }
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

  const isLoading = empLoading || venLoading || shiftLoading;

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 border-b">
        <div>
          <h1 className="text-lg font-semibold" data-testid="text-page-title">排班編輯器</h1>
          <p className="text-sm text-muted-foreground">智慧試算表排班 — 即時勞基法攔截</p>
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
                onSelect={(d) => {
                  if (d) setCurrentMonth(startOfMonth(d));
                }}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col relative">
        <div className="flex-1 overflow-auto" ref={scrollRef}>
          <table className="border-collapse text-sm" style={{ minWidth: `${130 + monthDates.length * 100}px` }}>
            <thead className="sticky top-0 z-20">
              <tr>
                <th
                  className="text-left p-2 border-b border-r font-medium text-muted-foreground bg-background sticky left-0 z-30"
                  style={{ minWidth: 130, width: 130 }}
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
                        isToday
                          ? "bg-primary/5"
                          : isWeekend
                            ? "bg-muted/30"
                            : "bg-background"
                      }`}
                      style={{ minWidth: 100, width: 100 }}
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
              {!isLoading && summaryVenues.length > 0 && summaryVenues.map((venue) => (
                <tr key={`summary-${venue.id}`} className="bg-muted/10">
                  <td
                    className="px-2 py-1 border-b border-r text-xs font-medium text-muted-foreground bg-muted/20 sticky left-0 z-30 whitespace-nowrap"
                    style={{ minWidth: 130, width: 130 }}
                    data-testid={`summary-venue-label-${venue.id}`}
                  >
                    {venue.shortName}
                  </td>
                  {monthDates.map((d, di) => {
                    const dateStr = format(d, "yyyy-MM-dd");
                    const key = `${venue.id}-${dateStr}`;
                    const summary = venueSummaryMap.get(key);
                    const isToday = dateStr === format(new Date(), "yyyy-MM-dd");
                    const isWeekend = d.getDay() === 0 || d.getDay() === 6;

                    if (!summary) {
                      return (
                        <td
                          key={di}
                          className={`border-b border-r text-center ${
                            isToday ? "bg-primary/5" : isWeekend ? "bg-muted/15" : "bg-muted/10"
                          }`}
                          style={{ minWidth: 100, width: 100 }}
                        >
                          <span className="text-[10px] text-muted-foreground/40">—</span>
                        </td>
                      );
                    }

                    const hasShortage = summary.totalShortage > 0;
                    return (
                      <td
                        key={di}
                        className={`border-b border-r text-center ${
                          isToday ? "bg-primary/5" : isWeekend ? "bg-muted/15" : "bg-muted/10"
                        }`}
                        style={{ minWidth: 100, width: 100 }}
                        data-testid={`summary-cell-${venue.id}-${dateStr}`}
                      >
                        <Popover>
                          <PopoverTrigger asChild>
                            <button className="flex items-center justify-center w-full py-0.5 cursor-pointer">
                              {hasShortage ? (
                                <span className="text-xs font-bold text-red-600 dark:text-red-400" data-testid={`shortage-${venue.id}-${dateStr}`}>
                                  -{summary.totalShortage}
                                </span>
                              ) : (
                                <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" data-testid={`full-${venue.id}-${dateStr}`} />
                              )}
                            </button>
                          </PopoverTrigger>
                          <PopoverContent side="bottom" className="w-auto min-w-[160px] p-3" align="center">
                            <div className="text-xs space-y-1.5">
                              <div className="font-medium">{venue.shortName} — {format(d, "M/d")}</div>
                              {summary.details.map((det, idx) => (
                                <div key={idx} className="flex items-center justify-between gap-3">
                                  <span className="text-muted-foreground">{det.timeSlot}</span>
                                  <span className={det.shortage > 0 ? "text-red-500 font-medium" : "text-green-500"}>
                                    {det.shortage > 0 ? `缺${det.shortage}人` : "滿"}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </PopoverContent>
                        </Popover>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td className="p-2 border-b border-r sticky left-0 bg-background z-[5]" style={{ minWidth: 130 }}>
                      <Skeleton className="h-5 w-20" />
                    </td>
                    {Array.from({ length: Math.min(monthDates.length, 15) }).map((_, j) => (
                      <td key={j} className="p-1 border-b border-r" style={{ minWidth: 100 }}>
                        <Skeleton className="h-8 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : activeEmployees.length === 0 ? (
                <tr>
                  <td colSpan={monthDates.length + 1} className="text-center py-12 text-muted-foreground">
                    此區域尚無在職員工
                  </td>
                </tr>
              ) : (
                activeEmployees.map((emp) => (
                  <tr key={emp.id} className="group">
                    <td
                      className="p-2 border-b border-r sticky left-0 bg-background z-[5]"
                      style={{ minWidth: 130, width: 130 }}
                    >
                      <div className="flex flex-col">
                        <span className="font-medium text-sm whitespace-nowrap" data-testid={`text-employee-name-${emp.id}`}>
                          {emp.name}
                        </span>
                        <span className="text-xs text-muted-foreground">{emp.employeeCode}</span>
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
                          className={`p-0.5 border-b border-r relative cursor-pointer transition-colors hover:bg-muted/50 align-top ${
                            isToday ? "bg-primary/5" : isWeekend ? "bg-muted/20" : ""
                          }`}
                          style={{ minWidth: 100, width: 100 }}
                          onClick={() => {
                            if (cellShifts.length === 0) {
                              handleCellClick(emp, dateStr);
                            }
                          }}
                          data-testid={`cell-${emp.id}-${dateStr}`}
                        >
                          {cellShifts.length > 0 ? (
                            <div className="space-y-0.5">
                              {cellShifts.map((s) => {
                                const venue = venueMap.get(s.venueId);
                                return (
                                  <div
                                    key={s.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCellClick(emp, dateStr, s);
                                    }}
                                    className={`rounded px-1 py-0.5 text-xs cursor-pointer transition-colors ${
                                      s.isDispatch
                                        ? "bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-200 border border-orange-200 dark:border-orange-800"
                                        : "bg-primary/10 text-primary border border-primary/20"
                                    }`}
                                    data-testid={`shift-${s.id}`}
                                  >
                                    <div className="font-medium truncate text-[11px] leading-tight">
                                      {venue?.shortName || "未知"}
                                    </div>
                                    <div className="text-[10px] opacity-75 leading-tight">
                                      {s.startTime.substring(0, 5)}-{s.endTime.substring(0, 5)}
                                    </div>
                                    {s.isDispatch && (
                                      <div className="text-[9px] opacity-60 truncate leading-tight">
                                        派遣{s.dispatchName ? `：${s.dispatchName}` : ""}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="flex items-center justify-center h-[36px] opacity-0 group-hover:opacity-30 transition-opacity">
                              <Plus className="h-3 w-3" />
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))
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
              {totalShortageCount > 0 ? (
                <>
                  <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                  <span>缺班明細 — 共 {totalShortageCount} 個缺口</span>
                </>
              ) : (
                <>
                  <Check className="h-3.5 w-3.5 text-green-500" />
                  <span>本月所有時段人力已滿</span>
                </>
              )}
            </div>
            {drawerOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </button>
          {drawerOpen && detailedVacancies.length > 0 && (
            <div className="px-4 pb-3 overflow-auto max-h-[160px]">
              <div className="flex flex-wrap gap-1.5">
                {detailedVacancies.map((v, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-2 py-1 text-xs"
                    data-testid={`vacancy-detail-${i}`}
                  >
                    <span className="text-red-700 dark:text-red-300 font-medium">{v.venueName}</span>
                    <span className="text-muted-foreground">{format(new Date(v.date), "M/d")}</span>
                    <span className="text-muted-foreground">{v.timeSlot}</span>
                    <span className="text-red-600 dark:text-red-400 font-bold">缺{v.shortage}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {selectedEmployee && (
        <ShiftCellEditor
          open={editorOpen}
          onOpenChange={setEditorOpen}
          employee={selectedEmployee}
          date={selectedDate}
          venues={venues}
          existingShifts={shifts}
          currentShift={selectedShift}
          onSave={handleSaveShift}
          onDelete={
            selectedShift
              ? () => deleteShift.mutate(selectedShift.id)
              : undefined
          }
        />
      )}
    </div>
  );
}
