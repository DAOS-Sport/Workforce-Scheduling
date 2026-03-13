import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Download, ChevronLeft, ChevronRight, Clock, Users, TrendingUp, FileText, Save, Pencil, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const REGION_OPTIONS = [
  { value: "all", label: "全部地區" },
  { value: "sanMi", label: "三蘆戰區" },
  { value: "songShan", label: "松山國小" },
  { value: "hsinChu", label: "新竹區" },
  { value: "internal", label: "內勤" },
];

const ROLE_COLORS: Record<string, string> = {
  救生: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  教練: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  指導員: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  PT: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  行政: "bg-gray-100 text-gray-800 dark:bg-gray-900/40 dark:text-gray-300",
  櫃台: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
};

type EmpStats = {
  id: number;
  name: string;
  employeeCode: string;
  region: string;
  hours: Record<string, number>;
  leaves: Record<string, number>;
  totalWorkHours: number;
  totalLeaveDays: number;
  shiftCount: number;
};

type SalaryReport = {
  year: number;
  month: number;
  workRoles: string[];
  leaveTypes: string[];
  employees: EmpStats[];
};

type SalaryRateConfig = {
  id: number;
  role: string;
  ratePerHour: number;
  label: string | null;
};

function calcSalary(emp: EmpStats, rates: Record<string, number>, workRoles: string[]): number {
  return workRoles.reduce((sum, role) => {
    const hrs = emp.hours[role] || 0;
    const rate = rates[role] || 0;
    return sum + hrs * rate;
  }, 0);
}

function exportCSV(report: SalaryReport, rates: Record<string, number>, regionLabel: string) {
  const { year, month, workRoles, leaveTypes, employees } = report;

  const headers = [
    "員工代號", "姓名", "地區",
    ...workRoles.map(r => `${r}(時數)`),
    "總工時",
    ...workRoles.filter(r => rates[r] > 0).map(r => `${r}(${rates[r]}元/時)`),
    "薪資小計",
    ...leaveTypes.map(l => `${l}(天)`),
    "假日合計",
    "排班次數",
  ];

  const rows = employees.map(e => {
    const salary = calcSalary(e, rates, workRoles);
    return [
      e.employeeCode,
      e.name,
      e.region,
      ...workRoles.map(r => (e.hours[r] || 0).toFixed(1)),
      e.totalWorkHours.toFixed(1),
      ...workRoles.filter(r => rates[r] > 0).map(r => {
        const hrs = e.hours[r] || 0;
        const rate = rates[r];
        return (hrs * rate).toFixed(0);
      }),
      salary.toFixed(0),
      ...leaveTypes.map(l => e.leaves[l] || 0),
      e.totalLeaveDays,
      e.shiftCount,
    ];
  });

  const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
  const bom = "\uFEFF";
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `薪資時數報表_${year}年${month}月_${regionLabel}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function SalaryReportPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() === 0 ? 12 : now.getMonth());
  const [regionCode, setRegionCode] = useState("all");
  const [sortKey, setSortKey] = useState<"name" | "hours" | "region" | "salary">("region");
  const [localRates, setLocalRates] = useState<Record<string, string>>({});
  const [editingRates, setEditingRates] = useState(false);
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const { toast } = useToast();

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  const queryParams = new URLSearchParams({ year: String(year), month: String(month) });
  if (regionCode !== "all") queryParams.set("regionCode", regionCode);

  const { data, isLoading, error } = useQuery<SalaryReport>({
    queryKey: ["/api/salary-report", year, month, regionCode],
    queryFn: async () => {
      const res = await fetch(`/api/salary-report?${queryParams}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const { data: savedRates } = useQuery<SalaryRateConfig[]>({
    queryKey: ["/api/salary-rates"],
    queryFn: async () => {
      const res = await fetch("/api/salary-rates", { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  useEffect(() => {
    if (!savedRates) return;
    const map: Record<string, string> = {};
    savedRates.forEach(r => { map[r.role] = String(r.ratePerHour); });
    setLocalRates(prev => {
      const next = { ...map };
      Object.keys(prev).forEach(k => {
        if (prev[k] !== "") next[k] = prev[k];
      });
      return next;
    });
  }, [savedRates]);

  const upsertRate = useMutation({
    mutationFn: async ({ role, ratePerHour }: { role: string; ratePerHour: number }) => {
      const res = await apiRequest("POST", "/api/salary-rates", { role, ratePerHour });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/salary-rates"] });
    },
    onError: (err: Error) => {
      toast({ title: "儲存費率失敗", description: err.message, variant: "destructive" });
    },
  });

  const effectiveRates = useMemo((): Record<string, number> => {
    const map: Record<string, number> = {};
    (savedRates || []).forEach(r => { map[r.role] = r.ratePerHour; });
    Object.entries(localRates).forEach(([role, val]) => {
      const n = parseFloat(val);
      if (!isNaN(n)) map[role] = n;
    });
    return map;
  }, [savedRates, localRates]);

  const handleRateChange = useCallback((role: string, value: string) => {
    setLocalRates(prev => ({ ...prev, [role]: value }));
    clearTimeout(debounceTimers.current[role]);
    debounceTimers.current[role] = setTimeout(() => {
      const n = parseFloat(value);
      if (!isNaN(n) && n >= 0) {
        upsertRate.mutate({ role, ratePerHour: n });
      }
    }, 800);
  }, [upsertRate]);

  const hasAnyRate = Object.values(effectiveRates).some(v => v > 0);

  const sortedEmployees = useMemo(() => {
    if (!data) return [];
    return [...data.employees].sort((a, b) => {
      if (sortKey === "hours") return b.totalWorkHours - a.totalWorkHours;
      if (sortKey === "salary") return calcSalary(b, effectiveRates, data.workRoles) - calcSalary(a, effectiveRates, data.workRoles);
      if (sortKey === "name") return a.name.localeCompare(b.name, "zh-Hant");
      return a.region.localeCompare(b.region) || a.name.localeCompare(b.name, "zh-Hant");
    });
  }, [data, sortKey, effectiveRates]);

  const totalHours = useMemo(() => data?.employees.reduce((s, e) => s + e.totalWorkHours, 0) || 0, [data]);
  const totalPersons = data?.employees.length || 0;
  const avgHours = totalPersons > 0 ? Math.round(totalHours / totalPersons * 10) / 10 : 0;
  const totalShifts = useMemo(() => data?.employees.reduce((s, e) => s + e.shiftCount, 0) || 0, [data]);
  const totalSalary = useMemo(() => {
    if (!data) return 0;
    return data.employees.reduce((sum, e) => sum + calcSalary(e, effectiveRates, data.workRoles), 0);
  }, [data, effectiveRates]);

  const regionLabel = REGION_OPTIONS.find(r => r.value === regionCode)?.label || "全部";
  const monthLabel = `${year}年${month}月`;

  const saveAllRates = () => {
    if (!data) return;
    data.workRoles.forEach(role => {
      const val = localRates[role];
      const n = parseFloat(val || "0");
      if (!isNaN(n)) upsertRate.mutate({ role, ratePerHour: n });
    });
    toast({ title: "費率已儲存" });
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-none p-4 border-b bg-background">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold">薪資時數報表</h1>
            <p className="text-sm text-muted-foreground">統計當月各員工班別工時，填入各班別時薪後自動計算薪資</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 border rounded-lg overflow-hidden">
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none" onClick={prevMonth} data-testid="button-prev-month">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-semibold px-2 min-w-[80px] text-center" data-testid="text-month-label">{monthLabel}</span>
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none" onClick={nextMonth} data-testid="button-next-month">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <Select value={regionCode} onValueChange={setRegionCode}>
              <SelectTrigger className="h-8 w-36 text-sm" data-testid="select-region">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REGION_OPTIONS.map(r => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sortKey} onValueChange={(v) => setSortKey(v as typeof sortKey)}>
              <SelectTrigger className="h-8 w-28 text-sm" data-testid="select-sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="region">依地區</SelectItem>
                <SelectItem value="hours">依工時</SelectItem>
                <SelectItem value="salary">依薪資</SelectItem>
                <SelectItem value="name">依姓名</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant={editingRates ? "default" : "outline"}
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => setEditingRates(e => !e)}
              data-testid="button-toggle-rate-edit"
            >
              <Pencil className="h-3.5 w-3.5" />
              {editingRates ? "完成編輯" : "設定時薪"}
            </Button>
            {data && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => exportCSV(data, effectiveRates, regionLabel)}
                data-testid="button-export-csv"
              >
                <Download className="h-3.5 w-3.5" />
                匯出 CSV
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-none px-4 pt-3 pb-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-0 bg-blue-50 dark:bg-blue-950/30">
          <CardContent className="p-3 flex items-center gap-3">
            <Users className="h-5 w-5 text-blue-500 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">排班人數</p>
              <p className="text-xl font-bold text-blue-600 dark:text-blue-400" data-testid="stat-total-persons">
                {isLoading ? <Skeleton className="h-5 w-10 inline-block" /> : totalPersons}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 bg-green-50 dark:bg-green-950/30">
          <CardContent className="p-3 flex items-center gap-3">
            <Clock className="h-5 w-5 text-green-500 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">總工時</p>
              <p className="text-xl font-bold text-green-600 dark:text-green-400" data-testid="stat-total-hours">
                {isLoading ? <Skeleton className="h-5 w-16 inline-block" /> : `${totalHours.toFixed(1)}h`}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 bg-purple-50 dark:bg-purple-950/30">
          <CardContent className="p-3 flex items-center gap-3">
            <TrendingUp className="h-5 w-5 text-purple-500 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">人均工時</p>
              <p className="text-xl font-bold text-purple-600 dark:text-purple-400" data-testid="stat-avg-hours">
                {isLoading ? <Skeleton className="h-5 w-16 inline-block" /> : `${avgHours}h`}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className={`border-0 ${hasAnyRate ? "bg-emerald-50 dark:bg-emerald-950/30" : "bg-orange-50 dark:bg-orange-950/30"}`}>
          <CardContent className="p-3 flex items-center gap-3">
            <FileText className={`h-5 w-5 shrink-0 ${hasAnyRate ? "text-emerald-500" : "text-orange-500"}`} />
            <div>
              <p className="text-xs text-muted-foreground">{hasAnyRate ? "薪資總計" : "排班次數"}</p>
              <p className={`text-xl font-bold ${hasAnyRate ? "text-emerald-600 dark:text-emerald-400" : "text-orange-600 dark:text-orange-400"}`} data-testid="stat-total-salary">
                {isLoading ? <Skeleton className="h-5 w-16 inline-block" /> :
                  hasAnyRate ? `$${totalSalary.toLocaleString()}` : totalShifts
                }
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {editingRates && data && data.workRoles.length > 0 && (
        <div className="flex-none mx-4 mb-3 p-3 rounded-xl border border-dashed border-primary/40 bg-primary/5">
          <div className="flex items-center gap-2 mb-2.5">
            <Pencil className="h-3.5 w-3.5 text-primary" />
            <span className="text-sm font-semibold text-primary">設定各班別時薪</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="right">
                <p className="text-xs">填入時薪後系統自動計算：工時 × 時薪 = 薪資小計<br />設定值會自動儲存至資料庫</p>
              </TooltipContent>
            </Tooltip>
            <Button size="sm" variant="outline" className="ml-auto h-7 gap-1 text-xs" onClick={saveAllRates} data-testid="button-save-all-rates">
              <Save className="h-3 w-3" />
              全部儲存
            </Button>
          </div>
          <div className="flex flex-wrap gap-3">
            {data.workRoles.map(role => {
              const colorClass = ROLE_COLORS[role] || "bg-gray-100 text-gray-800";
              return (
                <div key={role} className="flex items-center gap-2">
                  <Badge variant="secondary" className={`text-xs ${colorClass} border-0 whitespace-nowrap`}>{role}</Badge>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={localRates[role] ?? (effectiveRates[role] || "")}
                      onChange={e => handleRateChange(role, e.target.value)}
                      placeholder="時薪"
                      className="h-7 w-24 text-sm font-mono"
                      data-testid={`input-rate-${role}`}
                    />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">元/時</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto px-4 pb-4">
        {isLoading ? (
          <div className="space-y-2 mt-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
            <p>載入失敗，請重試</p>
          </div>
        ) : !data || data.employees.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
            <FileText className="h-10 w-10 opacity-30" />
            <p className="text-sm">{monthLabel} 尚無排班資料</p>
          </div>
        ) : (
          <div className="rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="text-left px-3 py-2.5 font-semibold text-xs text-muted-foreground sticky left-0 bg-muted/50 min-w-[110px]">員工</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-xs text-muted-foreground min-w-[80px]">地區</th>
                  {data.workRoles.map(r => {
                    const rate = effectiveRates[r] || 0;
                    return (
                      <th key={r} className="text-right px-3 py-2.5 font-semibold text-xs text-muted-foreground min-w-[80px]">
                        <div>{r}</div>
                        <div className="font-normal text-[10px] opacity-70">
                          {rate > 0 ? `${rate}元/時` : "(時數)"}
                        </div>
                      </th>
                    );
                  })}
                  <th className="text-right px-3 py-2.5 font-semibold text-xs text-blue-600 dark:text-blue-400 min-w-[72px] bg-blue-50/50 dark:bg-blue-950/20">
                    總工時
                  </th>
                  {hasAnyRate && (
                    <th className="text-right px-3 py-2.5 font-semibold text-xs text-emerald-600 dark:text-emerald-400 min-w-[90px] bg-emerald-50/50 dark:bg-emerald-950/20">
                      薪資小計
                    </th>
                  )}
                  {data.leaveTypes.map(l => (
                    <th key={l} className="text-right px-3 py-2.5 font-semibold text-xs text-muted-foreground min-w-[64px]">
                      {l}<br /><span className="font-normal opacity-70">(天)</span>
                    </th>
                  ))}
                  {data.leaveTypes.length > 0 && (
                    <th className="text-right px-3 py-2.5 font-semibold text-xs text-orange-600 dark:text-orange-400 min-w-[64px] bg-orange-50/50 dark:bg-orange-950/20">
                      假日計
                    </th>
                  )}
                  <th className="text-right px-3 py-2.5 font-semibold text-xs text-muted-foreground min-w-[60px]">次數</th>
                </tr>
              </thead>
              <tbody>
                {sortedEmployees.map((emp, idx) => {
                  const salary = calcSalary(emp, effectiveRates, data.workRoles);
                  return (
                    <tr
                      key={emp.id}
                      className={`border-b last:border-0 hover:bg-muted/30 transition-colors ${idx % 2 === 0 ? "" : "bg-muted/10"}`}
                      data-testid={`row-employee-${emp.id}`}
                    >
                      <td className="px-3 py-2 sticky left-0 bg-background">
                        <div className="font-medium truncate max-w-[100px]" title={emp.name}>{emp.name}</div>
                        <div className="text-[10px] text-muted-foreground">{emp.employeeCode}</div>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-xs text-muted-foreground">{emp.region}</span>
                      </td>
                      {data.workRoles.map(r => {
                        const hrs = emp.hours[r] || 0;
                        const rate = effectiveRates[r] || 0;
                        const colorClass = ROLE_COLORS[r] || "bg-gray-100 text-gray-800";
                        return (
                          <td key={r} className="px-3 py-2 text-right" data-testid={`cell-hours-${emp.id}-${r}`}>
                            {hrs > 0 ? (
                              <div className="flex flex-col items-end gap-0.5">
                                <Badge variant="secondary" className={`text-xs font-mono ${colorClass} border-0`}>
                                  {hrs.toFixed(1)}h
                                </Badge>
                                {rate > 0 && (
                                  <span className="text-[10px] text-muted-foreground font-mono">
                                    ${(hrs * rate).toLocaleString()}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground/40 text-xs">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-right bg-blue-50/30 dark:bg-blue-950/10">
                        <span className="font-bold text-blue-600 dark:text-blue-400 font-mono text-sm" data-testid={`cell-total-hours-${emp.id}`}>
                          {emp.totalWorkHours.toFixed(1)}h
                        </span>
                      </td>
                      {hasAnyRate && (
                        <td className="px-3 py-2 text-right bg-emerald-50/30 dark:bg-emerald-950/10">
                          <span className="font-bold text-emerald-600 dark:text-emerald-400 font-mono text-sm" data-testid={`cell-salary-${emp.id}`}>
                            ${salary.toLocaleString()}
                          </span>
                        </td>
                      )}
                      {data.leaveTypes.map(l => (
                        <td key={l} className="px-3 py-2 text-right">
                          {(emp.leaves[l] || 0) > 0 ? (
                            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">{emp.leaves[l]}天</span>
                          ) : (
                            <span className="text-muted-foreground/40 text-xs">—</span>
                          )}
                        </td>
                      ))}
                      {data.leaveTypes.length > 0 && (
                        <td className="px-3 py-2 text-right bg-orange-50/30 dark:bg-orange-950/10">
                          {emp.totalLeaveDays > 0 ? (
                            <span className="font-semibold text-orange-600 dark:text-orange-400 text-sm">{emp.totalLeaveDays}天</span>
                          ) : (
                            <span className="text-muted-foreground/40 text-xs">—</span>
                          )}
                        </td>
                      )}
                      <td className="px-3 py-2 text-right text-muted-foreground text-xs">
                        {emp.shiftCount}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-muted/60 border-t-2 font-semibold">
                  <td className="px-3 py-2.5 text-sm sticky left-0 bg-muted/60">合計</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{totalPersons} 人</td>
                  {data.workRoles.map(r => {
                    const total = data.employees.reduce((s, e) => s + (e.hours[r] || 0), 0);
                    const rate = effectiveRates[r] || 0;
                    const totalPay = total * rate;
                    return (
                      <td key={r} className="px-3 py-2.5 text-right">
                        <div className="text-sm font-mono">{total > 0 ? `${total.toFixed(1)}h` : "—"}</div>
                        {rate > 0 && total > 0 && (
                          <div className="text-[10px] text-muted-foreground font-mono">${totalPay.toLocaleString()}</div>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2.5 text-right text-blue-600 dark:text-blue-400 font-bold font-mono text-sm bg-blue-50/30 dark:bg-blue-950/10">
                    {totalHours.toFixed(1)}h
                  </td>
                  {hasAnyRate && (
                    <td className="px-3 py-2.5 text-right text-emerald-600 dark:text-emerald-400 font-bold font-mono text-sm bg-emerald-50/30 dark:bg-emerald-950/10">
                      ${totalSalary.toLocaleString()}
                    </td>
                  )}
                  {data.leaveTypes.map(l => {
                    const total = data.employees.reduce((s, e) => s + (e.leaves[l] || 0), 0);
                    return (
                      <td key={l} className="px-3 py-2.5 text-right text-sm">
                        {total > 0 ? `${total}天` : "—"}
                      </td>
                    );
                  })}
                  {data.leaveTypes.length > 0 && (
                    <td className="px-3 py-2.5 text-right text-orange-600 dark:text-orange-400 font-bold text-sm bg-orange-50/30 dark:bg-orange-950/10">
                      {data.employees.reduce((s, e) => s + e.totalLeaveDays, 0)}天
                    </td>
                  )}
                  <td className="px-3 py-2.5 text-right text-sm">{totalShifts}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
