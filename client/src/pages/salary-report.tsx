import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, ChevronLeft, ChevronRight, Clock, Users, TrendingUp, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

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
  資訊班: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300",
  守望: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
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
  overtimeHours: number;
};

type HoursReport = {
  year: number;
  month: number;
  workRoles: string[];
  leaveTypes: string[];
  employees: EmpStats[];
  hasOvertimeData: boolean;
};

function exportCSV(report: HoursReport, regionLabel: string) {
  const { year, month, workRoles, leaveTypes, employees } = report;

  const hasOT = report.hasOvertimeData;
  const headers = [
    "員工代號", "姓名", "地區",
    ...workRoles.map(r => `${r}(時數)`),
    ...(hasOT ? ["加班(時數)"] : []),
    "總工時",
    ...leaveTypes.map(l => `${l}(天)`),
    "假別合計",
    "排班次數",
  ];

  const rows = employees.map(e => [
    e.employeeCode,
    e.name,
    e.region,
    ...workRoles.map(r => (e.hours[r] || 0).toFixed(1)),
    ...(hasOT ? [e.overtimeHours.toFixed(1)] : []),
    e.totalWorkHours.toFixed(1),
    ...leaveTypes.map(l => e.leaves[l] || 0),
    e.totalLeaveDays,
    e.shiftCount,
  ]);

  const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
  const bom = "\uFEFF";
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `工時總表_${year}年${month}月_${regionLabel}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function SalaryReportPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() === 0 ? 12 : now.getMonth());
  const [regionCode, setRegionCode] = useState("all");
  const [sortKey, setSortKey] = useState<"name" | "hours" | "region">("region");

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

  const { data, isLoading, error } = useQuery<HoursReport>({
    queryKey: ["/api/salary-report", year, month, regionCode],
    queryFn: async () => {
      const res = await fetch(`/api/salary-report?${queryParams}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const sortedEmployees = useMemo(() => {
    if (!data) return [];
    return [...data.employees].sort((a, b) => {
      if (sortKey === "hours") return b.totalWorkHours - a.totalWorkHours;
      if (sortKey === "name") return a.name.localeCompare(b.name, "zh-Hant");
      return a.region.localeCompare(b.region) || a.name.localeCompare(b.name, "zh-Hant");
    });
  }, [data, sortKey]);

  const totalHours = useMemo(() => data?.employees.reduce((s, e) => s + e.totalWorkHours, 0) || 0, [data]);
  const totalPersons = data?.employees.length || 0;
  const avgHours = totalPersons > 0 ? Math.round(totalHours / totalPersons * 10) / 10 : 0;
  const totalShifts = useMemo(() => data?.employees.reduce((s, e) => s + e.shiftCount, 0) || 0, [data]);

  const regionLabel = REGION_OPTIONS.find(r => r.value === regionCode)?.label || "全部";
  const monthLabel = `${year}年${month}月`;

  const roleColTotals = useMemo(() => {
    if (!data) return {} as Record<string, number>;
    const totals: Record<string, number> = {};
    for (const e of data.employees) {
      for (const r of data.workRoles) {
        totals[r] = Math.round(((totals[r] || 0) + (e.hours[r] || 0)) * 10) / 10;
      }
    }
    return totals;
  }, [data]);

  const totalOvertimeHours = useMemo(() => data?.employees.reduce((s, e) => Math.round((s + e.overtimeHours) * 10) / 10, 0) || 0, [data]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-none p-4 border-b bg-background">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold">工時總表</h1>
            <p className="text-sm text-muted-foreground">統計當月各員工各班別實際計薪工時（已套用場館扣時規則）</p>
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
                <SelectItem value="name">依姓名</SelectItem>
              </SelectContent>
            </Select>
            {data && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => exportCSV(data, regionLabel)}
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
        <Card className="border-0 bg-orange-50 dark:bg-orange-950/30">
          <CardContent className="p-3 flex items-center gap-3">
            <FileText className="h-5 w-5 text-orange-500 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">排班次數</p>
              <p className="text-xl font-bold text-orange-600 dark:text-orange-400" data-testid="stat-total-shifts">
                {isLoading ? <Skeleton className="h-5 w-16 inline-block" /> : totalShifts}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

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
                  {data.workRoles.map(r => (
                    <th key={r} className="text-right px-3 py-2.5 font-semibold text-xs text-muted-foreground min-w-[72px]">
                      {r}
                    </th>
                  ))}
                  {data.hasOvertimeData && (
                    <th className="text-right px-3 py-2.5 font-semibold text-xs text-red-600 dark:text-red-400 min-w-[72px] bg-red-50/50 dark:bg-red-950/20">
                      加班
                    </th>
                  )}
                  <th className="text-right px-3 py-2.5 font-semibold text-xs text-blue-600 dark:text-blue-400 min-w-[72px] bg-blue-50/50 dark:bg-blue-950/20">
                    總工時
                  </th>
                  {data.leaveTypes.map(l => (
                    <th key={l} className="text-right px-3 py-2.5 font-semibold text-xs text-muted-foreground min-w-[56px]">
                      {l}<br /><span className="font-normal opacity-70">(天)</span>
                    </th>
                  ))}
                  {data.leaveTypes.length > 0 && (
                    <th className="text-right px-3 py-2.5 font-semibold text-xs text-amber-600 dark:text-amber-400 min-w-[56px] bg-amber-50/50 dark:bg-amber-950/20">
                      假別計
                    </th>
                  )}
                  <th className="text-right px-3 py-2.5 font-semibold text-xs text-muted-foreground min-w-[52px]">次數</th>
                </tr>
              </thead>
              <tbody>
                {sortedEmployees.map((emp, idx) => (
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
                      const colorClass = ROLE_COLORS[r] || "bg-gray-100 text-gray-800";
                      return (
                        <td key={r} className="px-3 py-2 text-right" data-testid={`cell-hours-${emp.id}-${r}`}>
                          {hrs > 0 ? (
                            <Badge variant="secondary" className={`text-xs font-mono ${colorClass} border-0`}>
                              {hrs.toFixed(1)}h
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground/30 text-xs">—</span>
                          )}
                        </td>
                      );
                    })}
                    {data.hasOvertimeData && (
                      <td className="px-3 py-2 text-right bg-red-50/30 dark:bg-red-950/10" data-testid={`cell-overtime-${emp.id}`}>
                        {emp.overtimeHours > 0 ? (
                          <Badge variant="secondary" className="text-xs font-mono bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-0">
                            {emp.overtimeHours.toFixed(1)}h
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground/30 text-xs">—</span>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right bg-blue-50/30 dark:bg-blue-950/10">
                      <span className="font-bold text-blue-600 dark:text-blue-400 font-mono text-sm" data-testid={`cell-total-hours-${emp.id}`}>
                        {emp.totalWorkHours.toFixed(1)}h
                      </span>
                    </td>
                    {data.leaveTypes.map(l => (
                      <td key={l} className="px-3 py-2 text-right">
                        {(emp.leaves[l] || 0) > 0 ? (
                          <span className="text-xs font-medium text-amber-600 dark:text-amber-400">{emp.leaves[l]}天</span>
                        ) : (
                          <span className="text-muted-foreground/30 text-xs">—</span>
                        )}
                      </td>
                    ))}
                    {data.leaveTypes.length > 0 && (
                      <td className="px-3 py-2 text-right bg-amber-50/30 dark:bg-amber-950/10">
                        <span className="font-medium text-amber-600 dark:text-amber-400 text-xs">
                          {emp.totalLeaveDays > 0 ? `${emp.totalLeaveDays}天` : "—"}
                        </span>
                      </td>
                    )}
                    <td className="px-3 py-2 text-right">
                      <span className="text-xs text-muted-foreground">{emp.shiftCount}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 bg-muted/30 font-semibold">
                  <td className="px-3 py-2.5 text-xs sticky left-0 bg-muted/30" colSpan={2}>合計</td>
                  {data.workRoles.map(r => (
                    <td key={r} className="px-3 py-2.5 text-right text-xs font-mono text-muted-foreground">
                      {(roleColTotals[r] || 0).toFixed(1)}h
                    </td>
                  ))}
                  {data.hasOvertimeData && (
                    <td className="px-3 py-2.5 text-right bg-red-50/50 dark:bg-red-950/20">
                      <span className="font-bold text-red-600 dark:text-red-400 font-mono text-xs">
                        {totalOvertimeHours.toFixed(1)}h
                      </span>
                    </td>
                  )}
                  <td className="px-3 py-2.5 text-right bg-blue-50/50 dark:bg-blue-950/20">
                    <span className="font-bold text-blue-600 dark:text-blue-400 font-mono text-sm">
                      {totalHours.toFixed(1)}h
                    </span>
                  </td>
                  {data.leaveTypes.map(l => (
                    <td key={l} className="px-3 py-2.5 text-right text-xs text-muted-foreground">
                      {data.employees.reduce((s, e) => s + (e.leaves[l] || 0), 0)}天
                    </td>
                  ))}
                  {data.leaveTypes.length > 0 && (
                    <td className="px-3 py-2.5 text-right bg-amber-50/50 dark:bg-amber-950/20">
                      <span className="font-medium text-amber-600 dark:text-amber-400 text-xs">
                        {data.employees.reduce((s, e) => s + e.totalLeaveDays, 0)}天
                      </span>
                    </td>
                  )}
                  <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">{totalShifts}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
