import { useQuery } from "@tanstack/react-query";
import { format, startOfWeek, addDays, startOfMonth, endOfMonth } from "date-fns";
import { zhTW } from "date-fns/locale";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RegionTabs } from "@/components/region-tabs";
import { useRegion } from "@/lib/region-context";
import { Users, Building2, Calendar, AlertTriangle, CheckCircle2, Clock, Shield, TrendingUp, Zap } from "lucide-react";
import type { Employee, Venue, Shift, ScheduleSlot } from "@shared/schema";
import { useMemo } from "react";

function CircularProgress({ value, max, size = 56, strokeWidth = 5, color = "hsl(var(--primary))" }: { value: number; max: number; size?: number; strokeWidth?: number; color?: string }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const percentage = max > 0 ? Math.min(value / max, 1) : 0;
  const offset = circumference - percentage * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth={strokeWidth} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth} strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" className="transition-all duration-700 ease-out" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xs font-bold">{max > 0 ? Math.round(percentage * 100) : 0}%</span>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { activeRegion } = useRegion();

  const weekStart = useMemo(() => startOfWeek(new Date(), { weekStartsOn: 1 }), []);
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const dateRange = useMemo(() => ({ start: format(weekDates[0], "yyyy-MM-dd"), end: format(weekDates[6], "yyyy-MM-dd") }), [weekDates]);

  const monthRange = useMemo(() => {
    const now = new Date();
    return { start: format(startOfMonth(now), "yyyy-MM-dd"), end: format(endOfMonth(now), "yyyy-MM-dd") };
  }, []);

  const { data: employees = [], isLoading: empLoading } = useQuery<Employee[]>({ queryKey: ["/api/employees", activeRegion] });
  const { data: venues = [], isLoading: venLoading } = useQuery<Venue[]>({ queryKey: ["/api/venues", activeRegion] });
  const { data: shifts = [], isLoading: shiftLoading } = useQuery<Shift[]>({ queryKey: ["/api/shifts", activeRegion, dateRange.start, dateRange.end] });
  const { data: monthSlots = [] } = useQuery<ScheduleSlot[]>({ queryKey: ["/api/schedule-slots", activeRegion, monthRange.start, monthRange.end] });
  const { data: monthShifts = [] } = useQuery<Shift[]>({ queryKey: ["/api/shifts", activeRegion, monthRange.start, monthRange.end] });

  const activeCount = employees.filter((e) => e.status === "active").length;
  const totalShifts = shifts.length;
  const dispatchShifts = shifts.filter((s) => s.isDispatch).length;
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const todayShifts = shifts.filter((s) => s.date === todayStr);
  const isLoading = empLoading || venLoading || shiftLoading;

  const filledSlots = useMemo(() => {
    let filled = 0;
    let total = 0;
    monthSlots.forEach((slot) => {
      const slotShifts = monthShifts.filter((sh) => sh.venueId === slot.venueId && sh.date === slot.date && sh.startTime.substring(0, 5) <= slot.startTime && sh.endTime.substring(0, 5) >= slot.endTime);
      total += slot.requiredCount;
      filled += Math.min(slotShifts.length, slot.requiredCount);
    });
    return { filled, total };
  }, [monthSlots, monthShifts]);

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-5 border-b border-border/50">
        <div>
          <h1 className="text-xl font-bold tracking-tight" data-testid="text-dashboard-title">排班總覽</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {format(new Date(), "yyyy年 M月 d日 EEEE", { locale: zhTW })}
          </p>
        </div>
        <RegionTabs />
      </div>

      <div className="p-5 space-y-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "在職員工", value: activeCount, total: employees.length, icon: Users, color: "#3B82F6", ringColor: "hsl(217 91% 60%)" },
            { label: "管轄場館", value: venues.length, total: venues.length, icon: Building2, color: "#10B981", ringColor: "hsl(160 84% 39%)" },
            { label: "本週排班", value: totalShifts, total: Math.max(totalShifts, activeCount * 5), subtitle: dispatchShifts > 0 ? `含 ${dispatchShifts} 派遣` : undefined, icon: Calendar, color: "#8B5CF6", ringColor: "hsl(258 90% 66%)" },
            { label: "今日出勤", value: todayShifts.length, total: activeCount, subtitle: todayShifts.filter((s) => s.isDispatch).length > 0 ? `${todayShifts.filter((s) => s.isDispatch).length} 派遣` : undefined, icon: Clock, color: "#F59E0B", ringColor: "hsl(38 92% 50%)" },
          ].map((stat, i) => (
            <Card key={stat.label} className="p-4 rounded-xl shadow-md border-border/50 animate-fade-in-up" style={{ animationDelay: `${i * 80}ms` }}>
              <div className="flex items-center justify-between gap-2">
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{stat.label}</p>
                  {isLoading ? (
                    <Skeleton className="h-8 w-14" />
                  ) : (
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-bold animate-count-up" data-testid={`text-stat-${stat.label}`}>{stat.value}</span>
                      {stat.total !== stat.value && <span className="text-xs text-muted-foreground">/ {stat.total}</span>}
                    </div>
                  )}
                  {stat.subtitle && <p className="text-[11px] text-muted-foreground">{stat.subtitle}</p>}
                </div>
                <CircularProgress value={stat.value} max={stat.total} color={stat.ringColor} />
              </div>
            </Card>
          ))}
        </div>

        <Card className="p-5 rounded-xl shadow-md border-border/50">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-primary/10">
                <TrendingUp className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">本月人力達成率</h3>
                <p className="text-xs text-muted-foreground">需求 vs 實際排班</p>
              </div>
            </div>
            <CircularProgress value={filledSlots.filled} max={filledSlots.total} size={64} strokeWidth={6} color="hsl(160 84% 39%)" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <div className="text-lg font-bold text-primary">{filledSlots.total}</div>
              <div className="text-[11px] text-muted-foreground">需求人次</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <div className="text-lg font-bold text-green-500">{filledSlots.filled}</div>
              <div className="text-[11px] text-muted-foreground">已排人次</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <div className={`text-lg font-bold ${filledSlots.total - filledSlots.filled > 0 ? "text-red-500" : "text-green-500"}`}>{filledSlots.total - filledSlots.filled}</div>
              <div className="text-[11px] text-muted-foreground">缺口人次</div>
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-5 rounded-xl shadow-md border-border/50">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="p-2 rounded-lg bg-green-500/10">
                <Shield className="h-4 w-4 text-green-500" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">勞基法合規引擎</h3>
                <Badge className="text-[10px] bg-green-500/10 text-green-500 hover:bg-green-500/20 border-0">HR Eye</Badge>
              </div>
            </div>
            <div className="space-y-2">
              {[
                { rule: "七休一攔截", desc: "連續 6 天後自動阻斷第 7 天排班" },
                { rule: "單日 12h 上限", desc: "跨館跨時段即時加總工時" },
                { rule: "11h 輪班間隔", desc: "檢核前日下班與今日上班休息時間" },
                { rule: "在職狀態檢核", desc: "離職員工即時從排班選單移除" },
              ].map((item) => (
                <div key={item.rule} className="flex items-center gap-3 rounded-lg p-3 bg-green-500/5 border border-green-500/10">
                  <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                  <div>
                    <span className="text-sm font-medium">{item.rule}</span>
                    <span className="text-xs text-muted-foreground ml-2">{item.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5 rounded-xl shadow-md border-border/50">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="p-2 rounded-lg bg-primary/10">
                <Zap className="h-4 w-4 text-primary" />
              </div>
              <h3 className="font-semibold text-sm">今日排班明細</h3>
            </div>
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-lg" />
                ))}
              </div>
            ) : todayShifts.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground text-sm">
                <Calendar className="h-8 w-8 mx-auto mb-2 opacity-30" />
                今日無排班記錄
              </div>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-auto">
                {todayShifts.map((s, i) => {
                  const emp = employees.find((e) => e.id === s.employeeId);
                  const venue = venues.find((v) => v.id === s.venueId);
                  return (
                    <div
                      key={s.id}
                      className={`flex items-center justify-between gap-2 rounded-lg p-3 text-sm animate-fade-in-up ${
                        s.isDispatch
                          ? "bg-amber-500/5 border border-amber-500/20"
                          : "bg-muted/30 border border-border/50"
                      }`}
                      style={{ animationDelay: `${i * 50}ms` }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`h-2 w-2 rounded-full shrink-0 ${s.isDispatch ? "bg-amber-500" : "bg-primary"}`} />
                        <span className="font-medium truncate">{emp?.name || "—"}</span>
                        {s.isDispatch && (
                          <Badge className="text-[10px] bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border-0 shrink-0">
                            派遣
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground shrink-0">
                        <span className="text-xs font-medium">{venue?.shortName}</span>
                        <span className="text-xs">{s.startTime.substring(0, 5)}-{s.endTime.substring(0, 5)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
