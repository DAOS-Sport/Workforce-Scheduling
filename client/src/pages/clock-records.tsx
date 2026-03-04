import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { MapPin, Clock, CheckCircle, XCircle, AlertTriangle, ChevronLeft, ChevronRight, FileEdit, ClipboardCheck, Timer } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ClockRecord {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  venueId: number | null;
  shiftId: number | null;
  clockType: string;
  latitude: number;
  longitude: number;
  distance: number | null;
  status: string;
  failReason: string | null;
  clockTime: string;
  matchedVenueName: string | null;
  earlyArrivalReason: string | null;
  lateDepartureReason: string | null;
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
  reviewedBy: number | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
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
  reviewedBy: number | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
}

function getTaiwanToday(): string {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatReviewInfo(name: string | null, at: string | null): string | null {
  if (!name || !at) return null;
  const formatted = new Date(at).toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `審核人：${name} | 時間：${formatted}`;
}

function isEarlyArrival(r: ClockRecord): boolean {
  return r.failReason !== null && r.failReason.includes("提早") && r.failReason.includes("到");
}

function isLateDeparture(r: ClockRecord): boolean {
  return r.failReason !== null && r.failReason.includes("晚下班");
}

export default function ClockRecordsPage() {
  const today = getTaiwanToday();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [activeTab, setActiveTab] = useState<"records" | "amendments" | "overtime">("records");
  const [amendmentFilter, setAmendmentFilter] = useState<"pending" | "all">("pending");
  const [overtimeFilter, setOvertimeFilter] = useState<"pending" | "all">("pending");
  const [reviewingId, setReviewingId] = useState<number | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [otReviewingId, setOtReviewingId] = useState<number | null>(null);
  const [otReviewNote, setOtReviewNote] = useState("");
  const { toast } = useToast();

  const { data: records = [], isLoading } = useQuery<ClockRecord[]>({
    queryKey: ["/api/clock-records", startDate, endDate],
    queryFn: async () => {
      const res = await fetch(`/api/clock-records?startDate=${startDate}&endDate=${endDate}`);
      return res.json();
    },
    enabled: activeTab === "records",
  });

  const { data: amendments = [], isLoading: amendmentsLoading } = useQuery<ClockAmendment[]>({
    queryKey: ["/api/clock-amendments", amendmentFilter],
    queryFn: async () => {
      const url = amendmentFilter === "pending" ? "/api/clock-amendments?status=pending" : "/api/clock-amendments";
      const res = await fetch(url);
      return res.json();
    },
    enabled: activeTab === "amendments",
  });

  const { data: overtimeRequests = [], isLoading: overtimeLoading } = useQuery<OvertimeRequest[]>({
    queryKey: ["/api/overtime-requests", overtimeFilter],
    queryFn: async () => {
      const url = overtimeFilter === "pending" ? "/api/overtime-requests?status=pending" : "/api/overtime-requests";
      const res = await fetch(url);
      return res.json();
    },
    enabled: activeTab === "overtime",
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, status, note }: { id: number; status: string; note?: string }) => {
      await apiRequest("PATCH", `/api/clock-amendments/${id}`, { status, reviewNote: note || "" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clock-amendments"] });
      setReviewingId(null);
      setReviewNote("");
      toast({ title: "審核完成" });
    },
    onError: (err: any) => {
      toast({ title: err.message || "審核失敗", variant: "destructive" });
    },
  });

  const otReviewMutation = useMutation({
    mutationFn: async ({ id, status, note }: { id: number; status: string; note?: string }) => {
      await apiRequest("PATCH", `/api/overtime-requests/${id}`, { status, reviewNote: note || "" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/overtime-requests"] });
      setOtReviewingId(null);
      setOtReviewNote("");
      toast({ title: "審核完成" });
    },
    onError: (err: any) => {
      toast({ title: err.message || "審核失敗", variant: "destructive" });
    },
  });

  const successCount = records.filter((r) => r.status === "success" && !r.failReason).length;
  const lateCount = records.filter((r) => r.status === "success" && r.failReason && !isEarlyArrival(r) && !isLateDeparture(r)).length;
  const earlyCount = records.filter((r) => isEarlyArrival(r)).length;
  const lateDeptCount = records.filter((r) => isLateDeparture(r)).length;
  const warningCount = records.filter((r) => r.status === "warning").length;
  const failCount = records.filter((r) => r.status === "fail").length;
  const pendingCount = amendments.filter((a) => a.status === "pending").length;
  const otPendingCount = overtimeRequests.filter((o) => o.status === "pending").length;

  const goDay = (offset: number) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + offset);
    const str = d.toISOString().slice(0, 10);
    setStartDate(str);
    setEndDate(str);
  };

  function getReasonDisplay(r: ClockRecord) {
    if (isEarlyArrival(r)) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-blue-600 dark:text-blue-400 font-medium cursor-help" data-testid={`text-early-${r.id}`}>
                {r.earlyArrivalReason || "原因待補"}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>{r.failReason}</p>
              {r.earlyArrivalReason && <p>原因：{r.earlyArrivalReason}</p>}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    if (isLateDeparture(r)) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-orange-600 dark:text-orange-400 font-medium cursor-help" data-testid={`text-latedept-${r.id}`}>
                {r.lateDepartureReason || "原因待補"}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>{r.failReason}</p>
              {r.lateDepartureReason && <p>原因：{r.lateDepartureReason}</p>}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    if (r.status === "success" && r.failReason) {
      return (
        <span className="text-orange-600 dark:text-orange-400 font-medium" data-testid={`text-late-${r.id}`}>
          {r.failReason}
        </span>
      );
    }
    if (r.failReason) {
      return <span className="text-muted-foreground">{r.failReason}</span>;
    }
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" data-testid="text-clock-title">GPS 打卡紀錄</h1>
          <p className="text-sm text-muted-foreground">LINE 一鍵打卡記錄查詢與管理</p>
        </div>
      </div>

      <div className="flex gap-1 bg-muted p-1 rounded-lg">
        <button
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === "records" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          onClick={() => setActiveTab("records")}
          data-testid="tab-records"
        >
          <ClipboardCheck className="h-4 w-4" />
          打卡紀錄
        </button>
        <button
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === "amendments" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          onClick={() => setActiveTab("amendments")}
          data-testid="tab-amendments"
        >
          <FileEdit className="h-4 w-4" />
          補打卡審核
          {pendingCount > 0 && (
            <Badge className="bg-orange-500 text-white text-[10px] px-1.5 py-0 min-w-[18px] h-[18px]" data-testid="badge-pending-count">
              {pendingCount}
            </Badge>
          )}
        </button>
        <button
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === "overtime" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          onClick={() => setActiveTab("overtime")}
          data-testid="tab-overtime"
        >
          <Timer className="h-4 w-4" />
          加班審核
          {otPendingCount > 0 && (
            <Badge className="bg-amber-500 text-white text-[10px] px-1.5 py-0 min-w-[18px] h-[18px]" data-testid="badge-ot-pending-count">
              {otPendingCount}
            </Badge>
          )}
        </button>
      </div>

      {activeTab === "records" && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="icon" onClick={() => goDay(-1)} data-testid="button-prev-day">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-40"
              data-testid="input-start-date"
            />
            <span className="text-muted-foreground">至</span>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-40"
              data-testid="input-end-date"
            />
            <Button variant="outline" size="icon" onClick={() => goDay(1)} data-testid="button-next-day">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setStartDate(today); setEndDate(today); }}
              data-testid="button-today"
            >
              今天
            </Button>
          </div>

          <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
            <Card data-testid="card-stat-success">
              <CardContent className="p-3 flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-green-500/10 flex items-center justify-center">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">準時</p>
                  <p className="text-lg font-bold text-green-600">{successCount}</p>
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-stat-late">
              <CardContent className="p-3 flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-orange-500/10 flex items-center justify-center">
                  <Clock className="h-5 w-5 text-orange-500" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">遲到/早退</p>
                  <p className="text-lg font-bold text-orange-600">{lateCount}</p>
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-stat-early">
              <CardContent className="p-3 flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Clock className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">提早到</p>
                  <p className="text-lg font-bold text-blue-600">{earlyCount}</p>
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-stat-late-dept">
              <CardContent className="p-3 flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-orange-500/10 flex items-center justify-center">
                  <Timer className="h-5 w-5 text-orange-500" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">晚下班</p>
                  <p className="text-lg font-bold text-orange-600">{lateDeptCount}</p>
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-stat-warning">
              <CardContent className="p-3 flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-yellow-500/10 flex items-center justify-center">
                  <AlertTriangle className="h-5 w-5 text-yellow-500" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">無排班</p>
                  <p className="text-lg font-bold text-yellow-600">{warningCount}</p>
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-stat-fail">
              <CardContent className="p-3 flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-red-500/10 flex items-center justify-center">
                  <XCircle className="h-5 w-5 text-red-500" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">失敗</p>
                  <p className="text-lg font-bold text-red-600">{failCount}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">打卡記錄明細</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-8 text-center text-muted-foreground">載入中...</div>
              ) : records.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">此日期範圍無打卡紀錄</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-3 font-medium">時間</th>
                        <th className="text-left p-3 font-medium">員工</th>
                        <th className="text-left p-3 font-medium">類型</th>
                        <th className="text-left p-3 font-medium">場館</th>
                        <th className="text-left p-3 font-medium">距離</th>
                        <th className="text-left p-3 font-medium">狀態</th>
                        <th className="text-left p-3 font-medium">備註</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((r) => (
                        <tr key={r.id} className="border-b hover:bg-muted/30" data-testid={`row-clock-${r.id}`}>
                          <td className="p-3 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                              {new Date(r.clockTime).toLocaleString("zh-TW", {
                                timeZone: "Asia/Taipei",
                                month: "2-digit",
                                day: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </div>
                          </td>
                          <td className="p-3">
                            <div className="font-medium">{r.employeeName}</div>
                            <div className="text-xs text-muted-foreground">{r.employeeCode}</div>
                          </td>
                          <td className="p-3">
                            <Badge variant={r.clockType === "in" ? "default" : "secondary"}>
                              {r.clockType === "in" ? "上班" : "下班"}
                            </Badge>
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-1.5">
                              <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                              {r.matchedVenueName || "—"}
                            </div>
                          </td>
                          <td className="p-3">
                            {r.distance !== null ? `${r.distance}m` : "—"}
                          </td>
                          <td className="p-3">
                            {r.status === "success" && !isEarlyArrival(r) && !isLateDeparture(r) && (
                              <Badge className="bg-green-500/10 text-green-600 border-green-500/20" data-testid={`status-success-${r.id}`}>
                                <CheckCircle className="h-3 w-3 mr-1" /> 成功
                              </Badge>
                            )}
                            {r.status === "success" && isEarlyArrival(r) && (
                              <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20" data-testid={`status-early-${r.id}`}>
                                <Clock className="h-3 w-3 mr-1" /> 提早到
                              </Badge>
                            )}
                            {r.status === "success" && isLateDeparture(r) && (
                              <Badge className="bg-orange-500/10 text-orange-600 border-orange-500/20" data-testid={`status-latedept-${r.id}`}>
                                <Timer className="h-3 w-3 mr-1" /> 晚下班
                              </Badge>
                            )}
                            {r.status === "warning" && (
                              <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20" data-testid={`status-warning-${r.id}`}>
                                <AlertTriangle className="h-3 w-3 mr-1" /> 警告
                              </Badge>
                            )}
                            {r.status === "fail" && (
                              <Badge className="bg-red-500/10 text-red-600 border-red-500/20" data-testid={`status-fail-${r.id}`}>
                                <XCircle className="h-3 w-3 mr-1" /> 失敗
                              </Badge>
                            )}
                          </td>
                          <td className="p-3 text-xs max-w-[200px]">
                            {getReasonDisplay(r)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {activeTab === "amendments" && (
        <>
          <div className="flex items-center gap-2">
            <Button
              variant={amendmentFilter === "pending" ? "default" : "outline"}
              size="sm"
              onClick={() => setAmendmentFilter("pending")}
              data-testid="button-filter-pending"
            >
              待審核
            </Button>
            <Button
              variant={amendmentFilter === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setAmendmentFilter("all")}
              data-testid="button-filter-all"
            >
              全部
            </Button>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">補打卡申請列表</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {amendmentsLoading ? (
                <div className="p-8 text-center text-muted-foreground">載入中...</div>
              ) : amendments.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  {amendmentFilter === "pending" ? "目前沒有待審核的補打卡申請" : "沒有補打卡申請紀錄"}
                </div>
              ) : (
                <div className="divide-y">
                  {amendments.map((a) => (
                    <div key={a.id} className="p-4 hover:bg-muted/30" data-testid={`row-amendment-${a.id}`}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium" data-testid={`text-amendment-name-${a.id}`}>{a.employeeName}</span>
                            <span className="text-xs text-muted-foreground">{a.employeeCode}</span>
                            <Badge variant={a.clockType === "in" ? "default" : "secondary"}>
                              {a.clockType === "in" ? "上班" : "下班"}
                            </Badge>
                            {a.status === "pending" && (
                              <Badge className="bg-orange-500/10 text-orange-600 border-orange-500/20" data-testid={`badge-pending-${a.id}`}>待審核</Badge>
                            )}
                            {a.status === "approved" && (
                              <Badge className="bg-green-500/10 text-green-600 border-green-500/20" data-testid={`badge-approved-${a.id}`}>已批准</Badge>
                            )}
                            {a.status === "rejected" && (
                              <Badge className="bg-red-500/10 text-red-600 border-red-500/20" data-testid={`badge-rejected-${a.id}`}>已駁回</Badge>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            <span>申請時間：</span>
                            <span className="font-medium text-foreground">
                              {new Date(a.requestedTime).toLocaleString("zh-TW", {
                                timeZone: "Asia/Taipei",
                                year: "numeric",
                                month: "2-digit",
                                day: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                          <div className="text-sm text-muted-foreground mt-0.5">
                            原因：{a.reason}
                          </div>
                          {formatReviewInfo(a.reviewedByName, a.reviewedAt) && (
                            <div className="text-xs text-muted-foreground mt-1">
                              {formatReviewInfo(a.reviewedByName, a.reviewedAt)}
                            </div>
                          )}
                          {a.reviewNote && (
                            <div className="text-xs text-muted-foreground mt-1">
                              審核備註：{a.reviewNote}
                            </div>
                          )}
                          <div className="text-xs text-muted-foreground mt-1">
                            送出時間：{new Date(a.createdAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          </div>
                        </div>

                        {a.status === "pending" && (
                          <div className="flex flex-col gap-2 shrink-0">
                            {reviewingId === a.id ? (
                              <div className="space-y-2 w-48">
                                <Input
                                  placeholder="駁回備註（選填）"
                                  value={reviewNote}
                                  onChange={(e) => setReviewNote(e.target.value)}
                                  className="text-sm"
                                  data-testid={`input-review-note-${a.id}`}
                                />
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    className="flex-1"
                                    disabled={reviewMutation.isPending}
                                    onClick={() => reviewMutation.mutate({ id: a.id, status: "rejected", note: reviewNote })}
                                    data-testid={`button-confirm-reject-${a.id}`}
                                  >
                                    確認駁回
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => { setReviewingId(null); setReviewNote(""); }}
                                    data-testid={`button-cancel-reject-${a.id}`}
                                  >
                                    取消
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <Button
                                  size="sm"
                                  className="bg-green-600 hover:bg-green-700"
                                  disabled={reviewMutation.isPending}
                                  onClick={() => reviewMutation.mutate({ id: a.id, status: "approved" })}
                                  data-testid={`button-approve-${a.id}`}
                                >
                                  <CheckCircle className="h-3.5 w-3.5 mr-1" />
                                  批准
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-red-600 border-red-200 hover:bg-red-50"
                                  onClick={() => setReviewingId(a.id)}
                                  data-testid={`button-reject-${a.id}`}
                                >
                                  <XCircle className="h-3.5 w-3.5 mr-1" />
                                  駁回
                                </Button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {activeTab === "overtime" && (
        <>
          <div className="flex items-center gap-2">
            <Button
              variant={overtimeFilter === "pending" ? "default" : "outline"}
              size="sm"
              onClick={() => setOvertimeFilter("pending")}
              data-testid="button-ot-filter-pending"
            >
              待審核
            </Button>
            <Button
              variant={overtimeFilter === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setOvertimeFilter("all")}
              data-testid="button-ot-filter-all"
            >
              全部
            </Button>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">加班申請列表</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {overtimeLoading ? (
                <div className="p-8 text-center text-muted-foreground">載入中...</div>
              ) : overtimeRequests.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  {overtimeFilter === "pending" ? "目前沒有待審核的加班申請" : "沒有加班申請紀錄"}
                </div>
              ) : (
                <div className="divide-y">
                  {overtimeRequests.map((o) => (
                    <div key={o.id} className="p-4 hover:bg-muted/30" data-testid={`row-overtime-${o.id}`}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium" data-testid={`text-ot-name-${o.id}`}>{o.employeeName}</span>
                            <span className="text-xs text-muted-foreground">{o.employeeCode}</span>
                            {o.status === "pending" && (
                              <Badge className="bg-orange-500/10 text-orange-600 border-orange-500/20" data-testid={`badge-ot-pending-${o.id}`}>待審核</Badge>
                            )}
                            {o.status === "approved" && (
                              <Badge className="bg-green-500/10 text-green-600 border-green-500/20" data-testid={`badge-ot-approved-${o.id}`}>已批准</Badge>
                            )}
                            {o.status === "rejected" && (
                              <Badge className="bg-red-500/10 text-red-600 border-red-500/20" data-testid={`badge-ot-rejected-${o.id}`}>已駁回</Badge>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            <span>日期：</span>
                            <span className="font-medium text-foreground">{o.date}</span>
                            <span className="ml-2">時間：</span>
                            <span className="font-medium text-foreground">{o.startTime}~{o.endTime}</span>
                          </div>
                          <div className="text-sm text-muted-foreground mt-0.5">
                            原因：{o.reason}
                          </div>
                          {formatReviewInfo(o.reviewedByName, o.reviewedAt) && (
                            <div className="text-xs text-muted-foreground mt-1">
                              {formatReviewInfo(o.reviewedByName, o.reviewedAt)}
                            </div>
                          )}
                          {o.reviewNote && (
                            <div className="text-xs text-muted-foreground mt-1">
                              審核備註：{o.reviewNote}
                            </div>
                          )}
                          <div className="text-xs text-muted-foreground mt-1">
                            送出時間：{new Date(o.createdAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          </div>
                        </div>

                        {o.status === "pending" && (
                          <div className="flex flex-col gap-2 shrink-0">
                            {otReviewingId === o.id ? (
                              <div className="space-y-2 w-48">
                                <Input
                                  placeholder="駁回備註（選填）"
                                  value={otReviewNote}
                                  onChange={(e) => setOtReviewNote(e.target.value)}
                                  className="text-sm"
                                  data-testid={`input-ot-review-note-${o.id}`}
                                />
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    className="flex-1"
                                    disabled={otReviewMutation.isPending}
                                    onClick={() => otReviewMutation.mutate({ id: o.id, status: "rejected", note: otReviewNote })}
                                    data-testid={`button-ot-confirm-reject-${o.id}`}
                                  >
                                    確認駁回
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => { setOtReviewingId(null); setOtReviewNote(""); }}
                                    data-testid={`button-ot-cancel-reject-${o.id}`}
                                  >
                                    取消
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <Button
                                  size="sm"
                                  className="bg-green-600 hover:bg-green-700"
                                  disabled={otReviewMutation.isPending}
                                  onClick={() => otReviewMutation.mutate({ id: o.id, status: "approved" })}
                                  data-testid={`button-ot-approve-${o.id}`}
                                >
                                  <CheckCircle className="h-3.5 w-3.5 mr-1" />
                                  批准
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-red-600 border-red-200 hover:bg-red-50"
                                  onClick={() => setOtReviewingId(o.id)}
                                  data-testid={`button-ot-reject-${o.id}`}
                                >
                                  <XCircle className="h-3.5 w-3.5 mr-1" />
                                  駁回
                                </Button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
