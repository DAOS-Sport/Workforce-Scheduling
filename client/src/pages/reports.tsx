import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth, endOfMonth, subMonths, addMonths } from "date-fns";
import { zhTW } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  FileSpreadsheet, ChevronLeft, ChevronRight, Download, Search,
  CheckCircle, XCircle, AlertTriangle, Clock, MapPin, Filter,
  UserX, UserCheck, Timer,
} from "lucide-react";
import * as XLSX from "xlsx";

interface Venue {
  id: number;
  name: string;
  shortName: string;
}

interface ReportClockRecord {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  venueId: number | null;
  venueName: string;
  clockType: string;
  clockTime: string;
  status: string;
  distance: number | null;
  failReason: string | null;
  matchedVenueName: string | null;
  latitude: number;
  longitude: number;
}

interface ClockAmendment {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  clockType: string;
  requestedTime: string;
  reason: string;
  status: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

interface OvertimeRequest {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
  status: string;
  source: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

interface AnomalyRow {
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  date: string;
  shiftStart: string;
  shiftEnd: string;
  venueName: string;
  anomalyType: "遲到" | "缺打卡上班" | "缺打卡下班" | "早退";
  anomalyMinutes: number | null;
  clockTime: string | null;
  amendmentStatus: "approved" | "pending" | "rejected" | null;
  amendmentTime: string | null;
  isResolved: boolean;
}

function getTaiwanToday(): string {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTaiwanDateTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatTaiwanDate(iso: string): string {
  return new Date(iso).toLocaleDateString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function isoToTaiwanDateStr(iso: string): string {
  const d = new Date(iso);
  const taipei = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  return `${taipei.getFullYear()}-${String(taipei.getMonth() + 1).padStart(2, "0")}-${String(taipei.getDate()).padStart(2, "0")}`;
}

function statusLabel(status: string): string {
  if (status === "success") return "成功";
  if (status === "fail") return "失敗";
  if (status === "warning") return "無排班";
  return status;
}

function reviewStatusLabel(status: string): string {
  if (status === "pending") return "待審核";
  if (status === "approved") return "已核准";
  if (status === "rejected") return "已拒絕";
  return status;
}

function clockTypeLabel(ct: string): string {
  return ct === "in" ? "上班" : "下班";
}

function sourceLabel(s: string): string {
  if (s === "manual") return "手動";
  if (s === "auto") return "自動";
  return s;
}

function parseFailReason(failReason: string | null): { note: string; minutes: number | null } {
  if (!failReason) return { note: "", minutes: null };

  const withHoursAndMins = (prefix: string, noteLabel: string) => {
    const reHM = new RegExp(`^${prefix}\\s*(\\d+)\\s*小時\\s*(\\d+)\\s*分鐘`);
    const reH = new RegExp(`^${prefix}\\s*(\\d+)\\s*小時`);
    const reM = new RegExp(`^${prefix}\\s*(\\d+)\\s*分鐘`);
    let m = failReason.match(reHM);
    if (m) return { note: noteLabel, minutes: parseInt(m[1]) * 60 + parseInt(m[2]) };
    m = failReason.match(reH);
    if (m) return { note: noteLabel, minutes: parseInt(m[1]) * 60 };
    m = failReason.match(reM);
    if (m) return { note: noteLabel, minutes: parseInt(m[1]) };
    return null;
  };

  let result = withHoursAndMins("遲到", "遲到");
  if (result) return result;

  result = withHoursAndMins("提早", "提早到");
  if (result) return result;

  result = withHoursAndMins("晚下班", "晚下班");
  if (result) return result;

  if (failReason === "今日無排班") return { note: "今日無排班", minutes: null };
  if (failReason.includes("不在任何場館範圍內")) return { note: "不在任何場館範圍內", minutes: null };

  return { note: failReason, minutes: null };
}

export default function ReportsPage() {
  const { toast } = useToast();
  const today = getTaiwanToday();
  const [activeTab, setActiveTab] = useState<"clock" | "anomaly">("clock");
  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date(today);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [useCustomRange, setUseCustomRange] = useState(false);
  const [customStart, setCustomStart] = useState(today);
  const [customEnd, setCustomEnd] = useState(today);
  const [filterName, setFilterName] = useState("");
  const [filterCode, setFilterCode] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterClockType, setFilterClockType] = useState("all");
  const [filterVenueId, setFilterVenueId] = useState("all");
  const [exporting, setExporting] = useState(false);
  const [anomalyFilterName, setAnomalyFilterName] = useState("");
  const [anomalyFilterType, setAnomalyFilterType] = useState("all");
  const [anomalyFilterStatus, setAnomalyFilterStatus] = useState("all");

  const startDate = useCustomRange
    ? customStart
    : format(startOfMonth(currentMonth), "yyyy-MM-dd");
  const endDate = useCustomRange
    ? customEnd
    : format(endOfMonth(currentMonth), "yyyy-MM-dd");

  const monthLabel = format(currentMonth, "yyyy 年 M 月", { locale: zhTW });
  const yearMonth = format(currentMonth, "yyyy-MM");

  const { data: venues = [] } = useQuery<Venue[]>({
    queryKey: ["/api/venues-all"],
  });

  const queryParams = new URLSearchParams({
    startDate,
    endDate,
    ...(filterStatus !== "all" && { status: filterStatus }),
    ...(filterClockType !== "all" && { clockType: filterClockType }),
    ...(filterVenueId !== "all" && { venueId: filterVenueId }),
    ...(filterName.trim() && { employeeName: filterName.trim() }),
    ...(filterCode.trim() && { employeeCode: filterCode.trim() }),
  });

  const { data: records = [], isLoading } = useQuery<ReportClockRecord[]>({
    queryKey: ["/api/reports/clock-records", startDate, endDate, filterStatus, filterClockType, filterVenueId, filterName, filterCode],
    queryFn: async () => {
      const res = await fetch(`/api/reports/clock-records?${queryParams}`);
      if (!res.ok) throw new Error("載入失敗");
      return res.json();
    },
  });

  const { data: rawAnomalies = [], isLoading: anomalyLoading } = useQuery<AnomalyRow[]>({
    queryKey: ["/api/reports/anomalies", yearMonth],
    queryFn: async () => {
      const res = await fetch(`/api/reports/anomalies?yearMonth=${yearMonth}`);
      if (!res.ok) throw new Error("載入失敗");
      return res.json();
    },
    enabled: activeTab === "anomaly",
    staleTime: 2 * 60 * 1000,
  });

  const anomalies = useMemo(() => {
    let rows = rawAnomalies;
    if (anomalyFilterName.trim()) {
      const q = anomalyFilterName.trim().toLowerCase();
      rows = rows.filter(r => r.employeeName.includes(q) || r.employeeCode.toLowerCase().includes(q));
    }
    if (anomalyFilterType !== "all") rows = rows.filter(r => r.anomalyType === anomalyFilterType);
    if (anomalyFilterStatus === "resolved") rows = rows.filter(r => r.isResolved);
    if (anomalyFilterStatus === "unresolved") rows = rows.filter(r => !r.isResolved);
    if (anomalyFilterStatus === "pending") rows = rows.filter(r => r.amendmentStatus === "pending");
    return rows;
  }, [rawAnomalies, anomalyFilterName, anomalyFilterType, anomalyFilterStatus]);

  const successCount = useMemo(() => records.filter((r) => r.status === "success").length, [records]);
  const failCount = useMemo(() => records.filter((r) => r.status === "fail").length, [records]);
  const warningCount = useMemo(() => records.filter((r) => r.status === "warning").length, [records]);
  const inCount = useMemo(() => records.filter((r) => r.clockType === "in").length, [records]);
  const outCount = useMemo(() => records.filter((r) => r.clockType === "out").length, [records]);

  async function handleExportExcel() {
    setExporting(true);
    try {
      const wb = XLSX.utils.book_new();

      const clockRows = records.map((r) => {
        const { note, minutes } = parseFailReason(r.failReason);
        return {
          "員工姓名": r.employeeName,
          "員工編號": r.employeeCode,
          "日期": formatTaiwanDate(r.clockTime),
          "打卡時間": formatTaiwanDateTime(r.clockTime),
          "打卡類型": clockTypeLabel(r.clockType),
          "場館": r.venueName || r.matchedVenueName || "—",
          "打卡狀態": statusLabel(r.status),
          "距離(m)": r.distance !== null ? Math.round(r.distance) : "",
          "備註": note,
          "分鐘數": minutes !== null ? minutes : "",
        };
      });
      const ws1 = XLSX.utils.json_to_sheet(clockRows);
      ws1["!cols"] = [
        { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 22 }, { wch: 10 },
        { wch: 18 }, { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 8 },
      ];
      XLSX.utils.book_append_sheet(wb, ws1, "打卡記錄");

      const [amendRes, overtimeRes] = await Promise.all([
        fetch("/api/clock-amendments"),
        fetch("/api/overtime-requests"),
      ]);
      if (!amendRes.ok || !overtimeRes.ok) {
        toast({ title: "匯出警告", description: "補打卡或加班申請資料載入失敗，相關分頁可能不完整", variant: "destructive" });
      }
      const allAmendments: ClockAmendment[] = amendRes.ok ? await amendRes.json() : [];
      const allOvertimes: OvertimeRequest[] = overtimeRes.ok ? await overtimeRes.json() : [];

      const amendRows = allAmendments
        .filter((a) => {
          const d = isoToTaiwanDateStr(a.requestedTime);
          return d >= startDate && d <= endDate;
        })
        .sort((a, b) => a.employeeCode.localeCompare(b.employeeCode))
        .map((a) => ({
          "員工編號": a.employeeCode,
          "員工姓名": a.employeeName,
          "申請打卡時間": formatTaiwanDateTime(a.requestedTime),
          "打卡類型": clockTypeLabel(a.clockType),
          "申請原因": a.reason,
          "狀態": reviewStatusLabel(a.status),
          "審核人": a.reviewedByName || "",
          "審核時間": a.reviewedAt ? formatTaiwanDateTime(a.reviewedAt) : "",
          "審核備註": a.reviewNote || "",
        }));
      const ws2 = XLSX.utils.json_to_sheet(amendRows);
      ws2["!cols"] = [
        { wch: 12 }, { wch: 12 }, { wch: 22 }, { wch: 10 },
        { wch: 28 }, { wch: 10 }, { wch: 12 }, { wch: 22 }, { wch: 28 },
      ];
      XLSX.utils.book_append_sheet(wb, ws2, "補打卡申請");

      const overtimeRows = allOvertimes
        .filter((o) => o.date >= startDate && o.date <= endDate)
        .sort((a, b) => a.employeeCode.localeCompare(b.employeeCode))
        .map((o) => ({
          "員工編號": o.employeeCode,
          "員工姓名": o.employeeName,
          "日期": o.date,
          "開始時間": o.startTime,
          "結束時間": o.endTime,
          "申請原因": o.reason,
          "狀態": reviewStatusLabel(o.status),
          "來源": sourceLabel(o.source),
          "審核人": o.reviewedByName || "",
          "審核時間": o.reviewedAt ? formatTaiwanDateTime(o.reviewedAt) : "",
          "審核備註": o.reviewNote || "",
        }));
      const ws3 = XLSX.utils.json_to_sheet(overtimeRows);
      ws3["!cols"] = [
        { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 10 },
        { wch: 28 }, { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 22 }, { wch: 28 },
      ];
      XLSX.utils.book_append_sheet(wb, ws3, "加班申請");

      const fileName = useCustomRange
        ? `打卡記錄_${customStart}_${customEnd}.xlsx`
        : `打卡記錄_${format(currentMonth, "yyyy-MM")}.xlsx`;

      const totalRows = clockRows.length + amendRows.length + overtimeRows.length;
      if (totalRows === 0) {
        toast({ title: "無資料可匯出", description: "此日期區間內三個分頁均無資料", variant: "destructive" });
        return;
      }

      XLSX.writeFile(wb, fileName);
      toast({ title: `已匯出資料`, description: `${fileName}（打卡 ${clockRows.length} 筆 / 補打卡 ${amendRows.length} 筆 / 加班 ${overtimeRows.length} 筆）` });
    } catch (err: unknown) {
      toast({ title: "匯出失敗", description: err instanceof Error ? err.message : "未知錯誤", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }

  async function handleExportAnomalyExcel() {
    setExporting(true);
    try {
      const wb = XLSX.utils.book_new();
      const amendStatusLabel = (s: string | null) => {
        if (s === "approved") return "已核准";
        if (s === "pending") return "審核中";
        if (s === "rejected") return "已拒絕";
        return "無申請";
      };
      const rows = rawAnomalies.map(r => ({
        "員工編號": r.employeeCode,
        "員工姓名": r.employeeName,
        "日期": r.date,
        "排班時間": `${r.shiftStart}~${r.shiftEnd}`,
        "場館": r.venueName,
        "異常類型": r.anomalyType,
        "異常分鐘數": r.anomalyMinutes ?? "",
        "實際打卡": r.clockTime ?? "—",
        "補打卡申請": amendStatusLabel(r.amendmentStatus),
        "補打卡時間": r.amendmentTime ?? "",
        "最終狀態": r.isResolved ? "已補正" : (r.amendmentStatus === "pending" ? "審核中" : "異常未補正"),
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      ws["!cols"] = [
        { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 16 },
        { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 14 },
      ];
      XLSX.utils.book_append_sheet(wb, ws, "出勤異常");
      const fileName = `出勤異常_${yearMonth}.xlsx`;
      XLSX.writeFile(wb, fileName);
      toast({ title: `已匯出`, description: `${fileName}（共 ${rawAnomalies.length} 筆異常）` });
    } catch (err: unknown) {
      toast({ title: "匯出失敗", description: err instanceof Error ? err.message : "未知錯誤", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }

  function handleResetFilters() {
    setFilterName("");
    setFilterCode("");
    setFilterStatus("all");
    setFilterClockType("all");
    setFilterVenueId("all");
    setUseCustomRange(false);
  }

  const hasFilters =
    filterName || filterCode || filterStatus !== "all" ||
    filterClockType !== "all" || filterVenueId !== "all" || useCustomRange;

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" data-testid="text-reports-title">
            <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
            報表匯出
          </h1>
          <p className="text-sm text-muted-foreground">打卡記錄篩選查詢與 Excel 匯出</p>
        </div>
        {activeTab === "clock" ? (
          <Button onClick={handleExportExcel} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2" disabled={isLoading || exporting} data-testid="button-export-excel">
            <Download className="h-4 w-4" />
            {exporting ? "匯出中..." : `匯出 Excel (${records.length} 筆)`}
          </Button>
        ) : (
          <Button onClick={handleExportAnomalyExcel} className="bg-orange-600 hover:bg-orange-700 text-white gap-2" disabled={anomalyLoading || exporting} data-testid="button-export-anomaly-excel">
            <Download className="h-4 w-4" />
            {exporting ? "匯出中..." : `匯出異常報表 (${rawAnomalies.length} 筆)`}
          </Button>
        )}
      </div>

      <div className="flex gap-1 bg-muted rounded-lg p-1 w-fit">
        <button
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${activeTab === "clock" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          onClick={() => setActiveTab("clock")}
          data-testid="tab-clock-records"
        >
          <Clock className="h-3.5 w-3.5" /> 打卡記錄
        </button>
        <button
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${activeTab === "anomaly" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          onClick={() => setActiveTab("anomaly")}
          data-testid="tab-anomaly"
        >
          <AlertTriangle className="h-3.5 w-3.5" /> 出勤異常
        </button>
      </div>

      {activeTab === "clock" && (<>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Filter className="h-4 w-4" />
            篩選條件
            {hasFilters && (
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs ml-auto" onClick={handleResetFilters} data-testid="button-reset-filters">
                清除篩選
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 bg-muted rounded-md p-1">
              <button
                className={`px-3 py-1 rounded text-sm font-medium transition-colors ${!useCustomRange ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setUseCustomRange(false)}
                data-testid="button-mode-month"
              >
                月份
              </button>
              <button
                className={`px-3 py-1 rounded text-sm font-medium transition-colors ${useCustomRange ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setUseCustomRange(true)}
                data-testid="button-mode-range"
              >
                自訂區間
              </button>
            </div>

            {!useCustomRange ? (
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-8 w-8"
                  onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                  data-testid="button-prev-month">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm font-medium w-28 text-center" data-testid="text-month-label">{monthLabel}</span>
                <Button variant="outline" size="icon" className="h-8 w-8"
                  onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                  data-testid="button-next-month">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="w-36 h-8 text-sm"
                  data-testid="input-custom-start"
                />
                <span className="text-muted-foreground text-sm">至</span>
                <Input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="w-36 h-8 text-sm"
                  data-testid="input-custom-end"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">員工姓名</Label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={filterName}
                  onChange={(e) => setFilterName(e.target.value)}
                  placeholder="模糊搜尋..."
                  className="h-8 text-sm pl-7"
                  data-testid="input-filter-name"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">員工編號</Label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={filterCode}
                  onChange={(e) => setFilterCode(e.target.value)}
                  placeholder="模糊搜尋..."
                  className="h-8 text-sm pl-7"
                  data-testid="input-filter-code"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">打卡狀態</Label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-8 text-sm" data-testid="select-filter-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="success">成功</SelectItem>
                  <SelectItem value="fail">失敗</SelectItem>
                  <SelectItem value="warning">無排班</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">打卡類型</Label>
              <Select value={filterClockType} onValueChange={setFilterClockType}>
                <SelectTrigger className="h-8 text-sm" data-testid="select-filter-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="in">上班打卡</SelectItem>
                  <SelectItem value="out">下班打卡</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">場館</Label>
              <Select value={filterVenueId} onValueChange={setFilterVenueId}>
                <SelectTrigger className="h-8 text-sm" data-testid="select-filter-venue">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部場館</SelectItem>
                  {venues.map((v) => (
                    <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
              <Clock className="h-4 w-4 text-blue-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">總筆數</p>
              <p className="text-lg font-bold" data-testid="stat-total">{records.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
              <CheckCircle className="h-4 w-4 text-green-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">成功</p>
              <p className="text-lg font-bold text-green-600" data-testid="stat-success">{successCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0">
              <XCircle className="h-4 w-4 text-red-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">失敗</p>
              <p className="text-lg font-bold text-red-600" data-testid="stat-fail">{failCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
              <MapPin className="h-4 w-4 text-emerald-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">上班打卡</p>
              <p className="text-lg font-bold text-emerald-600" data-testid="stat-in">{inCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
              <MapPin className="h-4 w-4 text-violet-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">下班打卡</p>
              <p className="text-lg font-bold text-violet-600" data-testid="stat-out">{outCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            <span>打卡記錄明細</span>
            <span className="text-sm font-normal text-muted-foreground">共 {records.length} 筆</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">載入中...</div>
          ) : records.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>此條件下無打卡記錄</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 font-medium whitespace-nowrap">員工姓名</th>
                    <th className="text-left p-3 font-medium whitespace-nowrap">員工編號</th>
                    <th className="text-left p-3 font-medium whitespace-nowrap">日期</th>
                    <th className="text-left p-3 font-medium whitespace-nowrap">打卡時間</th>
                    <th className="text-left p-3 font-medium whitespace-nowrap">類型</th>
                    <th className="text-left p-3 font-medium whitespace-nowrap">場館</th>
                    <th className="text-left p-3 font-medium whitespace-nowrap">狀態</th>
                    <th className="text-left p-3 font-medium whitespace-nowrap">距離</th>
                    <th className="text-left p-3 font-medium whitespace-nowrap">備註</th>
                    <th className="text-right p-3 font-medium whitespace-nowrap">分鐘數</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => {
                    const { note, minutes } = parseFailReason(r.failReason);
                    return (
                      <tr key={r.id} className="border-b hover:bg-muted/30 transition-colors" data-testid={`row-report-${r.id}`}>
                        <td className="p-3 font-medium whitespace-nowrap" data-testid={`cell-name-${r.id}`}>{r.employeeName}</td>
                        <td className="p-3 text-muted-foreground text-xs whitespace-nowrap" data-testid={`cell-code-${r.id}`}>{r.employeeCode}</td>
                        <td className="p-3 whitespace-nowrap text-muted-foreground">{formatTaiwanDate(r.clockTime)}</td>
                        <td className="p-3 whitespace-nowrap font-mono text-xs">{formatTaiwanDateTime(r.clockTime)}</td>
                        <td className="p-3 whitespace-nowrap">
                          <Badge
                            variant={r.clockType === "in" ? "default" : "secondary"}
                            className="text-[11px]"
                            data-testid={`cell-type-${r.id}`}
                          >
                            {clockTypeLabel(r.clockType)}
                          </Badge>
                        </td>
                        <td className="p-3 whitespace-nowrap text-sm">
                          <div className="flex items-center gap-1">
                            <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                            {r.venueName || r.matchedVenueName || "—"}
                          </div>
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          {r.status === "success" && (
                            <Badge className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20 text-[11px]" data-testid={`cell-status-${r.id}`}>
                              <CheckCircle className="h-3 w-3 mr-1" />成功
                            </Badge>
                          )}
                          {r.status === "fail" && (
                            <Badge className="bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20 text-[11px]" data-testid={`cell-status-${r.id}`}>
                              <XCircle className="h-3 w-3 mr-1" />失敗
                            </Badge>
                          )}
                          {r.status === "warning" && (
                            <Badge className="bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20 text-[11px]" data-testid={`cell-status-${r.id}`}>
                              <AlertTriangle className="h-3 w-3 mr-1" />無排班
                            </Badge>
                          )}
                          {r.status !== "success" && r.status !== "fail" && r.status !== "warning" && (
                            <Badge variant="outline" className="text-[11px]">{r.status}</Badge>
                          )}
                        </td>
                        <td className="p-3 whitespace-nowrap text-muted-foreground text-xs">
                          {r.distance !== null ? `${Math.round(r.distance)} m` : "—"}
                        </td>
                        <td className="p-3 text-xs whitespace-nowrap text-muted-foreground" data-testid={`cell-note-${r.id}`}>
                          {note || "—"}
                        </td>
                        <td className="p-3 text-xs text-right whitespace-nowrap text-muted-foreground" data-testid={`cell-minutes-${r.id}`}>
                          {minutes !== null ? minutes : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      </>)}

      {activeTab === "anomaly" && (<>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Filter className="h-4 w-4" /> 月份與篩選
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentMonth(m => subMonths(m, 1))} data-testid="button-anomaly-prev-month">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="font-medium text-sm w-28 text-center" data-testid="text-anomaly-month">{monthLabel}</span>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentMonth(m => addMonths(m, 1))} data-testid="button-anomaly-next-month">
                <ChevronRight className="h-4 w-4" />
              </Button>
              <div className="relative ml-2">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input className="pl-8 h-8 w-44 text-sm" placeholder="員工姓名或編號" value={anomalyFilterName} onChange={e => setAnomalyFilterName(e.target.value)} data-testid="input-anomaly-name" />
              </div>
              <Select value={anomalyFilterType} onValueChange={setAnomalyFilterType}>
                <SelectTrigger className="h-8 w-36 text-sm" data-testid="select-anomaly-type">
                  <SelectValue placeholder="異常類型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部類型</SelectItem>
                  <SelectItem value="遲到">遲到</SelectItem>
                  <SelectItem value="缺打卡上班">缺打卡上班</SelectItem>
                  <SelectItem value="缺打卡下班">缺打卡下班</SelectItem>
                  <SelectItem value="早退">早退</SelectItem>
                </SelectContent>
              </Select>
              <Select value={anomalyFilterStatus} onValueChange={setAnomalyFilterStatus}>
                <SelectTrigger className="h-8 w-32 text-sm" data-testid="select-anomaly-status">
                  <SelectValue placeholder="補正狀態" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部狀態</SelectItem>
                  <SelectItem value="unresolved">未補正</SelectItem>
                  <SelectItem value="pending">審核中</SelectItem>
                  <SelectItem value="resolved">已補正</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "總異常筆數", value: rawAnomalies.length, icon: AlertTriangle, color: "text-orange-600" },
            { label: "未補正", value: rawAnomalies.filter(r => !r.isResolved && r.amendmentStatus !== "pending").length, icon: UserX, color: "text-red-600" },
            { label: "審核中", value: rawAnomalies.filter(r => r.amendmentStatus === "pending").length, icon: Timer, color: "text-yellow-600" },
            { label: "已補正", value: rawAnomalies.filter(r => r.isResolved).length, icon: UserCheck, color: "text-green-600" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label}>
              <CardContent className="p-3 flex items-center gap-3">
                <Icon className={`h-8 w-8 ${color}`} />
                <div>
                  <div className="text-2xl font-bold" data-testid={`stat-anomaly-${label}`}>{value}</div>
                  <div className="text-xs text-muted-foreground">{label}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardContent className="p-0">
            {anomalyLoading ? (
              <div className="p-8 text-center text-muted-foreground">載入中...</div>
            ) : anomalies.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <UserCheck className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p>本月無出勤異常紀錄</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                      <th className="p-3 text-left font-medium">員工</th>
                      <th className="p-3 text-left font-medium">日期</th>
                      <th className="p-3 text-left font-medium">排班時間</th>
                      <th className="p-3 text-left font-medium">場館</th>
                      <th className="p-3 text-left font-medium">異常類型</th>
                      <th className="p-3 text-left font-medium">分鐘數</th>
                      <th className="p-3 text-left font-medium">實際打卡</th>
                      <th className="p-3 text-left font-medium">補打卡申請</th>
                      <th className="p-3 text-left font-medium">狀態</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {anomalies.map((r, idx) => (
                      <tr key={idx} className="hover:bg-muted/30 transition-colors" data-testid={`row-anomaly-${idx}`}>
                        <td className="p-3 whitespace-nowrap">
                          <div className="font-medium">{r.employeeName}</div>
                          <div className="text-xs text-muted-foreground">{r.employeeCode}</div>
                        </td>
                        <td className="p-3 whitespace-nowrap text-xs">{r.date}</td>
                        <td className="p-3 whitespace-nowrap text-xs">{r.shiftStart}～{r.shiftEnd}</td>
                        <td className="p-3 whitespace-nowrap text-xs">{r.venueName}</td>
                        <td className="p-3 whitespace-nowrap">
                          <Badge className={`text-[11px] ${
                            r.anomalyType === "遲到" ? "bg-yellow-500/10 text-yellow-700 border-yellow-500/20" :
                            r.anomalyType === "早退" ? "bg-orange-500/10 text-orange-700 border-orange-500/20" :
                            "bg-red-500/10 text-red-700 border-red-500/20"
                          }`}>
                            {r.anomalyType}
                          </Badge>
                        </td>
                        <td className="p-3 whitespace-nowrap text-xs text-muted-foreground">
                          {r.anomalyMinutes != null ? `${r.anomalyMinutes} 分` : "—"}
                        </td>
                        <td className="p-3 whitespace-nowrap text-xs font-mono">
                          {r.clockTime ? r.clockTime.slice(11, 16) : "—"}
                        </td>
                        <td className="p-3 whitespace-nowrap text-xs">
                          {r.amendmentStatus === "approved" && <Badge className="bg-green-500/10 text-green-700 border-green-500/20 text-[11px]">已核准</Badge>}
                          {r.amendmentStatus === "pending" && <Badge className="bg-yellow-500/10 text-yellow-700 border-yellow-500/20 text-[11px]">審核中</Badge>}
                          {r.amendmentStatus === "rejected" && <Badge className="bg-red-500/10 text-red-700 border-red-500/20 text-[11px]">已拒絕</Badge>}
                          {!r.amendmentStatus && <span className="text-muted-foreground">無申請</span>}
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          {r.isResolved ? (
                            <Badge className="bg-green-500/10 text-green-700 border-green-500/20 text-[11px]">
                              <CheckCircle className="h-3 w-3 mr-1" />已補正
                            </Badge>
                          ) : r.amendmentStatus === "pending" ? (
                            <Badge className="bg-yellow-500/10 text-yellow-700 border-yellow-500/20 text-[11px]">
                              <Clock className="h-3 w-3 mr-1" />待審核
                            </Badge>
                          ) : (
                            <Badge className="bg-red-500/10 text-red-700 border-red-500/20 text-[11px]">
                              <XCircle className="h-3 w-3 mr-1" />未補正
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </>)}
    </div>
  );
}
