import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday, parseISO, getDay } from "date-fns";
import { zhTW } from "date-fns/locale";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CalendarDays, Phone, MapPin, Clock, Users, ShieldCheck,
  ChevronLeft, ChevronRight, Calendar, List, Download,
  Video, FileText, CheckCircle2, Lock, UserCheck
} from "lucide-react";

interface PortalEmployee {
  id: number;
  name: string;
  employeeCode: string;
  role: string;
}

interface PortalShift {
  id: number;
  venueId: number;
  date: string;
  startTime: string;
  endTime: string;
  isDispatch: boolean;
  venue: { id: number; name: string; shortName: string } | null;
}

interface CoworkerGroup {
  venue: { id: number; shortName: string } | null;
  shiftTime: string;
  coworkers: { id: number; name: string; phone: string | null; role: string }[];
}

interface GuidelineItem {
  id: number;
  category: string;
  title: string;
  content: string;
  contentType: string;
  videoUrl: string | null;
  venueName: string | null;
  acknowledged: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  pt: "教練",
  lifeguard: "救生",
  counter: "櫃檯",
  cleaning: "清潔",
  manager: "管理",
};

const DAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

function Watermark({ name, code }: { name: string; code: string }) {
  const text = `${name} ${code}`;
  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden select-none" aria-hidden="true">
      <div className="absolute inset-0" style={{ transform: "rotate(-30deg)", transformOrigin: "center center" }}>
        {Array.from({ length: 20 }).map((_, row) => (
          <div key={row} className="flex whitespace-nowrap" style={{ marginTop: row === 0 ? "-100px" : "60px" }}>
            {Array.from({ length: 10 }).map((_, col) => (
              <span
                key={col}
                className="text-[14px] font-medium mx-16"
                style={{ color: "rgba(128,128,128,0.08)" }}
              >
                {text}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function LineLoginScreen({ onLogin }: { onLogin: (emp: PortalEmployee) => void }) {
  const { toast } = useToast();
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const lineId = params.get("lineId");

    if (code) {
      handleLineCallback(code);
    } else if (lineId) {
      verifyLineId(lineId);
    }
  }, []);

  async function handleLineCallback(code: string) {
    setChecking(true);
    try {
      const redirectUri = `${window.location.origin}/portal/callback`;
      const res = await apiRequest("POST", "/api/portal/line-callback", { code, redirectUri });
      const data = await res.json();
      window.history.replaceState({}, "", "/portal");
      onLogin(data);
    } catch (err: any) {
      toast({
        title: "LINE 登入失敗",
        description: err.message || "驗證失敗",
        variant: "destructive",
      });
      window.history.replaceState({}, "", "/portal");
    } finally {
      setChecking(false);
    }
  }

  async function verifyLineId(lineId: string) {
    setChecking(true);
    try {
      const res = await apiRequest("POST", "/api/portal/verify", { lineId });
      const data = await res.json();
      onLogin(data);
    } catch (err: any) {
      toast({
        title: "驗證失敗",
        description: err.message || "找不到此 LINE 帳號對應的員工資料",
        variant: "destructive",
      });
    } finally {
      setChecking(false);
    }
  }

  function handleLineLogin() {
    const channelId = import.meta.env.VITE_LINE_CHANNEL_ID;
    if (!channelId) {
      toast({
        title: "LINE Login 尚未設定",
        description: "請聯繫管理員設定 LINE Login",
        variant: "destructive",
      });
      return;
    }
    const redirectUri = encodeURIComponent(`${window.location.origin}/portal/callback`);
    const state = Math.random().toString(36).substring(7);
    const lineAuthUrl = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${channelId}&redirect_uri=${redirectUri}&state=${state}&scope=profile%20openid`;
    window.location.href = lineAuthUrl;
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6 text-center">
        <div className="mb-6">
          <div className="w-16 h-16 rounded-full bg-[#06C755] flex items-center justify-center mx-auto mb-4">
            <ShieldCheck className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-xl font-bold mb-1" data-testid="text-portal-title">員工入口</h1>
          <p className="text-sm text-muted-foreground">請使用 LINE 帳號登入</p>
        </div>

        {checking ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <p className="text-sm text-muted-foreground">驗證中...</p>
          </div>
        ) : (
          <Button
            className="w-full bg-[#06C755] hover:bg-[#05b04c] text-white"
            onClick={handleLineLogin}
            data-testid="button-line-login"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 mr-2 fill-current">
              <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
            </svg>
            LINE 登入
          </Button>
        )}

        <div className="mt-6 pt-4 border-t">
          <p className="text-xs text-muted-foreground">首次登入請確認您的 LINE 帳號已由管理員綁定</p>
        </div>

        <DevModeLogin onLogin={onLogin} />
      </Card>
    </div>
  );
}

function DevModeLogin({ onLogin }: { onLogin: (emp: PortalEmployee) => void }) {
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const { data: employees } = useQuery<{ id: number; name: string; employeeCode: string; role: string }[]>({
    queryKey: ["/api/portal/dev-employees"],
  });

  async function handleDevLogin() {
    if (!selectedId) return;
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/portal/dev-login", { employeeId: Number(selectedId) });
      const data = await res.json();
      onLogin(data);
    } catch (err: any) {
      toast({ title: "登入失敗", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  if (!employees || employees.length === 0) return null;

  return (
    <div className="mt-4 pt-4 border-t">
      <p className="text-xs text-muted-foreground mb-3 flex items-center justify-center gap-1">
        <UserCheck className="h-3 w-3" />
        開發模式 - 快速預覽
      </p>
      <div className="flex gap-2">
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger className="flex-1" data-testid="select-dev-employee">
            <SelectValue placeholder="選擇員工" />
          </SelectTrigger>
          <SelectContent>
            {employees.map((emp) => (
              <SelectItem key={emp.id} value={String(emp.id)} data-testid={`option-dev-employee-${emp.id}`}>
                {emp.name}（{emp.employeeCode}）
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          onClick={handleDevLogin}
          disabled={!selectedId || loading}
          data-testid="button-dev-login"
        >
          進入
        </Button>
      </div>
    </div>
  );
}

function GuidelinesCheckScreen({
  employee,
  onComplete,
}: {
  employee: PortalEmployee;
  onComplete: () => void;
}) {
  const { toast } = useToast();
  const [confirmed, setConfirmed] = useState(false);

  const { data, isLoading } = useQuery<{ items: GuidelineItem[]; allAcknowledged: boolean }>({
    queryKey: ["/api/portal/guidelines-check", employee.id],
  });

  useEffect(() => {
    if (data?.allAcknowledged) {
      onComplete();
    }
  }, [data?.allAcknowledged, onComplete]);

  const ackMutation = useMutation({
    mutationFn: async () => {
      if (!data) return;
      const guidelineIds = data.items.filter((i) => !i.acknowledged).map((i) => i.id);
      const res = await apiRequest("POST", "/api/portal/acknowledge-all", {
        employeeId: employee.id,
        guidelineIds,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/guidelines-check", employee.id] });
      toast({ title: "已確認所有守則" });
      onComplete();
    },
    onError: (err: Error) => {
      toast({ title: "確認失敗", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  const items = data?.items || [];
  const fixedItems = items.filter((i) => i.category === "fixed");
  const monthlyItems = items.filter((i) => i.category === "monthly");
  const confidentialityItems = items.filter((i) => i.category === "confidentiality");
  const unacknowledged = items.filter((i) => !i.acknowledged);

  return (
    <div className="min-h-screen bg-background">
      <Watermark name={employee.name} code={employee.employeeCode} />

      <div className="sticky top-0 z-40 bg-background border-b p-4">
        <h1 className="text-lg font-bold" data-testid="text-guidelines-title">守則確認</h1>
        <p className="text-xs text-muted-foreground">請詳閱以下內容後確認</p>
      </div>

      <div className="p-4 pb-32 space-y-4 max-w-lg mx-auto">
        {fixedItems.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <FileText className="h-4 w-4" /> 場館守則
            </h2>
            {fixedItems.map((item) => (
              <GuidelineItemCard key={item.id} item={item} />
            ))}
          </div>
        )}

        {monthlyItems.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4" /> 本月公告
            </h2>
            {monthlyItems.map((item) => (
              <GuidelineItemCard key={item.id} item={item} />
            ))}
          </div>
        )}

        {confidentialityItems.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <Lock className="h-4 w-4" /> 保密同意書
            </h2>
            {confidentialityItems.map((item) => (
              <GuidelineItemCard key={item.id} item={item} />
            ))}
          </div>
        )}

        {items.length === 0 && (
          <Card className="p-8 text-center">
            <CheckCircle2 className="h-10 w-10 mx-auto mb-2 text-green-500" />
            <p className="text-sm text-muted-foreground">目前沒有需要確認的守則</p>
          </Card>
        )}
      </div>

      {unacknowledged.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-background border-t p-4">
          <div className="max-w-lg mx-auto space-y-3">
            <label className="flex items-start gap-2 cursor-pointer" data-testid="label-confirm-checkbox">
              <Checkbox
                checked={confirmed}
                onCheckedChange={(v) => setConfirmed(v === true)}
                className="mt-0.5"
                data-testid="checkbox-confirm-guidelines"
              />
              <span className="text-xs leading-relaxed">
                我已詳閱以上所有守則與公告，了解並承諾遵守保密義務及各項工作規範。
              </span>
            </label>
            <Button
              className="w-full"
              disabled={!confirmed || ackMutation.isPending}
              onClick={() => ackMutation.mutate()}
              data-testid="button-confirm-guidelines"
            >
              {ackMutation.isPending ? "確認中..." : `確認已閱讀 (${unacknowledged.length} 項)`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function GuidelineItemCard({ item }: { item: GuidelineItem }) {
  return (
    <Card className="p-3" data-testid={`card-portal-guideline-${item.id}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <span className="text-sm font-medium">{item.title}</span>
            {item.venueName && (
              <Badge variant="outline" className="text-xs">
                <MapPin className="h-3 w-3 mr-0.5" />
                {item.venueName}
              </Badge>
            )}
            {item.contentType === "video" && (
              <Badge variant="outline" className="text-xs">
                <Video className="h-3 w-3 mr-0.5" />
                影片
              </Badge>
            )}
            {item.acknowledged && (
              <Badge variant="default" className="text-xs">
                <CheckCircle2 className="h-3 w-3 mr-0.5" />
                已確認
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground whitespace-pre-wrap">{item.content}</p>
          {item.contentType === "video" && item.videoUrl && (
            <a
              href={item.videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary underline mt-1 inline-block"
              data-testid={`link-video-${item.id}`}
            >
              觀看影片
            </a>
          )}
        </div>
      </div>
    </Card>
  );
}

function PortalMain({ employee }: { employee: PortalEmployee }) {
  const [viewMode, setViewMode] = useState<"calendar" | "list">("calendar");
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const monthStart = format(startOfMonth(currentMonth), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(currentMonth), "yyyy-MM-dd");

  const { data: myShifts = [], isLoading: shiftsLoading } = useQuery<PortalShift[]>({
    queryKey: ["/api/portal/my-shifts", employee.id, monthStart, monthEnd],
  });

  const { data: todayCoworkers = [], isLoading: coworkersLoading } = useQuery<CoworkerGroup[]>({
    queryKey: ["/api/portal/today-coworkers", employee.id],
  });

  const shiftsByDate = useMemo(() => {
    const map = new Map<string, PortalShift[]>();
    myShifts.forEach((s) => {
      const key = s.date;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    });
    return map;
  }, [myShifts]);

  function prevMonth() {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  }

  function nextMonth() {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  }

  function generateICS() {
    let ics = "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//PT Schedule//EN\nCALSCALE:GREGORIAN\n";
    myShifts.forEach((s) => {
      const dateClean = s.date.replace(/-/g, "");
      const startClean = s.startTime.slice(0, 5).replace(":", "") + "00";
      const endClean = s.endTime.slice(0, 5).replace(":", "") + "00";
      const venueName = s.venue?.shortName || "";
      ics += "BEGIN:VEVENT\n";
      ics += `DTSTART;TZID=Asia/Taipei:${dateClean}T${startClean}\n`;
      ics += `DTEND;TZID=Asia/Taipei:${dateClean}T${endClean}\n`;
      ics += `SUMMARY:${venueName} 上班\n`;
      ics += `DESCRIPTION:${employee.name} - ${venueName}\n`;
      ics += `UID:${s.id}-${dateClean}@pt-schedule\n`;
      ics += "END:VEVENT\n";
    });
    ics += "END:VCALENDAR";
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `schedule-${format(currentMonth, "yyyy-MM")}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function addToGoogleCalendar() {
    if (myShifts.length === 0) return;
    const s = myShifts[0];
    const dateClean = s.date.replace(/-/g, "");
    const startClean = s.startTime.slice(0, 5).replace(":", "") + "00";
    const endClean = s.endTime.slice(0, 5).replace(":", "") + "00";
    const venueName = s.venue?.shortName || "上班";
    const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(venueName + " 上班")}&dates=${dateClean}T${startClean}/${dateClean}T${endClean}&ctz=Asia/Taipei&details=${encodeURIComponent(employee.name + " - " + venueName)}`;
    window.open(url, "_blank");
  }

  const calendarDays = useMemo(() => {
    const monthS = startOfMonth(currentMonth);
    const monthE = endOfMonth(currentMonth);
    const days = eachDayOfInterval({ start: monthS, end: monthE });

    const startDow = getDay(monthS);
    const padding: (Date | null)[] = Array.from({ length: startDow }, () => null);
    return [...padding, ...days];
  }, [currentMonth]);

  return (
    <div className="min-h-screen bg-background pb-8">
      <Watermark name={employee.name} code={employee.employeeCode} />

      <div className="sticky top-0 z-40 bg-background border-b">
        <div className="p-4 flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold" data-testid="text-portal-main-title">
              {employee.name}
            </h1>
            <p className="text-xs text-muted-foreground">
              {employee.employeeCode} / {ROLE_LABELS[employee.role] || employee.role}
            </p>
          </div>
          <Badge variant="outline" className="text-xs">
            <ShieldCheck className="h-3 w-3 mr-1" />
            已驗證
          </Badge>
        </div>
      </div>

      <div className="max-w-lg mx-auto p-4 space-y-4">
        <Card className="p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4" /> 我的班表
            </h2>
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setViewMode(viewMode === "calendar" ? "list" : "calendar")}
                data-testid="button-toggle-view"
              >
                {viewMode === "calendar" ? <List className="h-4 w-4" /> : <Calendar className="h-4 w-4" />}
              </Button>
              <Button size="icon" variant="ghost" onClick={generateICS} data-testid="button-export-ics">
                <Download className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 mb-3">
            <Button size="icon" variant="ghost" onClick={prevMonth} data-testid="button-prev-month">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium" data-testid="text-current-month">
              {format(currentMonth, "yyyy年 M月", { locale: zhTW })}
            </span>
            <Button size="icon" variant="ghost" onClick={nextMonth} data-testid="button-next-month">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {shiftsLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : viewMode === "calendar" ? (
            <div>
              <div className="grid grid-cols-7 gap-px mb-1">
                {DAY_LABELS.map((d) => (
                  <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-px">
                {calendarDays.map((day, idx) => {
                  if (!day) return <div key={`pad-${idx}`} className="h-16" />;
                  const dateStr = format(day, "yyyy-MM-dd");
                  const dayShifts = shiftsByDate.get(dateStr) || [];
                  const today = isToday(day);
                  return (
                    <div
                      key={dateStr}
                      className={`h-16 p-0.5 rounded-md border text-center ${
                        today ? "border-primary bg-primary/5" : "border-transparent"
                      } ${dayShifts.length > 0 ? "bg-muted/50" : ""}`}
                      data-testid={`cell-day-${dateStr}`}
                    >
                      <div className={`text-xs ${today ? "font-bold text-primary" : "text-muted-foreground"}`}>
                        {format(day, "d")}
                      </div>
                      {dayShifts.slice(0, 2).map((s, i) => (
                        <div key={i} className="text-[10px] leading-tight truncate">
                          <span className="font-medium">{s.venue?.shortName?.slice(0, 3) || ""}</span>
                        </div>
                      ))}
                      {dayShifts.length > 2 && (
                        <div className="text-[10px] text-muted-foreground">+{dayShifts.length - 2}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-auto">
              {myShifts.length === 0 ? (
                <p className="text-sm text-center text-muted-foreground py-4">本月無排班</p>
              ) : (
                myShifts
                  .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
                  .map((s) => {
                    const d = parseISO(s.date);
                    const dayLabel = DAY_LABELS[getDay(d)];
                    return (
                      <div
                        key={s.id}
                        className={`flex items-center gap-3 py-2 border-b last:border-b-0 ${
                          isToday(d) ? "bg-primary/5 rounded-md px-2 -mx-2" : ""
                        }`}
                        data-testid={`shift-row-${s.id}`}
                      >
                        <div className="text-center min-w-[50px]">
                          <div className="text-xs text-muted-foreground">{format(d, "M/d")}</div>
                          <div className={`text-xs ${dayLabel === "日" || dayLabel === "六" ? "text-destructive" : ""}`}>
                            ({dayLabel})
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="text-sm font-medium truncate">{s.venue?.shortName || "未知"}</span>
                            {s.isDispatch && <Badge variant="secondary" className="text-xs">派遣</Badge>}
                          </div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                            <Clock className="h-3 w-3" />
                            {s.startTime.slice(0, 5)} - {s.endTime.slice(0, 5)}
                          </div>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          )}

          <div className="flex gap-2 mt-3 pt-3 border-t">
            <Button variant="outline" size="sm" className="flex-1" onClick={generateICS} data-testid="button-sync-ios">
              <Download className="h-3 w-3 mr-1" />
              iOS 日曆
            </Button>
            <Button variant="outline" size="sm" className="flex-1" onClick={addToGoogleCalendar} data-testid="button-sync-google">
              <Calendar className="h-3 w-3 mr-1" />
              Google 日曆
            </Button>
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
            <Users className="h-4 w-4" /> 今日工作夥伴
          </h2>
          {coworkersLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : todayCoworkers.length === 0 ? (
            <p className="text-sm text-center text-muted-foreground py-4">今日無排班</p>
          ) : (
            <div className="space-y-4">
              {todayCoworkers.map((group, gIdx) => (
                <div key={gIdx}>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Badge variant="outline" className="text-xs">
                      <MapPin className="h-3 w-3 mr-0.5" />
                      {group.venue?.shortName || "未知"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{group.shiftTime}</span>
                  </div>
                  {group.coworkers.length === 0 ? (
                    <p className="text-xs text-muted-foreground pl-2">今日僅你一人在此場館</p>
                  ) : (
                    <div className="space-y-2">
                      {group.coworkers.map((cw) => (
                        <div
                          key={cw.id}
                          className="flex items-center justify-between gap-2 py-1.5"
                          data-testid={`coworker-row-${cw.id}`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{cw.name}</span>
                            <Badge variant="secondary" className="text-xs">
                              {ROLE_LABELS[cw.role] || cw.role}
                            </Badge>
                          </div>
                          {cw.phone && (
                            <a
                              href={`tel:${cw.phone}`}
                              className="shrink-0"
                              data-testid={`button-call-${cw.id}`}
                            >
                              <Button size="icon" variant="ghost">
                                <Phone className="h-4 w-4 text-green-600" />
                              </Button>
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function PortalPage() {
  const [employee, setEmployee] = useState<PortalEmployee | null>(null);
  const [guidelinesConfirmed, setGuidelinesConfirmed] = useState(false);

  const handleLogin = useCallback((emp: PortalEmployee) => {
    setEmployee(emp);
  }, []);

  const handleGuidelinesComplete = useCallback(() => {
    setGuidelinesConfirmed(true);
  }, []);

  if (!employee) {
    return <LineLoginScreen onLogin={handleLogin} />;
  }

  if (!guidelinesConfirmed) {
    return (
      <GuidelinesCheckScreen
        employee={employee}
        onComplete={handleGuidelinesComplete}
      />
    );
  }

  return <PortalMain employee={employee} />;
}
