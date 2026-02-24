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
  AlertTriangle, ClipboardCheck, BookOpen, Navigation, Loader2, XCircle, Radar
} from "lucide-react";
import junsLogo from "@assets/logo_(1)_1771907823260.jpg";

interface PortalEmployee {
  id: number;
  name: string;
  employeeCode: string;
  role: string;
  lineUserId?: string;
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
  name: string;
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
  accuracy?: number;
  userLat?: number;
  userLng?: number;
}

const ROLE_LABELS: Record<string, string> = {
  "\u6551\u751f": "\u6551\u751f",
  "\u5b88\u671b": "\u5b88\u671b",
  "\u6ac3\u53f0": "\u6ac3\u53f0",
};

const ROLE_DISPLAY: Record<string, { label: string; taskLabel: string; color: string; bgClass: string; borderClass: string; textClass: string; badgeBg: string }> = {
  "\u6ac3\u6aaf": { label: "\u6ac3\u6aaf", taskLabel: "\u6ac3\u53f0\u670d\u52d9", color: "#3B82F6", bgClass: "bg-blue-500/10", borderClass: "border-l-blue-500", textClass: "text-blue-500", badgeBg: "bg-blue-500/15 text-blue-400" },
  "\u6551\u751f": { label: "\u6551\u751f", taskLabel: "\u6551\u751f\u57f7\u52e4", color: "#10B981", bgClass: "bg-emerald-500/10", borderClass: "border-l-emerald-500", textClass: "text-emerald-500", badgeBg: "bg-emerald-500/15 text-emerald-400" },
  "\u5b88\u671b": { label: "\u5b88\u671b", taskLabel: "\u5b88\u671b\u57f7\u52e4", color: "#F59E0B", bgClass: "bg-amber-500/10", borderClass: "border-l-amber-500", textClass: "text-amber-500", badgeBg: "bg-amber-500/15 text-amber-400" },
};

function getRoleDisplay(role: string | null | undefined) {
  if (!role) return ROLE_DISPLAY["\u6551\u751f"];
  return ROLE_DISPLAY[role] || ROLE_DISPLAY["\u6551\u751f"];
}

const DAY_LABELS = ["\u65e5", "\u4e00", "\u4e8c", "\u4e09", "\u56db", "\u4e94", "\u516d"];

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

function JunsHeader({ employee, showBadge }: { employee?: PortalEmployee; showBadge?: boolean }) {
  return (
    <div className="sticky top-0 z-40 bg-juns-navy text-white">
      <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <img src={junsLogo} alt="Juns Sports" className="h-9 w-9 rounded-lg object-cover" />
          <div>
            {employee ? (
              <>
                <h1 className="text-sm font-semibold leading-tight" data-testid="text-portal-main-title">
                  {employee.name}
                </h1>
                <p className="text-[11px] text-white/60">
                  {employee.employeeCode} / {ROLE_LABELS[employee.role] || employee.role}
                </p>
              </>
            ) : (
              <h1 className="text-sm font-semibold" data-testid="text-portal-title">\u54e1\u5de5\u5165\u53e3</h1>
            )}
          </div>
        </div>
        {showBadge && (
          <Badge className="bg-white/10 border-white/20 text-white text-[10px]">
            <ShieldCheck className="h-3 w-3 mr-1" />
            \u5df2\u9a57\u8b49
          </Badge>
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
        title: "LINE \u767b\u5165\u5931\u6557",
        description: err.message || "\u9a57\u8b49\u5931\u6557",
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
        title: "\u9a57\u8b49\u5931\u6557",
        description: err.message || "\u627e\u4e0d\u5230\u6b64 LINE \u5e33\u865f\u5c0d\u61c9\u7684\u54e1\u5de5\u8cc7\u6599",
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
        title: "LINE Login \u5c1a\u672a\u8a2d\u5b9a",
        description: "\u8acb\u806f\u7e6b\u7ba1\u7406\u54e1\u8a2d\u5b9a LINE Login",
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
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="rounded-xl border border-juns-border bg-white p-6 text-center">
            <div className="mb-6">
              <div className="w-16 h-16 rounded-xl bg-[#06C755] flex items-center justify-center mx-auto mb-4">
                <ShieldCheck className="h-8 w-8 text-white" />
              </div>
              <h2 className="text-lg font-semibold text-juns-navy mb-1">\u8acb\u4f7f\u7528 LINE \u5e33\u865f\u767b\u5165</h2>
              <p className="text-xs text-slate-500">\u9996\u6b21\u767b\u5165\u5f8c\u4e0b\u6b21\u53ef\u76f4\u63a5\u958b\u555f</p>
            </div>

            {checking ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full rounded-lg" />
                <p className="text-sm text-slate-500">\u9a57\u8b49\u4e2d...</p>
              </div>
            ) : (
              <Button
                className="w-full h-11 bg-[#06C755] hover:bg-[#05b04c] text-white rounded-lg active:scale-[0.98] transition-transform"
                onClick={handleLineLogin}
                data-testid="button-line-login"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 mr-2 fill-current">
                  <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
                </svg>
                LINE \u767b\u5165
              </Button>
            )}

            <div className="mt-5 pt-4 border-t border-juns-border">
              <p className="text-[11px] text-slate-400">\u9996\u6b21\u767b\u5165\u8acb\u78ba\u8a8d\u60a8\u7684 LINE \u5e33\u865f\u5df2\u7531\u7ba1\u7406\u54e1\u7d81\u5b9a</p>
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
      toast({ title: "\u767b\u5165\u5931\u6557", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  if (!employees || employees.length === 0) return null;

  return (
    <div className="mt-4 pt-4 border-t border-juns-border">
      <p className="text-[11px] text-slate-400 mb-3 flex items-center justify-center gap-1">
        <UserCheck className="h-3 w-3" />
        \u958b\u767c\u6a21\u5f0f - \u5feb\u901f\u9810\u89bd
      </p>
      <div className="flex gap-2">
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger className="flex-1 rounded-lg border-juns-border" data-testid="select-dev-employee">
            <SelectValue placeholder="\u9078\u64c7\u54e1\u5de5" />
          </SelectTrigger>
          <SelectContent>
            {employees.map((emp) => (
              <SelectItem key={emp.id} value={String(emp.id)} data-testid={`option-dev-employee-${emp.id}`}>
                {emp.name}\uff08{emp.employeeCode}\uff09
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          onClick={handleDevLogin}
          disabled={!selectedId || loading}
          className="bg-juns-navy hover:bg-juns-navy/90 rounded-lg active:scale-[0.98] transition-transform"
          data-testid="button-dev-login"
        >
          \u9032\u5165
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
      toast({ title: "\u5df2\u78ba\u8a8d\u6240\u6709\u5b88\u5247" });
      onComplete();
    },
    onError: (err: Error) => {
      toast({ title: "\u78ba\u8a8d\u5931\u6557", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-juns-surface flex flex-col">
        <JunsHeader employee={employee} />
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-md space-y-4">
            <Skeleton className="h-8 w-48 rounded-lg" />
            <Skeleton className="h-40 w-full rounded-xl" />
            <Skeleton className="h-40 w-full rounded-xl" />
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
      <Watermark name={employee.name} code={employee.employeeCode} />
      <JunsHeader employee={employee} />

      <div className="border-b border-juns-border bg-white px-4 py-3">
        <h2 className="text-sm font-semibold text-juns-navy" data-testid="text-guidelines-title">\u5b88\u5247\u78ba\u8a8d</h2>
        <p className="text-[11px] text-slate-500">\u8acb\u8a73\u95b1\u4ee5\u4e0b\u5167\u5bb9\u5f8c\u78ba\u8a8d</p>
      </div>

      <div className="p-4 pb-32 space-y-4 max-w-lg mx-auto">
        {fixedItems.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-500 flex items-center gap-1.5 uppercase tracking-wider">
              <FileText className="h-3.5 w-3.5" /> \u5834\u9928\u5b88\u5247
            </h3>
            {fixedItems.map((item) => (
              <GuidelineItemCard key={item.id} item={item} />
            ))}
          </div>
        )}

        {monthlyItems.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-500 flex items-center gap-1.5 uppercase tracking-wider">
              <CalendarDays className="h-3.5 w-3.5" /> \u672c\u6708\u516c\u544a
            </h3>
            {monthlyItems.map((item) => (
              <GuidelineItemCard key={item.id} item={item} />
            ))}
          </div>
        )}

        {confidentialityItems.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-500 flex items-center gap-1.5 uppercase tracking-wider">
              <Lock className="h-3.5 w-3.5" /> \u4fdd\u5bc6\u540c\u610f\u66f8
            </h3>
            {confidentialityItems.map((item) => (
              <GuidelineItemCard key={item.id} item={item} />
            ))}
          </div>
        )}

        {items.length === 0 && (
          <div className="rounded-xl border border-juns-border bg-white p-8 text-center">
            <CheckCircle2 className="h-10 w-10 mx-auto mb-2 text-juns-green" />
            <p className="text-sm text-slate-500">\u76ee\u524d\u6c92\u6709\u9700\u8981\u78ba\u8a8d\u7684\u5b88\u5247</p>
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
                \u6211\u5df2\u8a73\u95b1\u4ee5\u4e0a\u6240\u6709\u5b88\u5247\u8207\u516c\u544a\uff0c\u4e86\u89e3\u4e26\u627f\u8afe\u9075\u5b88\u4fdd\u5bc6\u7fa9\u52d9\u53ca\u5404\u9805\u5de5\u4f5c\u898f\u7bc4\u3002
              </span>
            </label>
            <Button
              className="w-full h-11 bg-juns-green hover:bg-juns-green/90 rounded-lg active:scale-[0.98] transition-transform"
              disabled={!confirmed || ackMutation.isPending}
              onClick={() => ackMutation.mutate()}
              data-testid="button-confirm-guidelines"
            >
              {ackMutation.isPending ? "\u78ba\u8a8d\u4e2d..." : `\u78ba\u8a8d\u5df2\u95b1\u8b80 (${unacknowledged.length} \u9805)`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function GuidelineItemCard({ item }: { item: GuidelineItem }) {
  return (
    <div className="rounded-xl border border-juns-border bg-white p-4" data-testid={`card-portal-guideline-${item.id}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
            <span className="text-sm font-medium text-juns-navy">{item.title}</span>
            {item.venueName && (
              <Badge variant="outline" className="text-[10px] border-juns-border">
                <MapPin className="h-2.5 w-2.5 mr-0.5" />
                {item.venueName}
              </Badge>
            )}
            {item.contentType === "video" && (
              <Badge variant="outline" className="text-[10px] border-juns-border">
                <Video className="h-2.5 w-2.5 mr-0.5" />
                \u5f71\u7247
              </Badge>
            )}
            {item.acknowledged && (
              <Badge className="text-[10px] bg-juns-green/10 text-juns-green border-0">
                <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
                \u5df2\u78ba\u8a8d
              </Badge>
            )}
          </div>
          <p className="text-xs text-slate-500 whitespace-pre-wrap leading-relaxed">{item.content}</p>
          {item.contentType === "video" && item.videoUrl && (
            <a
              href={item.videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-juns-teal underline mt-1.5 inline-block"
              data-testid={`link-video-${item.id}`}
            >
              \u89c0\u770b\u5f71\u7247
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function RadarClockInCard({ employee }: { employee: PortalEmployee }) {
  const [stage, setStage] = useState<"idle" | "scanning" | "submitting" | "done" | "error">("idle");
  const [result, setResult] = useState<ClockInResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const { toast } = useToast();

  const handleClockIn = useCallback(async () => {
    setStage("scanning");
    setResult(null);
    setErrorMsg("");

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
        body: JSON.stringify({ employeeId: employee.id, latitude, longitude, accuracy: Math.round(acc) }),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.message || "\u6253\u5361\u8acb\u6c42\u5931\u6557");
      }

      const data: ClockInResult = await resp.json();
      setResult(data);
      setStage("done");
    } catch (err: any) {
      if (err.code === 1) {
        setErrorMsg("\u8acb\u5141\u8a31\u4f4d\u7f6e\u5b58\u53d6\u6b0a\u9650");
      } else if (err.code === 2) {
        setErrorMsg("\u7121\u6cd5\u53d6\u5f97\u4f4d\u7f6e\uff0c\u8acb\u78ba\u8a8d GPS \u5df2\u958b\u555f");
      } else if (err.code === 3) {
        setErrorMsg("\u5b9a\u4f4d\u903e\u6642\uff0c\u8acb\u5230\u7a7a\u66e0\u8655\u518d\u8a66");
      } else {
        setErrorMsg(err.message || "\u6253\u5361\u904e\u7a0b\u767c\u751f\u932f\u8aa4");
      }
      setStage("error");
    }
  }, [employee.id, toast]);

  return (
    <div className="rounded-xl border border-juns-border bg-white overflow-hidden" data-testid="card-gps-clock-in">
      <div className="px-4 py-3 border-b border-juns-border flex items-center justify-between">
        <h2 className="text-sm font-semibold text-juns-navy flex items-center gap-1.5">
          <Radar className="h-4 w-4 text-juns-teal" /> GPS \u6253\u5361
        </h2>
        {accuracy && stage === "done" && (
          <span className="text-[10px] text-slate-400 font-mono">GPS \u00b1{accuracy}m</span>
        )}
      </div>

      <div className="p-4">
        {stage === "idle" && (
          <div className="text-center py-4">
            <div className="relative w-32 h-32 mx-auto mb-4">
              <div className="absolute inset-0 rounded-full border-2 border-juns-border" />
              <div className="absolute inset-3 rounded-full border border-juns-border" />
              <div className="absolute inset-6 rounded-full border border-juns-border" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-3 h-3 rounded-full bg-juns-teal" />
              </div>
            </div>
            <Button
              className="w-full h-12 bg-juns-green hover:bg-juns-green/90 text-white text-base font-semibold rounded-lg active:scale-[0.98] transition-transform"
              onClick={handleClockIn}
              data-testid="button-gps-clock-in"
            >
              <Navigation className="mr-2 h-5 w-5" />
              \u4e00\u9375\u6253\u5361
            </Button>
          </div>
        )}

        {(stage === "scanning" || stage === "submitting") && (
          <div className="text-center py-4">
            <div className="relative w-32 h-32 mx-auto mb-4">
              <div className="absolute inset-0 rounded-full border-2 border-juns-teal/30" />
              <div className="absolute inset-3 rounded-full border border-juns-teal/20" />
              <div className="absolute inset-6 rounded-full border border-juns-teal/10" />
              <div className="absolute inset-0 rounded-full animate-radar-ping border-2 border-juns-teal/40" />
              <div className="absolute inset-0">
                <div
                  className="w-full h-full animate-radar-sweep"
                  style={{
                    background: `conic-gradient(from 0deg, transparent 0deg, rgba(27,177,165,0.15) 0deg, rgba(27,177,165,0.15) 60deg, transparent 60deg)`,
                    borderRadius: "50%",
                  }}
                />
              </div>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-3 h-3 rounded-full bg-juns-teal shadow-glow" />
              </div>
            </div>
            <p className="text-sm text-slate-500">
              {stage === "scanning" ? "\u6b63\u5728\u5b9a\u4f4d\u4e2d..." : "\u8655\u7406\u6253\u5361\u4e2d..."}
            </p>
          </div>
        )}

        {stage === "done" && result && (
          <div className="space-y-3">
            <div className={`flex items-center gap-2 p-3 rounded-lg ${
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
                  ? (result.clockType === "in" ? "\u4e0a\u73ed\u6253\u5361\u6210\u529f" : "\u4e0b\u73ed\u6253\u5361\u6210\u529f")
                  : result.status === "warning"
                  ? "\u5df2\u8a18\u9304\uff08\u7121\u6392\u73ed\uff09"
                  : (result.failReason || "\u6253\u5361\u5931\u6557")}
              </span>
            </div>

            <div className="space-y-1.5 text-xs text-slate-500">
              {result.venueName && (
                <div className="flex items-center justify-between">
                  <span>\u5339\u914d\u5834\u9928</span>
                  <span className="font-medium text-juns-navy">{result.venueName}</span>
                </div>
              )}
              {result.distance !== null && (
                <div className="flex items-center justify-between">
                  <span>\u8ddd\u96e2</span>
                  <span className="font-mono">{result.distance}m{result.radius ? ` / ${result.radius}m \u5167` : ""}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span>\u6642\u9593</span>
                <span className="font-mono">{result.time}</span>
              </div>
              {result.shiftInfo && (
                <div className="flex items-center justify-between">
                  <span>\u73ed\u5225</span>
                  <span className="font-mono">{result.shiftInfo}</span>
                </div>
              )}
            </div>

            {result.nearbyVenues && result.nearbyVenues.length > 0 && (
              <div className="border-t border-juns-border pt-3">
                <p className="text-[11px] text-slate-400 mb-2">\u9644\u8fd1\u5834\u9928</p>
                <div className="space-y-1">
                  {result.nearbyVenues.map((v, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full ${v.inRange ? "bg-juns-green" : "bg-slate-300"}`} />
                        <span className={v.inRange ? "text-juns-navy font-medium" : "text-slate-400"}>{v.name}</span>
                      </div>
                      <span className={`font-mono text-[11px] ${v.inRange ? "text-juns-teal" : "text-slate-400"}`}>
                        {v.distance}m
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              className="w-full rounded-lg border-juns-border active:scale-[0.98] transition-transform"
              onClick={() => { setStage("idle"); setResult(null); }}
              data-testid="button-clock-again"
            >
              \u518d\u6b21\u6253\u5361
            </Button>
          </div>
        )}

        {stage === "error" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10">
              <XCircle className="h-5 w-5 text-red-500 shrink-0" />
              <span className="font-medium text-sm text-red-500">{errorMsg}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full rounded-lg border-juns-border active:scale-[0.98] transition-transform"
              onClick={() => { setStage("idle"); setErrorMsg(""); }}
              data-testid="button-retry-clock"
            >
              \u91cd\u8a66
            </Button>
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
      <Watermark name={employee.name} code={employee.employeeCode} />
      <JunsHeader employee={employee} showBadge />

      <div className="max-w-lg mx-auto p-4 space-y-4">
        <RadarClockInCard employee={employee} />

        <div className="rounded-xl border border-juns-border bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-juns-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-juns-navy flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4 text-juns-teal" /> \u6211\u7684\u73ed\u8868
            </h2>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => setViewMode(viewMode === "calendar" ? "list" : "calendar")}
              data-testid="button-toggle-view"
            >
              {viewMode === "calendar" ? <List className="h-3.5 w-3.5" /> : <Calendar className="h-3.5 w-3.5" />}
            </Button>
          </div>

          <div className="p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={prevMonth} data-testid="button-prev-month">
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="text-sm font-medium text-juns-navy font-mono" data-testid="text-current-month">
                {format(currentMonth, "yyyy\u5e74 M\u6708", { locale: zhTW })}
              </span>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={nextMonth} data-testid="button-next-month">
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>

            {shiftsLoading ? (
              <Skeleton className="h-48 w-full rounded-lg" />
            ) : viewMode === "calendar" ? (
              <div>
                <div className="grid grid-cols-7 gap-px mb-1">
                  {DAY_LABELS.map((d) => (
                    <div key={d} className="text-center text-[10px] font-medium text-slate-400 py-1">
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
                        className={`min-h-[72px] p-0.5 rounded-lg border ${
                          today ? "border-juns-teal bg-juns-teal/5" : "border-transparent"
                        } ${dayShifts.length > 0 ? "bg-slate-50" : ""}`}
                        data-testid={`cell-day-${dateStr}`}
                      >
                        <div className={`text-[10px] text-center mb-0.5 ${today ? "font-bold text-juns-teal" : "text-slate-400"}`}>
                          {format(day, "d")}
                        </div>
                        {dayShifts.slice(0, 2).map((s, i) => {
                          const rd = getRoleDisplay(s.assignedRole);
                          return (
                            <div key={i} className={`text-[9px] leading-tight px-0.5 rounded-sm border-l-2 pl-1 mb-0.5 ${rd.borderClass}`}>
                              <div className="font-medium truncate text-juns-navy">{s.venue?.shortName?.slice(0, 3) || ""}</div>
                              <div className={`truncate font-mono ${rd.textClass}`}>{s.startTime.slice(0, 5)}-{s.endTime.slice(0, 5)}</div>
                            </div>
                          );
                        })}
                        {dayShifts.length > 2 && (
                          <div className="text-[9px] text-slate-400 text-center">+{dayShifts.length - 2}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-auto">
                {myShifts.length === 0 ? (
                  <p className="text-sm text-center text-slate-400 py-4">\u672c\u6708\u7121\u6392\u73ed</p>
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
                          className={`flex items-center gap-3 py-2.5 px-3 rounded-lg border-l-4 ${rd.borderClass} bg-slate-50 ${
                            isToday(d) ? "ring-1 ring-juns-teal/30" : ""
                          }`}
                          data-testid={`shift-row-${s.id}`}
                        >
                          <div className="text-center min-w-[42px]">
                            <div className="text-[11px] text-slate-500 font-mono">{format(d, "M/d")}</div>
                            <div className={`text-[10px] ${dayLabel === "\u65e5" || dayLabel === "\u516d" ? "text-red-400" : "text-slate-400"}`}>
                              ({dayLabel})
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <MapPin className="h-3 w-3 text-slate-400 shrink-0" />
                              <span className="text-sm font-medium truncate text-juns-navy">{s.venue?.shortName || "\u672a\u77e5"}</span>
                              {s.isDispatch && <Badge className="text-[9px] bg-amber-500/10 text-amber-600 border-0">\u6d3e\u9063</Badge>}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <Clock className="h-3 w-3 text-slate-400" />
                              <span className="text-xs text-slate-500 font-mono">{s.startTime.slice(0, 5)} - {s.endTime.slice(0, 5)}</span>
                              <Badge className={`text-[9px] border-0 ${rd.badgeBg}`} data-testid={`badge-role-${s.id}`}>
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
          </div>
        </div>

        <div className="rounded-xl border border-juns-border bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-juns-border">
            <h2 className="text-sm font-semibold text-juns-navy flex items-center gap-1.5">
              <Users className="h-4 w-4 text-juns-teal" /> \u4eca\u65e5\u5de5\u4f5c\u5925\u4f34
            </h2>
          </div>
          <div className="p-4">
            {coworkersLoading ? (
              <Skeleton className="h-24 w-full rounded-lg" />
            ) : todayCoworkers.length === 0 ? (
              <p className="text-sm text-center text-slate-400 py-4">\u4eca\u65e5\u7121\u6392\u73ed</p>
            ) : (
              <div className="space-y-4">
                {todayCoworkers.map((group, gIdx) => {
                  const roleGroups = new Map<string, typeof group.coworkers>();
                  group.coworkers.forEach((cw) => {
                    const key = cw.shiftRole || "\u5176\u4ed6";
                    if (!roleGroups.has(key)) roleGroups.set(key, []);
                    roleGroups.get(key)!.push(cw);
                  });

                  return (
                    <div key={gIdx}>
                      <div className="flex items-center gap-1.5 mb-3">
                        <Badge variant="outline" className="text-[10px] border-juns-border">
                          <MapPin className="h-2.5 w-2.5 mr-0.5" />
                          {group.venue?.shortName || "\u672a\u77e5"}
                        </Badge>
                        <span className="text-[10px] text-slate-400 font-mono">{group.shiftTime}</span>
                        {group.myRole && (
                          <Badge className={`text-[9px] border-0 ${getRoleDisplay(group.myRole).badgeBg}`}>
                            \u6211\u7684\u5d17\u4f4d\uff1a{getRoleDisplay(group.myRole).taskLabel}
                          </Badge>
                        )}
                      </div>
                      {group.coworkers.length === 0 ? (
                        <p className="text-xs text-slate-400 pl-2">\u4eca\u65e5\u50c5\u4f60\u4e00\u4eba\u5728\u6b64\u5834\u9928</p>
                      ) : (
                        <div className="space-y-3">
                          {Array.from(roleGroups.entries()).map(([roleName, members]) => {
                            const rd = getRoleDisplay(roleName);
                            return (
                              <div key={roleName} className={`rounded-lg border-l-4 ${rd.borderClass} bg-slate-50 p-3`}>
                                <div className="flex items-center gap-1.5 mb-2">
                                  <div className={`h-2 w-2 rounded-full`} style={{ backgroundColor: rd.color }} />
                                  <span className={`text-xs font-semibold ${rd.textClass}`}>
                                    \u4eca\u65e5{rd.label}\u5925\u4f34
                                  </span>
                                  <span className="text-[10px] text-slate-400">({members.length}\u4eba)</span>
                                </div>
                                <div className="space-y-1.5">
                                  {members.map((cw) => (
                                    <div
                                      key={cw.id}
                                      className="flex items-center justify-between gap-2 py-1"
                                      data-testid={`coworker-row-${cw.id}`}
                                    >
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span className="text-sm font-medium truncate text-juns-navy">{cw.name}</span>
                                        {cw.shiftTime && (
                                          <span className="text-[10px] text-slate-400 font-mono shrink-0">{cw.shiftTime}</span>
                                        )}
                                      </div>
                                      {cw.phone && (
                                        <a
                                          href={`tel:${cw.phone}`}
                                          className="shrink-0"
                                          data-testid={`button-call-${cw.id}`}
                                        >
                                          <Button size="icon" variant="ghost" className="h-7 w-7">
                                            <Phone className="h-4 w-4 text-juns-green" />
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
          </div>
        </div>

        <div className="rounded-xl border border-juns-border bg-white overflow-hidden" data-testid="card-attendance-summary">
          <div className="px-4 py-3 border-b border-juns-border">
            <h2 className="text-sm font-semibold text-juns-navy flex items-center gap-1.5">
              <ClipboardCheck className="h-4 w-4 text-juns-teal" /> \u672c\u6708\u51fa\u7f3a\u52e4
            </h2>
          </div>
          <div className="p-4">
            {attendanceLoading ? (
              <Skeleton className="h-16 w-full rounded-lg" />
            ) : !attendance || attendance.total === 0 ? (
              <p className="text-sm text-center text-slate-400 py-3">\u672c\u6708\u5c1a\u7121\u51fa\u52e4\u7d00\u9304</p>
            ) : (
              <div>
                <div className="grid grid-cols-4 gap-2 mb-3">
                  <div className="text-center p-2 rounded-lg bg-slate-50 border border-juns-border">
                    <div className="text-lg font-bold text-juns-navy font-mono" data-testid="text-attendance-total">{attendance.total}</div>
                    <div className="text-[10px] text-slate-400">\u51fa\u52e4\u5929\u6578</div>
                  </div>
                  <div className="text-center p-2 rounded-lg bg-slate-50 border border-juns-border">
                    <div className={`text-lg font-bold font-mono ${attendance.late > 0 ? "text-red-500" : "text-juns-navy"}`} data-testid="text-attendance-late">{attendance.late}</div>
                    <div className="text-[10px] text-slate-400">\u9072\u5230</div>
                  </div>
                  <div className="text-center p-2 rounded-lg bg-slate-50 border border-juns-border">
                    <div className={`text-lg font-bold font-mono ${attendance.earlyLeave > 0 ? "text-red-500" : "text-juns-navy"}`} data-testid="text-attendance-early">{attendance.earlyLeave}</div>
                    <div className="text-[10px] text-slate-400">\u65e9\u9000</div>
                  </div>
                  <div className="text-center p-2 rounded-lg bg-slate-50 border border-juns-border">
                    <div className={`text-lg font-bold font-mono ${attendance.anomaly > 0 ? "text-red-500" : "text-juns-navy"}`} data-testid="text-attendance-anomaly">{attendance.anomaly}</div>
                    <div className="text-[10px] text-slate-400">\u7570\u5e38</div>
                  </div>
                </div>
                {(attendance.late > 0 || attendance.earlyLeave > 0 || attendance.anomaly > 0) && (
                  <div className="space-y-1.5">
                    {attendance.records
                      .filter((r) => r.isLate || r.isEarlyLeave || r.hasAnomaly)
                      .map((r, idx) => {
                        const d = parseISO(r.date);
                        const tags: string[] = [];
                        if (r.isLate) tags.push("\u9072\u5230");
                        if (r.isEarlyLeave) tags.push("\u65e9\u9000");
                        if (r.hasAnomaly) tags.push("\u7570\u5e38");
                        return (
                          <div key={idx} className="flex items-center gap-2 text-xs py-1.5 border-b border-juns-border last:border-b-0">
                            <span className="text-slate-400 min-w-[42px] font-mono">{format(d, "M/d")}</span>
                            <span className="text-slate-500 font-mono">{r.clockIn || "--"} ~ {r.clockOut || "--"}</span>
                            <div className="flex gap-1 ml-auto">
                              {tags.map((t) => (
                                <Badge key={t} className="text-[9px] bg-red-500/10 text-red-500 border-0">
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
          </div>
        </div>

        <div className="rounded-xl border border-juns-border bg-white overflow-hidden" data-testid="card-guidelines-review">
          <div className="px-4 py-3 border-b border-juns-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-juns-navy flex items-center gap-1.5">
              <BookOpen className="h-4 w-4 text-juns-teal" /> \u54e1\u5de5\u5b88\u5247
            </h2>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs rounded-lg border-juns-border active:scale-[0.98] transition-transform"
              onClick={() => setShowGuidelines(!showGuidelines)}
              data-testid="button-toggle-guidelines"
            >
              {showGuidelines ? "\u6536\u5408" : "\u67e5\u770b\u5b88\u5247"}
            </Button>
          </div>
          {showGuidelines && (
            <div className="p-4 space-y-2">
              {!guidelinesData ? (
                <Skeleton className="h-24 w-full rounded-lg" />
              ) : guidelinesData.items.length === 0 ? (
                <p className="text-sm text-center text-slate-400 py-3">\u76ee\u524d\u6c92\u6709\u5b88\u5247</p>
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
