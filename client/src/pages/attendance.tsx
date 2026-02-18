import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RegionTabs } from "@/components/region-tabs";
import { useRegion } from "@/lib/region-context";
import {
  Upload, AlertTriangle, CheckCircle2, Clock, Trash2, FileSpreadsheet,
  ChevronDown, ChevronUp, MapPin, ArrowDownUp,
} from "lucide-react";
import type { Employee, AttendanceUpload, AttendanceRecord } from "@shared/schema";
import { useRef, useState, useMemo, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type SortField = "date" | "employeeName" | "status";
type SortDir = "asc" | "desc";
type FilterStatus = "all" | "normal" | "late" | "early" | "anomaly" | "noClockIn" | "noClockOut";

export default function AttendancePage() {
  const { activeRegion } = useRegion();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedUploadId, setSelectedUploadId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["/api/employees", activeRegion],
  });

  const { data: uploads = [], isLoading: uploadsLoading } = useQuery<AttendanceUpload[]>({
    queryKey: ["/api/attendance-uploads"],
  });

  const activeUpload = selectedUploadId
    ? uploads.find((u) => u.id === selectedUploadId)
    : uploads[0];

  const { data: records = [], isLoading: recordsLoading } = useQuery<AttendanceRecord[]>({
    queryKey: ["/api/attendance-records", activeUpload?.id],
    enabled: !!activeUpload,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/attendance-upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "上傳失敗");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/attendance-uploads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance-records"] });
      setSelectedUploadId(data.uploadId);
      toast({ title: "匯入成功", description: data.message });
    },
    onError: (err: Error) => {
      toast({ title: "匯入失敗", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/attendance-upload/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/attendance-uploads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance-records"] });
      setSelectedUploadId(null);
      toast({ title: "已刪除匯入紀錄" });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadMutation.mutate(file);
      e.target.value = "";
    }
  };

  const regionEmployeeCodes = useMemo(
    () => new Set(employees.map((e) => e.employeeCode)),
    [employees]
  );

  const regionRecords = useMemo(
    () => records.filter((r) => regionEmployeeCodes.has(r.employeeCode)),
    [records, regionEmployeeCodes]
  );

  const filteredRecords = useMemo(() => {
    let result = regionRecords;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        (r) =>
          r.employeeName.toLowerCase().includes(term) ||
          r.employeeCode.toLowerCase().includes(term)
      );
    }

    if (filterStatus !== "all") {
      result = result.filter((r) => {
        switch (filterStatus) {
          case "late": return r.isLate;
          case "early": return r.isEarlyLeave;
          case "anomaly": return r.hasAnomaly;
          case "noClockIn": return !r.clockIn && r.scheduledStart && r.scheduledStart !== "--";
          case "noClockOut": return !r.clockOut && r.scheduledEnd && r.scheduledEnd !== "--";
          case "normal": return !r.isLate && !r.isEarlyLeave && !r.hasAnomaly && r.clockIn;
          default: return true;
        }
      });
    }

    result.sort((a, b) => {
      let cmp = 0;
      if (sortField === "date") cmp = a.date.localeCompare(b.date);
      else if (sortField === "employeeName") cmp = a.employeeName.localeCompare(b.employeeName);
      else {
        const scoreA = (a.isLate ? 1 : 0) + (a.isEarlyLeave ? 1 : 0) + (a.hasAnomaly ? 2 : 0);
        const scoreB = (b.isLate ? 1 : 0) + (b.isEarlyLeave ? 1 : 0) + (b.hasAnomaly ? 2 : 0);
        cmp = scoreA - scoreB;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });

    return result;
  }, [regionRecords, searchTerm, filterStatus, sortField, sortDir]);

  const stats = useMemo(() => {
    const total = regionRecords.length;
    const withClock = regionRecords.filter((r) => r.clockIn || r.clockOut).length;
    const lateCount = regionRecords.filter((r) => r.isLate).length;
    const earlyCount = regionRecords.filter((r) => r.isEarlyLeave).length;
    const anomalyCount = regionRecords.filter((r) => r.hasAnomaly).length;
    const noClockIn = regionRecords.filter((r) => !r.clockIn && r.scheduledStart && r.scheduledStart !== "--").length;
    const noClockOut = regionRecords.filter((r) => !r.clockOut && r.scheduledEnd && r.scheduledEnd !== "--").length;
    const issues = lateCount + earlyCount + anomalyCount + noClockIn + noClockOut;
    const complianceRate = withClock > 0 ? Math.round(((withClock - issues) / withClock) * 100) : 0;
    return { total, withClock, lateCount, earlyCount, anomalyCount, noClockIn, noClockOut, issues, complianceRate };
  }, [regionRecords]);

  const toggleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortField(field);
        setSortDir("asc");
      }
    },
    [sortField]
  );

  const SortIcon = ({ field }: { field: SortField }) => (
    <ArrowDownUp
      className={`h-3 w-3 ml-1 inline-block ${sortField === field ? "text-foreground" : "text-muted-foreground/50"}`}
    />
  );

  const getStatusBadges = (r: AttendanceRecord) => {
    const badges: JSX.Element[] = [];
    if (r.dayType === "國定假日" || r.dayType === "例假") {
      badges.push(<Badge key="holiday" variant="secondary" className="text-xs">休假日</Badge>);
      return badges;
    }
    if (!r.clockIn && r.scheduledStart && r.scheduledStart !== "--") {
      badges.push(<Badge key="noIn" variant="destructive" className="text-xs">未打上班卡</Badge>);
    }
    if (!r.clockOut && r.scheduledEnd && r.scheduledEnd !== "--") {
      badges.push(<Badge key="noOut" variant="destructive" className="text-xs">未打下班卡</Badge>);
    }
    if (r.isLate) {
      badges.push(<Badge key="late" variant="destructive" className="text-xs">遲到</Badge>);
    }
    if (r.isEarlyLeave) {
      badges.push(<Badge key="early" variant="destructive" className="text-xs">早退</Badge>);
    }
    if (r.hasAnomaly) {
      badges.push(<Badge key="anomaly" variant="destructive" className="text-xs">異常</Badge>);
    }
    if (badges.length === 0 && r.clockIn) {
      badges.push(<Badge key="ok" variant="secondary" className="text-xs">正常</Badge>);
    }
    if (badges.length === 0 && !r.scheduledStart) {
      badges.push(<Badge key="off" variant="outline" className="text-xs">無排班</Badge>);
    }
    return badges;
  };

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 border-b">
        <div>
          <h1 className="text-lg font-semibold" data-testid="text-attendance-title">考勤稽核</h1>
          <p className="text-sm text-muted-foreground">排班與打卡自動比對</p>
        </div>
        <RegionTabs />
      </div>

      <div className="p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileChange}
            className="hidden"
            data-testid="input-attendance-file"
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
            data-testid="button-upload-attendance"
          >
            <Upload className="h-4 w-4 mr-2" />
            {uploadMutation.isPending ? "匯入中..." : "匯入打卡紀錄"}
          </Button>

          {uploads.length > 0 && (
            <Select
              value={String(activeUpload?.id || "")}
              onValueChange={(v) => setSelectedUploadId(parseInt(v))}
            >
              <SelectTrigger className="w-auto min-w-[200px]" data-testid="select-upload-period">
                <SelectValue placeholder="選擇匯入紀錄" />
              </SelectTrigger>
              <SelectContent>
                {uploads.map((u) => (
                  <SelectItem key={u.id} value={String(u.id)} data-testid={`select-upload-${u.id}`}>
                    <FileSpreadsheet className="h-3 w-3 mr-1 inline-block" />
                    {u.periodStart} ~ {u.periodEnd}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {activeUpload && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (confirm("確定刪除此匯入紀錄？")) {
                  deleteMutation.mutate(activeUpload.id);
                }
              }}
              data-testid="button-delete-upload"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>

        {activeUpload && regionRecords.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs text-muted-foreground">出勤紀錄</p>
                  <p className="text-2xl font-bold mt-1" data-testid="text-total-records">{stats.withClock}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">筆（共 {stats.total} 筆）</p>
                </div>
                <div className="p-2 rounded-md bg-blue-50 dark:bg-blue-950/30">
                  <Clock className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs text-muted-foreground">考勤異常</p>
                  <p className="text-2xl font-bold mt-1" data-testid="text-attendance-issues">
                    {stats.issues}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    遲到{stats.lateCount} / 早退{stats.earlyCount}
                  </p>
                </div>
                <div className="p-2 rounded-md bg-amber-50 dark:bg-amber-950/30">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs text-muted-foreground">合規率</p>
                  <p className="text-2xl font-bold mt-1" data-testid="text-compliance-rate">
                    {stats.complianceRate}%
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">出勤合規比例</p>
                </div>
                <div className="p-2 rounded-md bg-green-50 dark:bg-green-950/30">
                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs text-muted-foreground">未打卡</p>
                  <p className="text-2xl font-bold mt-1" data-testid="text-no-clock">
                    {stats.noClockIn + stats.noClockOut}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    上班{stats.noClockIn} / 下班{stats.noClockOut}
                  </p>
                </div>
                <div className="p-2 rounded-md bg-red-50 dark:bg-red-950/30">
                  <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
                </div>
              </div>
            </Card>
          </div>
        )}

        {!activeUpload && !uploadsLoading && (
          <Card className="p-6">
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="p-4 rounded-full bg-muted/50 mb-4">
                <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="font-medium mb-1">尚未匯入打卡數據</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                點擊「匯入打卡紀錄」上傳 xlsx 檔案，系統將自動解析打卡紀錄表，
                並比對排班數據揪出遲到、早退、未打卡等異常。
              </p>
              <div className="flex flex-wrap justify-center gap-2 mt-4">
                <Badge variant="outline">遲到偵測</Badge>
                <Badge variant="outline">早退偵測</Badge>
                <Badge variant="outline">未打卡偵測</Badge>
                <Badge variant="outline">出勤異常標記</Badge>
              </div>
            </div>
          </Card>
        )}

        {activeUpload && (
          <Card className="p-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-3">
              <h3 className="font-medium text-sm">打卡明細</h3>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  placeholder="搜尋姓名或編號..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-48"
                  data-testid="input-attendance-search"
                />
                <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as FilterStatus)}>
                  <SelectTrigger className="w-32" data-testid="select-attendance-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部</SelectItem>
                    <SelectItem value="normal">正常</SelectItem>
                    <SelectItem value="late">遲到</SelectItem>
                    <SelectItem value="early">早退</SelectItem>
                    <SelectItem value="anomaly">異常</SelectItem>
                    <SelectItem value="noClockIn">未打上班卡</SelectItem>
                    <SelectItem value="noClockOut">未打下班卡</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {recordsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : filteredRecords.length === 0 ? (
              <p className="text-center py-6 text-muted-foreground text-sm">
                {regionRecords.length === 0 ? "此區域無打卡紀錄" : "無符合條件的紀錄"}
              </p>
            ) : (
              <div className="overflow-auto max-h-[500px]">
                <Table>
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow>
                      <TableHead
                        className="cursor-pointer select-none"
                        onClick={() => toggleSort("date")}
                        data-testid="th-date"
                      >
                        日期 <SortIcon field="date" />
                      </TableHead>
                      <TableHead
                        className="cursor-pointer select-none"
                        onClick={() => toggleSort("employeeName")}
                        data-testid="th-name"
                      >
                        姓名 <SortIcon field="employeeName" />
                      </TableHead>
                      <TableHead>表定時間</TableHead>
                      <TableHead>打卡時間</TableHead>
                      <TableHead
                        className="cursor-pointer select-none"
                        onClick={() => toggleSort("status")}
                        data-testid="th-status"
                      >
                        狀態 <SortIcon field="status" />
                      </TableHead>
                      <TableHead className="w-8"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRecords.slice(0, 200).map((r) => (
                      <>
                        <TableRow
                          key={r.id}
                          className={`cursor-pointer ${r.isLate || r.isEarlyLeave || r.hasAnomaly ? "bg-red-50/50 dark:bg-red-950/10" : ""}`}
                          onClick={() => setExpandedRow(expandedRow === r.id ? null : r.id)}
                          data-testid={`row-attendance-${r.id}`}
                        >
                          <TableCell className="text-xs whitespace-nowrap">
                            {r.date}
                            {r.dayType && r.dayType !== "平日" && (
                              <span className="ml-1 text-muted-foreground">({r.dayType})</span>
                            )}
                          </TableCell>
                          <TableCell className="font-medium text-sm">{r.employeeName}</TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {r.scheduledStart && r.scheduledStart !== "--"
                              ? `${r.scheduledStart}-${r.scheduledEnd}`
                              : "—"}
                          </TableCell>
                          <TableCell className="text-xs whitespace-nowrap">
                            {r.clockIn || "—"} ~ {r.clockOut || "—"}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {getStatusBadges(r)}
                            </div>
                          </TableCell>
                          <TableCell>
                            {expandedRow === r.id ? (
                              <ChevronUp className="h-3 w-3 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-3 w-3 text-muted-foreground" />
                            )}
                          </TableCell>
                        </TableRow>
                        {expandedRow === r.id && (
                          <TableRow key={`${r.id}-detail`}>
                            <TableCell colSpan={6} className="bg-muted/30">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs p-2">
                                <div>
                                  <span className="text-muted-foreground">員工編號：</span>
                                  <span data-testid={`text-emp-code-${r.id}`}>{r.employeeCode}</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">部門：</span>
                                  <span>{r.department || "—"}</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">班別：</span>
                                  <span>{r.shiftType || "—"}</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">日期類別：</span>
                                  <span>{r.dayType || "—"}</span>
                                </div>
                                {r.clockInLocation && (
                                  <div className="col-span-2">
                                    <MapPin className="h-3 w-3 inline mr-1 text-muted-foreground" />
                                    <span className="text-muted-foreground">上班：</span>
                                    <span>{r.clockInLocation}</span>
                                  </div>
                                )}
                                {r.clockOutLocation && (
                                  <div className="col-span-2">
                                    <MapPin className="h-3 w-3 inline mr-1 text-muted-foreground" />
                                    <span className="text-muted-foreground">下班：</span>
                                    <span>{r.clockOutLocation}</span>
                                  </div>
                                )}
                                {r.leaveType && (
                                  <div>
                                    <span className="text-muted-foreground">假別：</span>
                                    <span>{r.leaveType} ({r.leaveHours}h)</span>
                                  </div>
                                )}
                                {r.overtimeHours && (
                                  <div>
                                    <span className="text-muted-foreground">加班：</span>
                                    <span>{r.overtimeHours}</span>
                                  </div>
                                )}
                                {r.anomalyNote && (
                                  <div className="col-span-2">
                                    <span className="text-muted-foreground">異常備註：</span>
                                    <span className="text-red-600 dark:text-red-400">{r.anomalyNote}</span>
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    ))}
                  </TableBody>
                </Table>
                {filteredRecords.length > 200 && (
                  <p className="text-center text-xs text-muted-foreground py-2">
                    顯示前 200 筆（共 {filteredRecords.length} 筆符合條件）
                  </p>
                )}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
