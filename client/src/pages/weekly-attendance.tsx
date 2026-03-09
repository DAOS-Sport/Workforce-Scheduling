import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, startOfWeek, addDays, subDays } from "date-fns";
import { zhTW } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Send, Loader2, CheckCircle2, AlertTriangle, XCircle, MinusCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface DayData {
  date: string;
  status: "on_time" | "late" | "early_leave" | "missing_clock" | "anomaly" | "leave" | "no_shift";
  leaveType?: string;
  shifts: Array<{ startTime: string; endTime: string; role: string; venueId: number; venueName: string }>;
  clockIns: Array<{ time: string; status: string; venue: string; failReason?: string }>;
  clockOuts: Array<{ time: string; status: string; venue: string }>;
}

interface EmployeeWeek {
  id: number;
  name: string;
  employeeCode: string;
  lineId: string | null;
  regionId: number;
  days: DayData[];
}

interface WeeklyData {
  weekStart: string;
  weekEnd: string;
  dates: string[];
  employees: EmployeeWeek[];
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle2; bgClass: string }> = {
  on_time: { label: "準時", color: "text-green-600 dark:text-green-400", icon: CheckCircle2, bgClass: "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800" },
  late: { label: "遲到", color: "text-amber-600 dark:text-amber-400", icon: AlertTriangle, bgClass: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800" },
  early_leave: { label: "早退", color: "text-orange-600 dark:text-orange-400", icon: AlertTriangle, bgClass: "bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800" },
  missing_clock: { label: "未打卡", color: "text-red-600 dark:text-red-400", icon: XCircle, bgClass: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800" },
  anomaly: { label: "異常", color: "text-red-600 dark:text-red-400", icon: XCircle, bgClass: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800" },
  leave: { label: "休假", color: "text-yellow-600 dark:text-yellow-400", icon: MinusCircle, bgClass: "bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800" },
  no_shift: { label: "無班", color: "text-muted-foreground", icon: MinusCircle, bgClass: "" },
};

const DAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];

export default function WeeklyAttendancePage() {
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const getLastMonday = () => {
    const now = new Date();
    const monday = startOfWeek(now, { weekStartsOn: 1 });
    return subDays(monday, 7);
  };

  const [currentWeekStart, setCurrentWeekStart] = useState(() => getLastMonday());

  const weekStartStr = format(currentWeekStart, "yyyy-MM-dd");

  const { data, isLoading, isError, refetch } = useQuery<WeeklyData>({
    queryKey: ["/api/weekly-attendance", weekStartStr],
  });

  const notifyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/weekly-attendance/notify", { weekStart: weekStartStr });
      return res.json();
    },
    onSuccess: (result: any) => {
      toast({ title: "通知已發送", description: result.message });
      setConfirmOpen(false);
    },
    onError: (err: any) => {
      toast({ title: "發送失敗", description: err.message, variant: "destructive" });
    },
  });

  const stats = useMemo(() => {
    if (!data?.employees) return { total: 0, perfect: 0, anomaly: 0, missing: 0, late: 0 };
    let perfect = 0;
    let anomalyCount = 0;
    let missingCount = 0;
    let lateCount = 0;

    for (const emp of data.employees) {
      let hasProblem = false;
      for (const day of emp.days) {
        if (day.status === "missing_clock") { missingCount++; hasProblem = true; }
        if (day.status === "late") { lateCount++; hasProblem = true; }
        if (day.status === "early_leave" || day.status === "anomaly") { anomalyCount++; hasProblem = true; }
      }
      if (!hasProblem) perfect++;
    }

    return { total: data.employees.length, perfect, anomaly: anomalyCount, missing: missingCount, late: lateCount };
  }, [data]);

  const weekEndDate = addDays(currentWeekStart, 6);
  const displayRange = `${format(currentWeekStart, "M/d", { locale: zhTW })} ~ ${format(weekEndDate, "M/d", { locale: zhTW })}`;

  return (
    <div className="h-full overflow-auto p-4 space-y-4" data-testid="weekly-attendance-page">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-bold" data-testid="text-page-title">週報打卡狀況</h1>
          <p className="text-sm text-muted-foreground">查看排班人員每週打卡紀錄</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentWeekStart(prev => subDays(prev, 7))}
            data-testid="button-prev-week"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium min-w-[120px] text-center" data-testid="text-week-range">
            {displayRange}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentWeekStart(prev => addDays(prev, 7))}
            data-testid="button-next-week"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            onClick={() => setConfirmOpen(true)}
            className="ml-2"
            data-testid="button-send-notify"
          >
            <Send className="h-4 w-4 mr-1" />
            群發通知
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card data-testid="card-stat-total">
          <CardContent className="p-3">
            <div className="text-2xl font-bold" data-testid="text-stat-total">{stats.total}</div>
            <div className="text-xs text-muted-foreground">排班人數</div>
          </CardContent>
        </Card>
        <Card data-testid="card-stat-perfect">
          <CardContent className="p-3">
            <div className="text-2xl font-bold text-green-600" data-testid="text-stat-perfect">{stats.perfect}</div>
            <div className="text-xs text-muted-foreground">全勤人數</div>
          </CardContent>
        </Card>
        <Card data-testid="card-stat-missing">
          <CardContent className="p-3">
            <div className="text-2xl font-bold text-red-600" data-testid="text-stat-missing">{stats.missing}</div>
            <div className="text-xs text-muted-foreground">未打卡次數</div>
          </CardContent>
        </Card>
        <Card data-testid="card-stat-late">
          <CardContent className="p-3">
            <div className="text-2xl font-bold text-amber-600" data-testid="text-stat-late">{stats.late}</div>
            <div className="text-xs text-muted-foreground">遲到次數</div>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="text-center py-20 space-y-3" data-testid="text-error">
          <p className="text-destructive font-medium">載入資料失敗</p>
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-retry">
            重試
          </Button>
        </div>
      ) : !data?.employees?.length ? (
        <div className="text-center py-20 text-muted-foreground" data-testid="text-no-data">
          該週無排班資料
        </div>
      ) : (
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-sm" data-testid="table-weekly">
            <thead>
              <tr className="bg-muted/50">
                <th className="text-left p-2 font-medium sticky left-0 bg-muted/50 z-10 min-w-[100px]">員工</th>
                {data.dates.map((date) => {
                  const d = new Date(date + "T00:00:00Z");
                  const dayName = DAY_NAMES[d.getUTCDay()];
                  const isWeekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
                  return (
                    <th
                      key={date}
                      className={`text-center p-2 font-medium min-w-[110px] ${isWeekend ? "text-red-500" : ""}`}
                      data-testid={`header-date-${date}`}
                    >
                      <div>{format(d, "M/d")}</div>
                      <div className="text-xs">({dayName})</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {data.employees.map((emp) => (
                <tr key={emp.id} className="border-t hover:bg-muted/20" data-testid={`row-employee-${emp.id}`}>
                  <td className="p-2 sticky left-0 bg-background z-10">
                    <div className="font-medium text-xs" data-testid={`text-employee-name-${emp.id}`}>{emp.name}</div>
                    <div className="text-[10px] text-muted-foreground">{emp.employeeCode}</div>
                  </td>
                  {emp.days.map((day) => {
                    const config = STATUS_CONFIG[day.status] || STATUS_CONFIG.no_shift;
                    const Icon = config.icon;

                    return (
                      <td key={day.date} className="p-1 text-center" data-testid={`cell-${emp.id}-${day.date}`}>
                        {day.status === "no_shift" ? (
                          <div className="text-muted-foreground/40 text-xs">—</div>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className={`rounded border p-1.5 cursor-default ${config.bgClass}`}>
                                <div className="flex items-center justify-center gap-0.5">
                                  <Icon className={`h-3 w-3 ${config.color}`} />
                                  <span className={`text-[10px] font-medium ${config.color}`}>
                                    {day.status === "leave" ? (day.leaveType || "休假") : config.label}
                                  </span>
                                </div>
                                {day.shifts.length > 0 && day.status !== "leave" && (
                                  <div className="text-[9px] text-muted-foreground mt-0.5">
                                    {day.shifts[0].venueName} {day.shifts[0].startTime.substring(0, 5)}-{day.shifts[0].endTime.substring(0, 5)}
                                  </div>
                                )}
                                {day.clockIns.length > 0 && (
                                  <div className="text-[9px] mt-0.5 flex items-center justify-center gap-0.5">
                                    <Clock className="h-2.5 w-2.5" />
                                    {day.clockIns[0].time}
                                  </div>
                                )}
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-[250px]">
                              <div className="space-y-1 text-xs">
                                {day.shifts.map((s, i) => (
                                  <div key={i}>
                                    <span className="font-medium">{s.venueName}</span> {s.startTime.substring(0, 5)}-{s.endTime.substring(0, 5)} [{s.role}]
                                  </div>
                                ))}
                                {day.clockIns.length > 0 && (
                                  <div className="border-t pt-1 mt-1">
                                    {day.clockIns.map((c, i) => (
                                      <div key={i}>
                                        打卡: {c.time} ({c.status}) {c.venue} {c.failReason && `— ${c.failReason}`}
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {day.clockOuts.length > 0 && (
                                  <div>
                                    {day.clockOuts.map((c, i) => (
                                      <div key={i}>
                                        下班: {c.time} ({c.status}) {c.venue}
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {day.status === "missing_clock" && (
                                  <div className="text-red-500 font-medium">未打卡</div>
                                )}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent data-testid="dialog-confirm-notify">
          <DialogHeader>
            <DialogTitle>確認群發通知</DialogTitle>
            <DialogDescription>
              將發送 {displayRange} 的打卡狀況通知：
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant="outline">LINE</Badge>
              <span>推播個人打卡摘要給每位有排班的員工</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">Email</Badge>
              <span>發送全員彙總報表給管理員</span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              如有異常狀況，將提醒員工盡速回報。
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} data-testid="button-cancel-notify">
              取消
            </Button>
            <Button
              onClick={() => notifyMutation.mutate()}
              disabled={notifyMutation.isPending}
              data-testid="button-confirm-notify"
            >
              {notifyMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  發送中...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-1" />
                  確認發送
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
