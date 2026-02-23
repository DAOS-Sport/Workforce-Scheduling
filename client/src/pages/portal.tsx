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
  ChevronLeft, ChevronRight, Calendar, List,
  Video, FileText, CheckCircle2, Lock, UserCheck,
  AlertTriangle, ClipboardCheck, BookOpen, Navigation, Loader2, XCircle
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
  assignedRole: string | null;
}

interface CoworkerGroup {
  venue: { id: number; shortName: string } | null;
  shiftTime: string;
  myRole: string | null;
  coworkers: { id: number; name: string; phone: string | null; role: string; shiftRole: string; shiftTime: string | null }[];
}

interface AttendanceSummary {
  total: number;
  late: number;
  earlyLeave: number;
  anomaly: number;
  leave: number;
  records: {
    date: string;
    clockIn: string | null;
    clockOut: string | null;
    isLate: boolean | null;
    isEarlyLeave: boolean | null;
    hasAnomaly: boolean | null;
    leaveType: string | null;
  }[];
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
  "救生": "救生",
  "守望": "守望",
  "櫃台": "櫃台",
};

const ROLE_DISPLAY: Record<string, { label: string; taskLabel: string; color: string; bgClass: string; borderClass: string; textClass: string; badgeBg: string }> = {
  "櫃檯": { label: "櫃檯", taskLabel: "櫃台服務", color: "#3B82F6", bgClass: "bg-blue-500/10", borderClass: "border-l-blue-500", textClass: "text-blue-500", badgeBg: "bg-blue-500/15 text-blue-400" },
  "救生": { label: "救生", taskLabel: "救生執勤", color: "#10B981", bgClass: "bg-emerald-500/10", borderClass: "border-l-emerald-500", textClass: "text-emerald-500", badgeBg: "bg-emerald-500/15 text-emerald-400" },
  "守望": { label: "守望", taskLabel: "守望執勤", color: "#F59E0B", bgClass: "bg-amber-500/10", borderClass: "border-l-amber-500", textClass: "text-amber-500", badgeBg: "bg-amber-500/15 text-amber-400" },
};

function getRoleDisplay(role: string | null | undefined) {
  if (!role) return ROLE_DISPLAY["救生"];
  return ROLE_DISPLAY[role] || ROLE_DISPLAY["救生"];
}

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

interface ClockInResult {
  status: "success" | "warning" | "fail" | "error";
  clockType: "in" | "out";
  venueName: string | null;
  distance: number | null;
  time: string;
  date: string;
  shiftInfo: string | null;
  failReason: string | null;
  employeeName: string | null;
  radius: number | null;
}

function GpsClockInCard({ employee }: { employee: PortalEmployee }) {
  const [stage, setStage] = useState<"idle" | "locating" | "submitting" | "done" | "error">("idle");
  const [result, setResult] = useState<ClockInResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const { toast } = useToast();

  const [lineUserId, setLineUserId] = useState<string | null>(null);
  useEffect(() => {
    const stored = localStorage.getItem("portal_line_user_id");
    if (stored) setLineUserId(stored);
  }, []);

  const handleClockIn = useCallback(async () => {
    if (!lineUserId) {
      toast({ title: "無法打卡", description: "請重新登入以綁定 LINE 帳號", variant: "destructive" });
      return;
    }
    setStage("locating");
    setResult(null);

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        });
      });

      const { latitude, longitude, accuracy: acc } = position.coords;
      setAccuracy(Math.round(acc));
      setStage("submitting");

      const resp = await fetch("/api/liff/clock-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineUserId, latitude, longitude, accuracy: Math.round(acc) }),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.message || "打卡請求失敗");
      }

      const data: ClockInResult = await resp.json();
      setResult(data);
      setStage("done");
    } catch (err: any) {
      if (err.code === 1) {
        setErrorMsg("請允許位置存取權限");
      } else if (err.code === 2) {
        setErrorMsg("無法取得位置，請確認 GPS 已開啟");
      } else if (err.code === 3) {
        setErrorMsg("定位逾時，請到空曠處再試");
      } else {
        setErrorMsg(err.message || "打卡過程發生錯誤");
      }
      setStage("error");
    }
  }, [lineUserId, toast]);

  const statusConfig = result ? {
    success: { icon: CheckCircle2, color: "text-green-500", bg: "bg-green-500/10", label: result.clockType === "in" ? "上班打卡成功" : "下班打卡成功" },
    warning: { icon: AlertTriangle, color: "text-yellow-500", bg: "bg-yellow-500/10", label: "已記錄（無排班）" },
    fail: { icon: XCircle, color: "text-red-500", bg: "bg-red-500/10", label: result.failReason || "打卡失敗" },
    error: { icon: XCircle, color: "text-red-500", bg: "bg-red-500/10", label: result.failReason || "錯誤" },
  }[result.status] : null;

  return (
    <Card className="p-4" data-testid="card-gps-clock-in">
      <h2 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
        <Navigation className="h-4 w-4" /> GPS 打卡
      </h2>

      {stage === "idle" && (
        <Button
          className="w-full h-12 text-base font-semibold"
          onClick={handleClockIn}
          data-testid="button-gps-clock-in"
        >
          <MapPin className="mr-2 h-5 w-5" />
          一鍵打卡
        </Button>
      )}

      {stage === "locating" && (
        <div className="flex items-center justify-center gap-2 py-3">
          <Navigation className="h-5 w-5 text-blue-500 animate-pulse" />
          <span className="text-sm text-muted-foreground">正在定位中...</span>
        </div>
      )}

      {stage === "submitting" && (
        <div className="flex items-center justify-center gap-2 py-3">
          <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
          <span className="text-sm text-muted-foreground">處理打卡中...</span>
        </div>
      )}

      {stage === "done" && result && statusConfig && (
        <div>
          <div className={`flex items-center gap-2 p-3 rounded-lg ${statusConfig.bg} mb-3`}>
            <statusConfig.icon className={`h-5 w-5 ${statusConfig.color}`} />
            <span className={`font-medium text-sm ${statusConfig.color}`}>{statusConfig.label}</span>
          </div>
          <div className="text-xs space-y-1 text-muted-foreground">
            {result.venueName && <p>場館：{result.venueName}</p>}
            {result.distance !== null && <p>距離：{result.distance}m{result.radius ? ` / 需在 ${result.radius}m 內` : ""}</p>}
            <p>時間：{result.time}</p>
            {result.shiftInfo && <p>班別：{result.shiftInfo}</p>}
            {accuracy && <p>GPS 精度：±{accuracy}m</p>}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full mt-3"
            onClick={() => { setStage("idle"); setResult(null); }}
            data-testid="button-clock-again"
          >
            再次打卡
          </Button>
        </div>
      )}

      {stage === "error" && (
        <div>
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 mb-3">
            <XCircle className="h-5 w-5 text-red-500" />
            <span className="font-medium text-sm text-red-500">{errorMsg}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => { setStage("idle"); setErrorMsg(""); }}
            data-testid="button-retry-clock"
          >
            重試
          </Button>
        </div>
      )}
    </Card>
  );
}

function PortalMain({ employee }: { employee: PortalEmployee }) {
  const [viewMode, setViewMode] = useState<"calendar" | "list">("calendar");
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [showGuidelines, setShowGuidelines] = useState(false);

  const monthStart = format(startOfMonth(currentMonth), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(currentMonth), "yyyy-MM-dd");

  const { data: myShifts = [], isLoading: shiftsLoading } = useQuery<PortalShift[]>({
    queryKey: ["/api/portal/my-shifts", employee.id, monthStart, monthEnd],
  });

  const { data: todayCoworkers = [], isLoading: coworkersLoading } = useQuery<CoworkerGroup[]>({
    queryKey: ["/api/portal/today-coworkers", employee.id],
  });

  const { data: attendance, isLoading: attendanceLoading } = useQuery<AttendanceSummary>({
    queryKey: ["/api/portal/my-attendance", employee.id],
  });

  const { data: guidelinesData } = useQuery<{ items: GuidelineItem[]; allAcknowledged: boolean }>({
    queryKey: ["/api/portal/guidelines-check", employee.id],
    enabled: showGuidelines,
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
        <GpsClockInCard employee={employee} />

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
                  if (!day) return <div key={`pad-${idx}`} className="min-h-[72px]" />;
                  const dateStr = format(day, "yyyy-MM-dd");
                  const dayShifts = shiftsByDate.get(dateStr) || [];
                  const today = isToday(day);
                  return (
                    <div
                      key={dateStr}
                      className={`min-h-[72px] p-0.5 rounded-md border ${
                        today ? "border-primary bg-primary/5" : "border-transparent"
                      } ${dayShifts.length > 0 ? "bg-muted/50" : ""}`}
                      data-testid={`cell-day-${dateStr}`}
                    >
                      <div className={`text-xs text-center mb-0.5 ${today ? "font-bold text-primary" : "text-muted-foreground"}`}>
                        {format(day, "d")}
                      </div>
                      {dayShifts.slice(0, 2).map((s, i) => {
                        const rd = getRoleDisplay(s.assignedRole);
                        return (
                          <div key={i} className={`text-[10px] leading-tight px-0.5 rounded-sm border-l-2 pl-1 mb-0.5 ${rd.borderClass}`}>
                            <div className="font-medium truncate">{s.venue?.shortName?.slice(0, 3) || ""}</div>
                            <div className={`truncate font-medium ${rd.textClass}`}>{s.startTime.slice(0, 5)}-{s.endTime.slice(0, 5)}</div>
                          </div>
                        );
                      })}
                      {dayShifts.length > 2 && (
                        <div className="text-[10px] text-muted-foreground text-center">+{dayShifts.length - 2}</div>
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
                    const rd = getRoleDisplay(s.assignedRole);
                    const isLifeguard = s.assignedRole === "救生";
                    return (
                      <div
                        key={s.id}
                        className={`relative flex items-center gap-3 py-3 px-3 rounded-lg border-l-4 ${rd.borderClass} ${rd.bgClass} overflow-hidden ${
                          isToday(d) ? "ring-1 ring-primary/30" : ""
                        }`}
                        data-testid={`shift-row-${s.id}`}
                      >
                        {isLifeguard && (
                          <div className="absolute inset-0 pointer-events-none opacity-[0.04]" aria-hidden="true">
                            <svg className="w-full h-full" viewBox="0 0 200 60" preserveAspectRatio="none">
                              <path d="M0,30 Q25,10 50,30 T100,30 T150,30 T200,30" fill="none" stroke="currentColor" strokeWidth="3" className="text-emerald-500" />
                              <path d="M0,40 Q25,20 50,40 T100,40 T150,40 T200,40" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-500" />
                            </svg>
                          </div>
                        )}
                        <div className="text-center min-w-[50px] relative z-10">
                          <div className="text-xs text-muted-foreground">{format(d, "M/d")}</div>
                          <div className={`text-xs ${dayLabel === "日" || dayLabel === "六" ? "text-destructive" : ""}`}>
                            ({dayLabel})
                          </div>
                        </div>
                        <div className="flex-1 min-w-0 relative z-10">
                          <div className="flex items-center gap-1.5">
                            <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="text-sm font-medium truncate">{s.venue?.shortName || "未知"}</span>
                            {s.isDispatch && <Badge variant="secondary" className="text-xs">派遣</Badge>}
                          </div>
                          <div className="flex items-center gap-1.5 mt-1">
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              {s.startTime.slice(0, 5)} - {s.endTime.slice(0, 5)}
                            </div>
                            <Badge className={`text-[10px] border-0 ${rd.badgeBg}`} data-testid={`badge-role-${s.id}`}>
                              [{rd.taskLabel}]
                            </Badge>
                          </div>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          )}

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
              {todayCoworkers.map((group, gIdx) => {
                const roleGroups = new Map<string, typeof group.coworkers>();
                group.coworkers.forEach((cw) => {
                  const key = cw.shiftRole || "其他";
                  if (!roleGroups.has(key)) roleGroups.set(key, []);
                  roleGroups.get(key)!.push(cw);
                });

                return (
                  <div key={gIdx}>
                    <div className="flex items-center gap-1.5 mb-3">
                      <Badge variant="outline" className="text-xs">
                        <MapPin className="h-3 w-3 mr-0.5" />
                        {group.venue?.shortName || "未知"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{group.shiftTime}</span>
                      {group.myRole && (
                        <Badge className={`text-[10px] border-0 ${getRoleDisplay(group.myRole).badgeBg}`}>
                          我的崗位：{getRoleDisplay(group.myRole).taskLabel}
                        </Badge>
                      )}
                    </div>
                    {group.coworkers.length === 0 ? (
                      <p className="text-xs text-muted-foreground pl-2">今日僅你一人在此場館</p>
                    ) : (
                      <div className="space-y-3">
                        {Array.from(roleGroups.entries()).map(([roleName, members]) => {
                          const rd = getRoleDisplay(roleName);
                          return (
                            <div key={roleName} className={`rounded-lg border-l-4 ${rd.borderClass} ${rd.bgClass} p-3`}>
                              <div className="flex items-center gap-1.5 mb-2">
                                <div className={`h-2 w-2 rounded-full`} style={{ backgroundColor: rd.color }} />
                                <span className={`text-xs font-semibold ${rd.textClass}`}>
                                  今日{rd.label}夥伴
                                </span>
                                <span className="text-[10px] text-muted-foreground">({members.length}人)</span>
                              </div>
                              <div className="space-y-1.5">
                                {members.map((cw) => (
                                  <div
                                    key={cw.id}
                                    className="flex items-center justify-between gap-2 py-1"
                                    data-testid={`coworker-row-${cw.id}`}
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="text-sm font-medium truncate">{cw.name}</span>
                                      {cw.shiftTime && (
                                        <span className="text-[10px] text-muted-foreground shrink-0">{cw.shiftTime}</span>
                                      )}
                                    </div>
                                    {cw.phone && (
                                      <a
                                        href={`tel:${cw.phone}`}
                                        className="shrink-0"
                                        data-testid={`button-call-${cw.id}`}
                                      >
                                        <Button size="icon" variant="ghost">
                                          <Phone className="h-4 w-4 text-green-500" />
                                        </Button>
                                      </a>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="p-4" data-testid="card-attendance-summary">
          <h2 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
            <ClipboardCheck className="h-4 w-4" /> 本月出缺勤
          </h2>
          {attendanceLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : !attendance || attendance.total === 0 ? (
            <p className="text-sm text-center text-muted-foreground py-3">本月尚無出勤紀錄</p>
          ) : (
            <div>
              <div className="grid grid-cols-4 gap-2 mb-3">
                <div className="text-center p-2 rounded-md bg-muted/50">
                  <div className="text-lg font-bold" data-testid="text-attendance-total">{attendance.total}</div>
                  <div className="text-[10px] text-muted-foreground">出勤天數</div>
                </div>
                <div className="text-center p-2 rounded-md bg-muted/50">
                  <div className={`text-lg font-bold ${attendance.late > 0 ? "text-destructive" : ""}`} data-testid="text-attendance-late">{attendance.late}</div>
                  <div className="text-[10px] text-muted-foreground">遲到</div>
                </div>
                <div className="text-center p-2 rounded-md bg-muted/50">
                  <div className={`text-lg font-bold ${attendance.earlyLeave > 0 ? "text-destructive" : ""}`} data-testid="text-attendance-early">{attendance.earlyLeave}</div>
                  <div className="text-[10px] text-muted-foreground">早退</div>
                </div>
                <div className="text-center p-2 rounded-md bg-muted/50">
                  <div className={`text-lg font-bold ${attendance.anomaly > 0 ? "text-destructive" : ""}`} data-testid="text-attendance-anomaly">{attendance.anomaly}</div>
                  <div className="text-[10px] text-muted-foreground">異常</div>
                </div>
              </div>
              {(attendance.late > 0 || attendance.earlyLeave > 0 || attendance.anomaly > 0) && (
                <div className="space-y-1.5">
                  {attendance.records
                    .filter((r) => r.isLate || r.isEarlyLeave || r.hasAnomaly)
                    .map((r, idx) => {
                      const d = parseISO(r.date);
                      const tags: string[] = [];
                      if (r.isLate) tags.push("遲到");
                      if (r.isEarlyLeave) tags.push("早退");
                      if (r.hasAnomaly) tags.push("異常");
                      return (
                        <div key={idx} className="flex items-center gap-2 text-xs py-1 border-b last:border-b-0">
                          <span className="text-muted-foreground min-w-[50px]">{format(d, "M/d")}</span>
                          <span className="text-muted-foreground">{r.clockIn || "--"} ~ {r.clockOut || "--"}</span>
                          <div className="flex gap-1 ml-auto">
                            {tags.map((t) => (
                              <Badge key={t} variant="destructive" className="text-[10px]">
                                <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                                {t}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}
        </Card>

        <Card className="p-4" data-testid="card-guidelines-review">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <BookOpen className="h-4 w-4" /> 員工守則
            </h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowGuidelines(!showGuidelines)}
              data-testid="button-toggle-guidelines"
            >
              {showGuidelines ? "收合" : "查看守則"}
            </Button>
          </div>
          {showGuidelines && (
            <div className="mt-3 space-y-2">
              {!guidelinesData ? (
                <Skeleton className="h-24 w-full" />
              ) : guidelinesData.items.length === 0 ? (
                <p className="text-sm text-center text-muted-foreground py-3">目前沒有守則</p>
              ) : (
                guidelinesData.items.map((item) => (
                  <GuidelineItemCard key={item.id} item={item} />
                ))
              )}
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

  const handleLogin = useCallback((emp: any) => {
    if (emp.lineUserId) {
      localStorage.setItem("portal_line_user_id", emp.lineUserId);
    }
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
