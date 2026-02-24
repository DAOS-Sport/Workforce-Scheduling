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
  AlertTriangle, ClipboardCheck, BookOpen, Navigation, Loader2, XCircle,
  Wifi, Signal
} from "lucide-react";
import junsLogo from "@assets/logo_(1)_1771907823260.jpg";

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

interface NearbyVenue {
  id: number;
  name: string;
  shortName: string;
  distance: number;
  radius: number;
  inRange: boolean;
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
  nearbyVenues: NearbyVenue[];
  userLat: number | null;
  userLng: number | null;
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

function JunsHeader({ employee, showBack, onBack }: { employee?: PortalEmployee; showBack?: boolean; onBack?: () => void }) {
  return (
    <div className="sticky top-0 z-40 bg-juns-navy text-white">
      <div className="px-4 py-3 flex items-center gap-3">
        <img
          src={junsLogo}
          alt="駿斯運動"
          className="h-9 w-9 rounded-lg object-cover shrink-0"
          data-testid="img-juns-logo"
        />
        <div className="flex-1 min-w-0">
          {employee ? (
            <>
              <h1 className="text-sm font-semibold truncate" data-testid="text-portal-main-title">
                {employee.name}
              </h1>
              <p className="text-[11px] text-white/60">
                {employee.employeeCode} · {ROLE_LABELS[employee.role] || employee.role}
              </p>
            </>
          ) : (
            <h1 className="text-sm font-semibold">駿斯運動事業</h1>
          )}
        </div>
        {employee && (
          <div className="flex items-center gap-1 text-[11px] text-juns-green shrink-0">
            <ShieldCheck className="h-3.5 w-3.5" />
            已驗證
          </div>
        )}
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
    <div className="min-h-screen bg-juns-surface flex flex-col">
      <JunsHeader />
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="border border-juns-border rounded-xl bg-white p-6 text-center shadow-flat">
            <div className="mb-6">
              <div className="w-16 h-16 rounded-xl bg-[#06C755] flex items-center justify-center mx-auto mb-4">
                <ShieldCheck className="h-8 w-8 text-white" />
              </div>
              <h1 className="text-lg font-semibold text-juns-navy mb-1" data-testid="text-portal-title">員工入口</h1>
              <p className="text-sm text-slate-500">請使用 LINE 帳號登入</p>
            </div>

            {checking ? (
              <div className="space-y-3">
                <div className="h-11 rounded-lg bg-slate-100 animate-pulse" />
                <p className="text-sm text-slate-400">驗證中...</p>
              </div>
            ) : (
              <button
                className="w-full h-11 rounded-lg bg-[#06C755] hover:bg-[#05b04c] text-white font-medium text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
                onClick={handleLineLogin}
                data-testid="button-line-login"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                  <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
                </svg>
                LINE 登入
              </button>
            )}

            <div className="mt-5 pt-4 border-t border-juns-border">
              <p className="text-[11px] text-slate-400">首次登入請確認您的 LINE 帳號已由管理員綁定</p>
            </div>

            <DevModeLogin onLogin={onLogin} />
          </div>
        </div>
      </div>
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
    <div className="mt-4 pt-4 border-t border-juns-border">
      <p className="text-[11px] text-slate-400 mb-3 flex items-center justify-center gap-1">
        <UserCheck className="h-3 w-3" />
        開發模式 - 快速預覽
      </p>
      <div className="flex gap-2">
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger className="flex-1 h-9 text-sm border-juns-border" data-testid="select-dev-employee">
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
          className="bg-juns-navy hover:bg-juns-navy/90 text-white h-9 text-sm active:scale-[0.98]"
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
      <div className="min-h-screen bg-juns-surface flex flex-col">
        <JunsHeader employee={employee} />
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-md space-y-4">
            <div className="h-8 w-48 bg-slate-200 rounded animate-pulse" />
            <div className="h-40 w-full bg-slate-200 rounded animate-pulse" />
            <div className="h-40 w-full bg-slate-200 rounded animate-pulse" />
          </div>
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
    <div className="min-h-screen bg-juns-surface flex flex-col">
      <JunsHeader employee={employee} />
      <Watermark name={employee.name} code={employee.employeeCode} />

      <div className="bg-white border-b border-juns-border px-4 py-3">
        <h2 className="text-sm font-semibold text-juns-navy" data-testid="text-guidelines-title">守則確認</h2>
        <p className="text-[11px] text-slate-400">請詳閱以下內容後確認</p>
      </div>

      <div className="flex-1 p-4 pb-32 space-y-4 max-w-lg mx-auto w-full">
        {fixedItems.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-500 flex items-center gap-1.5 px-1">
              <FileText className="h-3.5 w-3.5" /> 場館守則
            </h3>
            {fixedItems.map((item) => (
              <GuidelineItemCard key={item.id} item={item} />
            ))}
          </div>
        )}

        {monthlyItems.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-500 flex items-center gap-1.5 px-1">
              <CalendarDays className="h-3.5 w-3.5" /> 本月公告
            </h3>
            {monthlyItems.map((item) => (
              <GuidelineItemCard key={item.id} item={item} />
            ))}
          </div>
        )}

        {confidentialityItems.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-500 flex items-center gap-1.5 px-1">
              <Lock className="h-3.5 w-3.5" /> 保密同意書
            </h3>
            {confidentialityItems.map((item) => (
              <GuidelineItemCard key={item.id} item={item} />
            ))}
          </div>
        )}

        {items.length === 0 && (
          <div className="border border-juns-border rounded-xl bg-white p-8 text-center">
            <CheckCircle2 className="h-10 w-10 mx-auto mb-2 text-juns-green" />
            <p className="text-sm text-slate-500">目前沒有需要確認的守則</p>
          </div>
        )}
      </div>

      {unacknowledged.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-juns-border p-4">
          <div className="max-w-lg mx-auto space-y-3">
            <label className="flex items-start gap-2 cursor-pointer" data-testid="label-confirm-checkbox">
              <Checkbox
                checked={confirmed}
                onCheckedChange={(v) => setConfirmed(v === true)}
                className="mt-0.5"
                data-testid="checkbox-confirm-guidelines"
              />
              <span className="text-xs leading-relaxed text-slate-600">
                我已詳閱以上所有守則與公告，了解並承諾遵守保密義務及各項工作規範。
              </span>
            </label>
            <button
              className="w-full h-11 rounded-lg bg-juns-green hover:bg-juns-green/90 text-white font-medium text-sm disabled:opacity-50 active:scale-[0.98] transition-all"
              disabled={!confirmed || ackMutation.isPending}
              onClick={() => ackMutation.mutate()}
              data-testid="button-confirm-guidelines"
            >
              {ackMutation.isPending ? "確認中..." : `確認已閱讀 (${unacknowledged.length} 項)`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function GuidelineItemCard({ item }: { item: GuidelineItem }) {
  return (
    <div className="border border-juns-border rounded-xl bg-white p-3" data-testid={`card-portal-guideline-${item.id}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <span className="text-sm font-medium text-juns-navy">{item.title}</span>
            {item.venueName && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 border border-juns-border">
                <MapPin className="h-2.5 w-2.5 inline mr-0.5" />
                {item.venueName}
              </span>
            )}
            {item.contentType === "video" && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 border border-juns-border">
                <Video className="h-2.5 w-2.5 inline mr-0.5" />
                影片
              </span>
            )}
            {item.acknowledged && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-juns-green/10 text-juns-green">
                <CheckCircle2 className="h-2.5 w-2.5 inline mr-0.5" />
                已確認
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 whitespace-pre-wrap">{item.content}</p>
          {item.contentType === "video" && item.videoUrl && (
            <a
              href={item.videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-juns-teal underline mt-1 inline-block"
              data-testid={`link-video-${item.id}`}
            >
              觀看影片
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function LiveClock() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const dateStr = format(now, "M月d日 EEEE", { locale: zhTW });
  const timeStr = format(now, "HH:mm");
  const secStr = format(now, ":ss");

  return (
    <div className="border border-juns-border rounded-xl bg-white overflow-hidden" data-testid="card-live-clock">
      <div className="py-5 text-center">
        <p className="text-sm text-slate-500 mb-1">{dateStr}</p>
        <div className="flex items-baseline justify-center">
          <span
            className="text-5xl font-bold text-juns-navy font-mono tracking-tight"
            style={{ fontVariantNumeric: "tabular-nums" }}
            data-testid="text-live-time"
          >
            {timeStr}
          </span>
          <span
            className="text-2xl font-bold text-slate-400 font-mono"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {secStr}
          </span>
        </div>
      </div>
    </div>
  );
}

function LocationMap({ lat, lng }: { lat: number | null; lng: number | null }) {
  if (!lat || !lng) {
    return (
      <div className="border border-juns-border rounded-xl bg-white overflow-hidden" data-testid="card-location-map">
        <div className="h-48 bg-slate-100 flex items-center justify-center">
          <div className="text-center text-slate-400">
            <MapPin className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-xs">點擊打卡後顯示地圖</p>
          </div>
        </div>
      </div>
    );
  }

  const mapSrc = `https://maps.google.com/maps?q=${lat},${lng}&z=16&output=embed`;

  return (
    <div className="border border-juns-border rounded-xl bg-white overflow-hidden" data-testid="card-location-map">
      <div className="relative">
        <iframe
          src={mapSrc}
          className="w-full h-48 border-0"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          title="目前位置"
          data-testid="iframe-google-map"
        />
        <a
          href={`https://www.google.com/maps?q=${lat},${lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute top-2 left-2 text-[11px] px-2 py-1 rounded-md bg-white/90 border border-juns-border text-juns-teal hover:bg-white transition-colors shadow-flat"
          data-testid="link-detail-map"
        >
          顯示詳細地圖
        </a>
      </div>
    </div>
  );
}

function VenueShiftInfo({ employee, result }: { employee: PortalEmployee; result: ClockInResult | null }) {
  const today = format(new Date(), "yyyy-MM-dd");
  const { data: todayShifts = [] } = useQuery<PortalShift[]>({
    queryKey: ["/api/portal/my-shifts", employee.id, today, today],
  });

  const matchedVenue = result?.venueName;
  const todayShift = todayShifts.find(s => matchedVenue ? s.venue?.name === matchedVenue || s.venue?.shortName === matchedVenue : true);

  return (
    <div className="border border-juns-border rounded-xl bg-white overflow-hidden" data-testid="card-venue-shift-info">
      <div className="p-3">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-juns-border mb-2">
          <MapPin className="h-4 w-4 text-juns-teal shrink-0" />
          <span className="text-sm text-juns-navy font-medium truncate">
            {matchedVenue || (todayShift?.venue?.shortName ?? todayShift?.venue?.name ?? "尚未定位")}
          </span>
          {result?.distance !== undefined && result?.distance !== null && (
            <span className="text-[10px] text-slate-400 ml-auto shrink-0 font-mono">{result.distance}m</span>
          )}
        </div>
        {todayShift ? (
          <div className="text-center text-xs text-slate-500 space-y-0.5">
            <p>
              上班時間 <span className="font-mono font-medium text-juns-navy">{todayShift.startTime.slice(0, 5)}</span>
              <span className="mx-1">~</span>
              下班時間 <span className="font-mono font-medium text-juns-navy">{todayShift.endTime.slice(0, 5)}</span>
            </p>
          </div>
        ) : (
          <p className="text-center text-xs text-slate-400">今日無排班</p>
        )}
      </div>
    </div>
  );
}

function RadarClockIn({ employee, onPositionUpdate, onResult }: { employee: PortalEmployee; onPositionUpdate?: (lat: number, lng: number) => void; onResult?: (r: ClockInResult) => void }) {
  const [stage, setStage] = useState<"idle" | "scanning" | "submitting" | "done" | "error">("idle");
  const [result, setResult] = useState<ClockInResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [scanAngle, setScanAngle] = useState(0);
  const { toast } = useToast();

  useEffect(() => {
    if (stage === "scanning" || stage === "submitting") {
      const interval = setInterval(() => {
        setScanAngle((prev) => (prev + 6) % 360);
      }, 30);
      return () => clearInterval(interval);
    }
  }, [stage]);

  const handleClockIn = useCallback(async (clockType: "in" | "out" = "in") => {
    setStage("scanning");
    setResult(null);
    setScanAngle(0);

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
      onPositionUpdate?.(latitude, longitude);
      setStage("submitting");

      const resp = await fetch("/api/liff/clock-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: employee.id, latitude, longitude, accuracy: Math.round(acc), clockType }),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.message || "打卡請求失敗");
      }

      const data: ClockInResult = await resp.json();
      setResult(data);
      onResult?.(data);
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
  }, [employee.id]);

  return (
    <div className="border border-juns-border rounded-xl bg-white overflow-hidden" data-testid="card-gps-clock-in">
      <div className="px-4 py-3 border-b border-juns-border flex items-center gap-2">
        <Signal className="h-4 w-4 text-juns-teal" />
        <span className="text-sm font-semibold text-juns-navy">GPS 定位打卡</span>
      </div>

      <div className="p-4">
        {stage === "idle" && (
          <div className="text-center">
            <div className="grid grid-cols-2 gap-3">
              <button
                className="h-12 rounded-lg bg-juns-green hover:bg-juns-green/90 text-white font-semibold text-base flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
                onClick={() => handleClockIn("in")}
                data-testid="button-clock-in"
              >
                上班
              </button>
              <button
                className="h-12 rounded-lg bg-blue-500 hover:bg-blue-600 text-white font-semibold text-base flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
                onClick={() => handleClockIn("out")}
                data-testid="button-clock-out"
              >
                下班
              </button>
            </div>
          </div>
        )}

        {(stage === "scanning" || stage === "submitting") && (
          <div className="text-center">
            <div className="relative w-40 h-40 mx-auto mb-4">
              <div className="absolute inset-0 rounded-full border-2 border-juns-teal/30" />
              <div className="absolute inset-4 rounded-full border border-juns-teal/20" />
              <div className="absolute inset-8 rounded-full border border-juns-teal/10" />
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  background: `conic-gradient(from ${scanAngle}deg, transparent 0deg, rgba(27, 177, 165, 0.25) 30deg, transparent 60deg)`,
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-3 h-3 rounded-full bg-juns-teal animate-pulse shadow-glow" />
              </div>
              <div className="absolute -inset-2 rounded-full border border-juns-teal/10 animate-ping" style={{ animationDuration: "2s" }} />
            </div>
            <p className="text-sm text-slate-500">
              {stage === "scanning" ? "正在掃描附近場館..." : "處理打卡中..."}
            </p>
          </div>
        )}

        {stage === "done" && result && (
          <div>
            <div className={`flex items-center gap-2 p-3 rounded-lg mb-3 ${
              result.status === "success" ? "bg-juns-green/10" :
              result.status === "warning" ? "bg-amber-500/10" :
              "bg-red-500/10"
            }`}>
              {result.status === "success" ? (
                <CheckCircle2 className="h-5 w-5 text-juns-green shrink-0" />
              ) : result.status === "warning" ? (
                <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
              ) : (
                <XCircle className="h-5 w-5 text-red-500 shrink-0" />
              )}
              <span className={`font-medium text-sm ${
                result.status === "success" ? "text-juns-green" :
                result.status === "warning" ? "text-amber-600" :
                "text-red-500"
              }`}>
                {result.status === "success"
                  ? (result.clockType === "in" ? "上班打卡成功" : "下班打卡成功")
                  : result.status === "warning"
                    ? "已記錄（無排班）"
                    : result.failReason || "打卡失敗"
                }
              </span>
            </div>

            <div className="space-y-1.5 text-xs text-slate-500 mb-3">
              {result.venueName && (
                <div className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-juns-teal shrink-0" />
                  <span>場館：<span className="font-medium text-juns-navy">{result.venueName}</span></span>
                </div>
              )}
              {result.distance !== null && (
                <div className="flex items-center gap-1.5">
                  <Navigation className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  <span>距離：{result.distance}m{result.radius ? ` / 需在 ${result.radius}m 內` : ""}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                <span>時間：{result.time}</span>
              </div>
              {result.shiftInfo && (
                <div className="flex items-center gap-1.5">
                  <CalendarDays className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  <span>班別：{result.shiftInfo}</span>
                </div>
              )}
              {accuracy !== null && (
                <div className="flex items-center gap-1.5">
                  <Wifi className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  <span>GPS 精度：±{accuracy}m</span>
                </div>
              )}
            </div>

            {result.userLat !== null && result.userLng !== null && (
              <div className="mb-3 p-2.5 rounded-lg bg-slate-50 border border-dashed border-slate-200">
                <div className="text-[10px] font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Debug 定位資訊</div>
                <div className="space-y-1 text-[11px] font-mono text-slate-500">
                  <div>User: {result.userLat.toFixed(6)}, {result.userLng.toFixed(6)}</div>
                  {result.nearbyVenues?.[0] && (
                    <div>Target ({result.nearbyVenues[0].shortName}): <a href={`https://www.google.com/maps?q=${result.userLat},${result.userLng}`} target="_blank" rel="noopener noreferrer" className="text-juns-teal underline">查看地圖</a></div>
                  )}
                  {result.distance !== null && <div>Raw Distance: {result.distance}m</div>}
                </div>
              </div>
            )}

            {result.nearbyVenues && result.nearbyVenues.length > 0 && (
              <div className="border border-juns-border rounded-lg overflow-hidden mb-3">
                <div className="px-3 py-1.5 bg-slate-50 border-b border-juns-border">
                  <span className="text-[11px] font-medium text-slate-500">附近場館</span>
                </div>
                <div className="divide-y divide-juns-border">
                  {result.nearbyVenues.map((v) => (
                    <div key={v.id} className="px-3 py-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${v.inRange ? "bg-juns-green" : "bg-slate-300"}`} />
                        <span className="text-xs text-juns-navy">{v.shortName}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-mono ${v.inRange ? "text-juns-green" : "text-slate-400"}`}>
                          {v.distance}m
                        </span>
                        {v.inRange && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-juns-green/10 text-juns-green">
                            範圍內
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              className="w-full h-10 rounded-lg border border-juns-border bg-white text-sm text-slate-600 hover:bg-slate-50 active:scale-[0.98] transition-all"
              onClick={() => { setStage("idle"); setResult(null); }}
              data-testid="button-clock-again"
            >
              再次打卡
            </button>
          </div>
        )}

        {stage === "error" && (
          <div>
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 mb-3">
              <XCircle className="h-5 w-5 text-red-500 shrink-0" />
              <span className="font-medium text-sm text-red-500">{errorMsg}</span>
            </div>
            <button
              className="w-full h-10 rounded-lg border border-juns-border bg-white text-sm text-slate-600 hover:bg-slate-50 active:scale-[0.98] transition-all"
              onClick={() => { setStage("idle"); setErrorMsg(""); }}
              data-testid="button-retry-clock"
            >
              重試
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PortalMain({ employee }: { employee: PortalEmployee }) {
  const [viewMode, setViewMode] = useState<"calendar" | "list">("calendar");
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [showGuidelines, setShowGuidelines] = useState(false);
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  const [clockInResult, setClockInResult] = useState<ClockInResult | null>(null);

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
    <div className="min-h-screen bg-juns-surface pb-8">
      <JunsHeader employee={employee} />
      <Watermark name={employee.name} code={employee.employeeCode} />

      <div className="max-w-lg mx-auto p-4 space-y-4">
        <LiveClock />
        <LocationMap lat={userPos?.lat ?? null} lng={userPos?.lng ?? null} />
        <VenueShiftInfo employee={employee} result={clockInResult} />
        <RadarClockIn employee={employee} onPositionUpdate={(lat, lng) => setUserPos({ lat, lng })} onResult={setClockInResult} />

        <div className="border border-juns-border rounded-xl bg-white overflow-hidden" data-testid="card-outing-signin">
          <button className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors" data-testid="button-outing-signin">
            <span className="text-sm font-semibold text-juns-navy">外出/簽到</span>
            <ChevronRight className="h-4 w-4 text-slate-400" />
          </button>
        </div>

        <div className="border border-juns-border rounded-xl bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-juns-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-juns-teal" />
              <span className="text-sm font-semibold text-juns-navy">我的班表</span>
            </div>
            <button
              className="p-1.5 rounded-md hover:bg-slate-100 transition-colors"
              onClick={() => setViewMode(viewMode === "calendar" ? "list" : "calendar")}
              data-testid="button-toggle-view"
            >
              {viewMode === "calendar" ? <List className="h-4 w-4 text-slate-500" /> : <Calendar className="h-4 w-4 text-slate-500" />}
            </button>
          </div>

          <div className="p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <button className="p-1 rounded-md hover:bg-slate-100" onClick={prevMonth} data-testid="button-prev-month">
                <ChevronLeft className="h-4 w-4 text-slate-500" />
              </button>
              <span className="text-sm font-medium text-juns-navy font-mono" data-testid="text-current-month">
                {format(currentMonth, "yyyy年 M月", { locale: zhTW })}
              </span>
              <button className="p-1 rounded-md hover:bg-slate-100" onClick={nextMonth} data-testid="button-next-month">
                <ChevronRight className="h-4 w-4 text-slate-500" />
              </button>
            </div>

            {shiftsLoading ? (
              <div className="h-48 bg-slate-100 rounded-lg animate-pulse" />
            ) : viewMode === "calendar" ? (
              <div>
                <div className="grid grid-cols-7 gap-px mb-1">
                  {DAY_LABELS.map((d) => (
                    <div key={d} className="text-center text-[11px] font-medium text-slate-400 py-1">
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
                          today ? "border-juns-teal bg-juns-teal/5" : "border-transparent"
                        } ${dayShifts.length > 0 ? "bg-slate-50" : ""}`}
                        data-testid={`cell-day-${dateStr}`}
                      >
                        <div className={`text-[11px] text-center mb-0.5 ${today ? "font-bold text-juns-teal" : "text-slate-400"}`}>
                          {format(day, "d")}
                        </div>
                        {dayShifts.slice(0, 2).map((s, i) => {
                          const rd = getRoleDisplay(s.assignedRole);
                          return (
                            <div key={i} className={`text-[10px] leading-tight px-0.5 rounded-sm border-l-2 pl-1 mb-0.5 ${rd.borderClass}`}>
                              <div className="font-medium truncate text-juns-navy">{s.venue?.shortName?.slice(0, 3) || ""}</div>
                              <div className={`truncate font-medium ${rd.textClass}`}>{s.startTime.slice(0, 5)}-{s.endTime.slice(0, 5)}</div>
                            </div>
                          );
                        })}
                        {dayShifts.length > 2 && (
                          <div className="text-[10px] text-slate-400 text-center">+{dayShifts.length - 2}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-auto">
                {myShifts.length === 0 ? (
                  <p className="text-sm text-center text-slate-400 py-4">本月無排班</p>
                ) : (
                  myShifts
                    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
                    .map((s) => {
                      const d = parseISO(s.date);
                      const dayLabel = DAY_LABELS[getDay(d)];
                      const rd = getRoleDisplay(s.assignedRole);
                      return (
                        <div
                          key={s.id}
                          className={`flex items-center gap-3 py-2.5 px-3 rounded-lg border border-juns-border ${
                            isToday(d) ? "border-juns-teal bg-juns-teal/5" : "bg-white"
                          }`}
                          data-testid={`shift-row-${s.id}`}
                        >
                          <div className="text-center min-w-[45px]">
                            <div className="text-xs text-slate-500 font-mono">{format(d, "M/d")}</div>
                            <div className={`text-[11px] ${dayLabel === "日" || dayLabel === "六" ? "text-red-400" : "text-slate-400"}`}>
                              ({dayLabel})
                            </div>
                          </div>
                          <div className={`w-0.5 h-8 rounded-full shrink-0`} style={{ backgroundColor: rd.color }} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-medium text-juns-navy truncate">{s.venue?.shortName || "未知"}</span>
                              {s.isDispatch && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600">派遣</span>}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-xs text-slate-400 font-mono">
                                {s.startTime.slice(0, 5)} - {s.endTime.slice(0, 5)}
                              </span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${rd.badgeBg}`}>
                                {rd.taskLabel}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            )}
          </div>
        </div>

        <div className="border border-juns-border rounded-xl bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-juns-border flex items-center gap-2">
            <Users className="h-4 w-4 text-juns-teal" />
            <span className="text-sm font-semibold text-juns-navy">今日工作夥伴</span>
          </div>
          <div className="p-4">
            {coworkersLoading ? (
              <div className="h-24 bg-slate-100 rounded-lg animate-pulse" />
            ) : todayCoworkers.length === 0 ? (
              <p className="text-sm text-center text-slate-400 py-4">今日無排班</p>
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
                        <span className="text-[11px] px-2 py-0.5 rounded-md border border-juns-border text-slate-500 bg-slate-50">
                          <MapPin className="h-2.5 w-2.5 inline mr-0.5" />
                          {group.venue?.shortName || "未知"}
                        </span>
                        <span className="text-[11px] text-slate-400">{group.shiftTime}</span>
                        {group.myRole && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-md ${getRoleDisplay(group.myRole).badgeBg}`}>
                            我：{getRoleDisplay(group.myRole).taskLabel}
                          </span>
                        )}
                      </div>
                      {group.coworkers.length === 0 ? (
                        <p className="text-xs text-slate-400 pl-2">今日僅你一人在此場館</p>
                      ) : (
                        <div className="space-y-3">
                          {Array.from(roleGroups.entries()).map(([roleName, members]) => {
                            const rd = getRoleDisplay(roleName);
                            return (
                              <div key={roleName} className={`rounded-lg border-l-2 ${rd.borderClass} pl-3`}>
                                <div className="flex items-center gap-1.5 mb-1.5">
                                  <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: rd.color }} />
                                  <span className={`text-[11px] font-semibold ${rd.textClass}`}>
                                    {rd.label}夥伴
                                  </span>
                                  <span className="text-[10px] text-slate-400">({members.length}人)</span>
                                </div>
                                <div className="space-y-1">
                                  {members.map((cw) => (
                                    <div
                                      key={cw.id}
                                      className="flex items-center justify-between gap-2 py-1"
                                      data-testid={`coworker-row-${cw.id}`}
                                    >
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span className="text-sm text-juns-navy truncate">{cw.name}</span>
                                        {cw.shiftTime && (
                                          <span className="text-[10px] text-slate-400 font-mono shrink-0">{cw.shiftTime}</span>
                                        )}
                                      </div>
                                      {cw.phone && (
                                        <a href={`tel:${cw.phone}`} className="shrink-0" data-testid={`button-call-${cw.id}`}>
                                          <div className="p-1.5 rounded-md hover:bg-juns-green/10 transition-colors">
                                            <Phone className="h-4 w-4 text-juns-green" />
                                          </div>
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
          </div>
        </div>

        <div className="border border-juns-border rounded-xl bg-white overflow-hidden" data-testid="card-attendance-summary">
          <div className="px-4 py-3 border-b border-juns-border flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-juns-teal" />
            <span className="text-sm font-semibold text-juns-navy">本月出缺勤</span>
          </div>
          <div className="p-4">
            {attendanceLoading ? (
              <div className="h-16 bg-slate-100 rounded-lg animate-pulse" />
            ) : !attendance || attendance.total === 0 ? (
              <p className="text-sm text-center text-slate-400 py-3">本月尚無出勤紀錄</p>
            ) : (
              <div>
                <div className="grid grid-cols-4 gap-2 mb-3">
                  {[
                    { label: "出勤天數", value: attendance.total, warn: false },
                    { label: "遲到", value: attendance.late, warn: attendance.late > 0 },
                    { label: "早退", value: attendance.earlyLeave, warn: attendance.earlyLeave > 0 },
                    { label: "異常", value: attendance.anomaly, warn: attendance.anomaly > 0 },
                  ].map((item) => (
                    <div key={item.label} className="text-center p-2 rounded-lg border border-juns-border">
                      <div className={`text-lg font-bold font-mono ${item.warn ? "text-red-500" : "text-juns-navy"}`}>
                        {item.value}
                      </div>
                      <div className="text-[10px] text-slate-400">{item.label}</div>
                    </div>
                  ))}
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
                          <div key={idx} className="flex items-center gap-2 text-xs py-1.5 border-b border-juns-border last:border-b-0">
                            <span className="text-slate-400 min-w-[40px] font-mono">{format(d, "M/d")}</span>
                            <span className="text-slate-400 font-mono">{r.clockIn || "--"} ~ {r.clockOut || "--"}</span>
                            <div className="flex gap-1 ml-auto">
                              {tags.map((t) => (
                                <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-500">
                                  {t}
                                </span>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="border border-juns-border rounded-xl bg-white overflow-hidden" data-testid="card-guidelines-review">
          <div className="px-4 py-3 border-b border-juns-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-juns-teal" />
              <span className="text-sm font-semibold text-juns-navy">員工守則</span>
            </div>
            <button
              className="text-xs px-3 py-1.5 rounded-md border border-juns-border text-slate-500 hover:bg-slate-50 active:scale-[0.98] transition-all"
              onClick={() => setShowGuidelines(!showGuidelines)}
              data-testid="button-toggle-guidelines"
            >
              {showGuidelines ? "收合" : "查看守則"}
            </button>
          </div>
          {showGuidelines && (
            <div className="p-4 space-y-2">
              {!guidelinesData ? (
                <div className="h-24 bg-slate-100 rounded-lg animate-pulse" />
              ) : guidelinesData.items.length === 0 ? (
                <p className="text-sm text-center text-slate-400 py-3">目前沒有守則</p>
              ) : (
                guidelinesData.items.map((item) => (
                  <GuidelineItemCard key={item.id} item={item} />
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PortalPage() {
  const [employee, setEmployee] = useState<PortalEmployee | null>(() => {
    try {
      const saved = localStorage.getItem("portal_employee");
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [guidelinesConfirmed, setGuidelinesConfirmed] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (employee && !verifying) {
      const lineUserId = localStorage.getItem("portal_line_user_id");
      if (lineUserId) {
        setVerifying(true);
        fetch("/api/portal/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lineId: lineUserId }),
        })
          .then(async (res) => {
            if (res.ok) {
              const data = await res.json();
              setEmployee(data);
              localStorage.setItem("portal_employee", JSON.stringify(data));
            } else {
              localStorage.removeItem("portal_employee");
              localStorage.removeItem("portal_line_user_id");
              setEmployee(null);
            }
          })
          .catch(() => {})
          .finally(() => setVerifying(false));
      }
    }
  }, []);

  const handleLogin = useCallback((emp: any) => {
    if (emp.lineUserId) {
      localStorage.setItem("portal_line_user_id", emp.lineUserId);
    }
    localStorage.setItem("portal_employee", JSON.stringify(emp));
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
