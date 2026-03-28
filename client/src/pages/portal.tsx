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
  Wifi, Signal, Copy, MessageSquareWarning, Camera, X, ImagePlus, Send
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
  coworkers: { id: number; name: string; phone: string | null; role: string; shiftRole: string; shiftTime: string | null }[];
}

interface AttendanceSummary {
  total: number;
  late: number;
  earlyLeave: number;
  anomaly: number;
  leave: number;
  todayLatestClock: { clockType: string; clockTime: string } | null;
  todayClockIn: { clockTime: string } | null;
  todayClockOut: { clockTime: string } | null;
  records: {
    date: string;
    clockIn: string | null;
    clockOut: string | null;
    isLate: boolean | null;
    isEarlyLeave: boolean | null;
    hasAnomaly: boolean | null;
    leaveType: string | null;
    shiftInfo: string | null;
    shiftType: string | null;
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
  recordId?: number;
  earlyArrival?: boolean;
  earlyMinutes?: number;
  lateDeparture?: boolean;
  lateMinutes?: number;
}

const ROLE_LABELS: Record<string, string> = {
  "救生": "救生",
  "守望": "守望",
  "櫃台": "櫃台",
};

const ROLE_SHORT: Record<string, string> = {
  "救生": "救", "教練": "教", "指導員": "指", "PT": "PT",
  "行政": "行", "櫃台": "櫃", "櫃檯": "櫃", "資訊班": "資",
  "守望": "望", "清潔": "潔", "管理": "管",
  "休假": "休", "特休": "特", "病假": "病", "事假": "事",
  "喪假": "喪", "公假": "公", "生理假": "生", "國定假": "國",
};

const ROLE_DISPLAY: Record<string, { label: string; taskLabel: string; color: string; bgClass: string; borderClass: string; textClass: string; badgeBg: string }> = {
  "櫃檯": { label: "櫃檯", taskLabel: "櫃台服務", color: "#3B82F6", bgClass: "bg-blue-500/10", borderClass: "border-l-blue-500", textClass: "text-blue-500", badgeBg: "bg-blue-500/15 text-blue-400" },
  "救生": { label: "救生", taskLabel: "救生執勤", color: "#10B981", bgClass: "bg-emerald-500/10", borderClass: "border-l-emerald-500", textClass: "text-emerald-500", badgeBg: "bg-emerald-500/15 text-emerald-400" },
  "守望": { label: "守望", taskLabel: "守望執勤", color: "#F59E0B", bgClass: "bg-amber-500/10", borderClass: "border-l-amber-500", textClass: "text-amber-500", badgeBg: "bg-amber-500/15 text-amber-400" },
  "清潔": { label: "清潔", taskLabel: "清潔維護", color: "#8B5CF6", bgClass: "bg-violet-500/10", borderClass: "border-l-violet-500", textClass: "text-violet-500", badgeBg: "bg-violet-500/15 text-violet-400" },
  "管理": { label: "管理", taskLabel: "管理職務", color: "#64748B", bgClass: "bg-slate-500/10", borderClass: "border-l-slate-500", textClass: "text-slate-500", badgeBg: "bg-slate-500/15 text-slate-400" },
  "教練": { label: "教練", taskLabel: "教學執勤", color: "#F97316", bgClass: "bg-orange-500/10", borderClass: "border-l-orange-500", textClass: "text-orange-500", badgeBg: "bg-orange-500/15 text-orange-400" },
  "無職": { label: "無職", taskLabel: "", color: "#94A3B8", bgClass: "bg-slate-100", borderClass: "border-l-slate-300", textClass: "text-slate-400", badgeBg: "bg-slate-100 text-slate-400" },
  "行政": { label: "行政", taskLabel: "行政作業", color: "#64748B", bgClass: "bg-slate-500/10", borderClass: "border-l-slate-500", textClass: "text-slate-500", badgeBg: "bg-slate-500/15 text-slate-400" },
  "機電": { label: "機電", taskLabel: "機電維護", color: "#78716C", bgClass: "bg-stone-500/10", borderClass: "border-l-stone-500", textClass: "text-stone-500", badgeBg: "bg-stone-500/15 text-stone-400" },
  "資訊": { label: "資訊", taskLabel: "資訊系統", color: "#6366F1", bgClass: "bg-indigo-500/10", borderClass: "border-l-indigo-500", textClass: "text-indigo-500", badgeBg: "bg-indigo-500/15 text-indigo-400" },
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

function AnomalyReportButton({ employee, clockResult, errorMsg, accuracy, context }: {
  employee?: PortalEmployee | null;
  clockResult?: ClockInResult | null;
  errorMsg?: string;
  accuracy?: number | null;
  context: string;
}) {
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [userNote, setUserNote] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const { toast } = useToast();

  const handleAddImages = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const remaining = 5 - images.length;
    const newFiles = files.slice(0, remaining);
    setImages(prev => [...prev, ...newFiles]);
    const newPreviews = newFiles.map(f => URL.createObjectURL(f));
    setPreviews(prev => [...prev, ...newPreviews]);
    e.target.value = "";
  };

  const handleRemoveImage = (index: number) => {
    URL.revokeObjectURL(previews[index]);
    setImages(prev => prev.filter((_, i) => i !== index));
    setPreviews(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const formData = new FormData();
      const payload: any = { context };
      if (employee) {
        payload.employee = {
          id: employee.id,
          name: employee.name,
          employeeCode: employee.employeeCode,
          role: employee.role,
          lineUserId: employee.lineUserId || localStorage.getItem("portal_line_user_id") || undefined,
        };
      }
      if (clockResult) payload.clockResult = clockResult;
      if (errorMsg) payload.errorMsg = errorMsg;
      if (userNote.trim()) payload.userNote = userNote.trim();

      formData.append("data", JSON.stringify(payload));
      images.forEach(img => formData.append("images", img));

      const res = await fetch("/api/anomaly-report", { method: "POST", body: formData });
      if (!res.ok) throw new Error("送出失敗");
      setSubmitted(true);
      toast({ title: "異常報告已送出", description: "管理員將會收到通知並處理" });
    } catch {
      toast({ title: "送出失敗", description: "請稍後再試或手動截圖回報", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="mt-3">
        <div className="w-full h-10 rounded-lg border border-green-300 bg-green-50 text-green-700 text-sm font-medium flex items-center justify-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          異常報告已送出
        </div>
      </div>
    );
  }

  if (!expanded) {
    return (
      <div className="mt-3">
        <button
          className="w-full h-10 rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 text-sm font-medium active:scale-[0.98] transition-all flex items-center justify-center gap-2"
          onClick={() => setExpanded(true)}
          data-testid="button-anomaly-report"
        >
          <MessageSquareWarning className="h-4 w-4" />
          回報異常問題
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 border border-red-200 rounded-xl bg-red-50/50 p-3 space-y-3" data-testid="card-anomaly-form">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-red-600 text-sm font-medium">
          <MessageSquareWarning className="h-4 w-4" />
          回報異常問題
        </div>
        <button onClick={() => setExpanded(false)} className="text-slate-400 hover:text-slate-600 p-1">
          <X className="h-4 w-4" />
        </button>
      </div>

      <textarea
        className="w-full rounded-lg border border-red-200 bg-white p-2.5 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-300 resize-none"
        rows={3}
        placeholder="請詳細描述異常狀況，例如：打卡時 GPS 定位不準、畫面顯示錯誤、無法正常打卡等..."
        value={userNote}
        onChange={e => setUserNote(e.target.value)}
        data-testid="input-anomaly-note"
      />

      <div>
        <div className="flex items-center gap-2 mb-2">
          <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 bg-white text-xs text-red-600 hover:bg-red-50 cursor-pointer active:scale-[0.98] transition-all">
            <Camera className="h-3.5 w-3.5" />
            拍照
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleAddImages} data-testid="input-anomaly-camera" />
          </label>
          <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 bg-white text-xs text-red-600 hover:bg-red-50 cursor-pointer active:scale-[0.98] transition-all">
            <ImagePlus className="h-3.5 w-3.5" />
            選擇圖片
            <input type="file" accept="image/*" multiple className="hidden" onChange={handleAddImages} data-testid="input-anomaly-images" />
          </label>
          <span className="text-[10px] text-slate-400">{images.length}/5</span>
        </div>

        {previews.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {previews.map((src, i) => (
              <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-red-200">
                <img src={src} className="w-full h-full object-cover" />
                <button
                  className="absolute top-0 right-0 bg-red-500 text-white rounded-bl-lg p-0.5"
                  onClick={() => handleRemoveImage(i)}
                  data-testid={`button-remove-image-${i}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        className="w-full h-10 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
        onClick={handleSubmit}
        disabled={submitting}
        data-testid="button-submit-anomaly"
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            傳送中...
          </>
        ) : (
          <>
            <Send className="h-4 w-4" />
            送出異常報告
          </>
        )}
      </button>
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
  const [notBoundInfo, setNotBoundInfo] = useState<{ lineUserId: string; displayName: string } | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const lineId = params.get("lineId");

    if (code) {
      handleLineCallback(code);
    } else if (lineId) {
      verifyLineId(lineId);
    } else {
      tryLiffAutoLogin();
    }
  }, []);

  async function tryLiffAutoLogin() {
    const liffId = import.meta.env.VITE_LIFF_ID;
    if (!liffId) return;
    try {
      setChecking(true);
      const liffModule = await import("@line/liff");
      const liffInstance = liffModule.default;
      await liffInstance.init({ liffId });
      if (!liffInstance.isInClient()) {
        setChecking(false);
        return;
      }
      if (!liffInstance.isLoggedIn()) {
        liffInstance.login();
        return;
      }
      const profile = await liffInstance.getProfile();
      await verifyLineId(profile.userId);
    } catch {
      setChecking(false);
    }
  }

  async function handleLineCallback(code: string) {
    setChecking(true);
    try {
      const redirectUri = `${window.location.origin}/portal/callback`;
      const res = await apiRequest("POST", "/api/portal/line-callback", { code, redirectUri });
      const data = await res.json();
      window.history.replaceState({}, "", "/portal");
      onLogin(data);
    } catch (err: any) {
      window.history.replaceState({}, "", "/portal");
      const msg = err.message || "";
      const jsonStart = msg.indexOf("{");
      if (jsonStart !== -1) {
        try {
          const errData = JSON.parse(msg.substring(jsonStart));
          if (errData.notBound || errData.message?.includes("尚未完成系統綁定") || errData.message?.includes("找不到")) {
            setNotBoundInfo({ lineUserId: errData.lineUserId || "", displayName: errData.displayName || "" });
            return;
          }
        } catch {}
      }
      if (msg.includes("尚未完成系統綁定") || msg.includes("找不到")) {
        setNotBoundInfo({ lineUserId: "", displayName: "" });
        return;
      }
      toast({
        title: "LINE 登入失敗",
        description: msg || "驗證失敗",
        variant: "destructive",
      });
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
      if (err.message?.includes("尚未完成系統綁定") || err.message?.includes("找不到")) {
        setNotBoundInfo({ lineUserId: lineId, displayName: "" });
        return;
      }
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

  if (notBoundInfo) {
    return (
      <div className="min-h-screen bg-juns-surface flex flex-col">
        <JunsHeader />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-sm">
            <div className="border border-orange-300 rounded-xl bg-white p-6 text-center shadow-flat" data-testid="not-bound-screen">
              <div className="mb-5">
                <div className="w-16 h-16 rounded-xl bg-orange-100 flex items-center justify-center mx-auto mb-4">
                  <AlertTriangle className="h-8 w-8 text-orange-500" />
                </div>
                <h1 className="text-lg font-semibold text-juns-navy mb-2">尚未綁定系統</h1>
              </div>
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-5 text-left">
                <p className="text-sm text-orange-800 font-semibold mb-3">綁定步驟：</p>
                <ol className="text-sm text-orange-800 leading-relaxed space-y-2 list-decimal list-inside">
                  <li>回到 LINE 官方帳號對話</li>
                  <li>傳送您的<strong>「員工編號」</strong>（純數字）</li>
                  <li>系統會自動完成綁定</li>
                  <li>綁定成功後，回到此頁面重新登入</li>
                </ol>
                <p className="text-xs text-orange-600 mt-3">如不確定員工編號，請洽詢主管或 HR。</p>
              </div>
              {notBoundInfo.lineUserId && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-5 text-left">
                  <p className="text-[11px] text-slate-400 mb-1">您的 LINE ID（供技術支援參考）</p>
                  <p className="text-xs text-slate-700 font-mono break-all select-all" data-testid="text-line-user-id">{notBoundInfo.lineUserId}</p>
                  {notBoundInfo.displayName && (
                    <p className="text-xs text-slate-500 mt-1">LINE 名稱：{notBoundInfo.displayName}</p>
                  )}
                </div>
              )}
              <AnomalyReportButton context="LINE 帳號未綁定系統" errorMsg={`LINE User ID: ${notBoundInfo.lineUserId || "未知"}${notBoundInfo.displayName ? `, 顯示名稱: ${notBoundInfo.displayName}` : ""}`} />

              <button
                className="w-full h-11 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-medium text-sm active:scale-[0.98] transition-all mt-2"
                onClick={() => setNotBoundInfo(null)}
                data-testid="button-back-to-login"
              >
                返回登入頁
              </button>
            </div>
          </div>
        </div>
      </div>
    );
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
              <AnomalyReportButton context="登入異常" errorMsg="無法登入系統" />
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

  const taiwanNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const dateStr = format(taiwanNow, "M月d日 EEEE", { locale: zhTW });
  const timeStr = format(taiwanNow, "HH:mm");
  const secStr = format(taiwanNow, ":ss");

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
  const todayShift = (
    matchedVenue
      ? todayShifts.find(s => s.venue?.name === matchedVenue || s.venue?.shortName === matchedVenue)
      : null
  ) ?? todayShifts[0] ?? null;

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

const EARLY_ARRIVAL_REASONS = [
  "提早到，先休息等上班",
  "提早到，先吃早餐等上班",
];
const LATE_DEPARTURE_REASONS = [
  "在跟同事聊天，晚下班打卡",
  "在整理個人物品，晚下班打卡",
  "加班",
];

const CLOCK_LOCK_MS = 60 * 60 * 1000;

function RadarClockIn({ employee, onPositionUpdate, onResult, todayLatestClock, todayClockIn, todayClockOut }: {
  employee: PortalEmployee;
  onPositionUpdate?: (lat: number, lng: number) => void;
  onResult?: (r: ClockInResult) => void;
  todayLatestClock?: { clockType: string; clockTime: string } | null;
  todayClockIn?: { clockTime: string } | null;
  todayClockOut?: { clockTime: string } | null;
}) {
  const [stage, setStage] = useState<"idle" | "scanning" | "submitting" | "done" | "error">("idle");
  const [result, setResult] = useState<ClockInResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [scanAngle, setScanAngle] = useState(0);
  const [reasonSubmitted, setReasonSubmitted] = useState(false);
  const [reasonSubmitting, setReasonSubmitting] = useState(false);
  const [lockedClock, setLockedClock] = useState<{ clockType: "in" | "out"; timeStr: string; timestamp: number } | null>(null);
  const [countdown, setCountdown] = useState(0);
  const { toast } = useToast();

  const storageKey = `last_clock_${employee.id}`;

  useEffect(() => {
    let lockInfo: { clockType: "in" | "out"; timeStr: string; timestamp: number } | null = null;
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Date.now() - parsed.timestamp < CLOCK_LOCK_MS) {
          lockInfo = parsed;
        } else {
          localStorage.removeItem(storageKey);
        }
      } catch {
        localStorage.removeItem(storageKey);
      }
    }
    if (!lockInfo && todayLatestClock) {
      const ts = new Date(todayLatestClock.clockTime).getTime();
      if (Date.now() - ts < CLOCK_LOCK_MS) {
        const timeStr = new Date(todayLatestClock.clockTime).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false });
        lockInfo = { clockType: todayLatestClock.clockType as "in" | "out", timeStr, timestamp: ts };
        localStorage.setItem(storageKey, JSON.stringify(lockInfo));
      }
    }
    if (lockInfo) {
      setLockedClock(lockInfo);
      setCountdown(Math.max(1, Math.ceil((CLOCK_LOCK_MS - (Date.now() - lockInfo.timestamp)) / 60000)));
    }
  }, [employee.id, todayLatestClock, storageKey]);

  useEffect(() => {
    if (!lockedClock) return;
    const interval = setInterval(() => {
      const remaining = Math.ceil((CLOCK_LOCK_MS - (Date.now() - lockedClock.timestamp)) / 60000);
      if (remaining <= 0) {
        setLockedClock(null);
        setCountdown(0);
        localStorage.removeItem(storageKey);
      } else {
        setCountdown(remaining);
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [lockedClock, storageKey]);

  const needsReasonSelection = result && (result.earlyArrival || result.lateDeparture) && !reasonSubmitted;

  const handleReasonSelect = async (reason: string) => {
    if (!result?.recordId) return;
    setReasonSubmitting(true);
    try {
      const body = result.earlyArrival
        ? { earlyArrivalReason: reason }
        : { lateDepartureReason: reason };
      const res = await apiRequest("PATCH", `/api/portal/clock-records/${result.recordId}/reason`, body);
      const data = await res.json();
      setReasonSubmitted(true);
      if (data.overtimeRequest) {
        toast({ title: "已記錄原因，並自動產生加班申請（待主管審核）" });
      } else {
        toast({ title: "已記錄原因" });
      }
    } catch (err: any) {
      toast({ title: err.message || "記錄原因失敗", variant: "destructive" });
    } finally {
      setReasonSubmitting(false);
    }
  };

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
    setReasonSubmitted(false);

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
      if (data.status === "success" || data.status === "warning") {
        const ts = Date.now();
        const timeStr = data.time;
        const lock = { clockType, timeStr, timestamp: ts };
        localStorage.setItem(storageKey, JSON.stringify(lock));
        setLockedClock(lock);
        setCountdown(60);
      }
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
  }, [employee.id, storageKey]);

  return (
    <div className="border border-juns-border rounded-xl bg-white overflow-hidden" data-testid="card-gps-clock-in">
      <div className="px-4 py-3 border-b border-juns-border flex items-center gap-2">
        <Signal className="h-4 w-4 text-juns-teal" />
        <span className="text-sm font-semibold text-juns-navy">GPS 定位打卡</span>
      </div>

      <div className="p-4">
        {stage === "idle" && (() => {
          const serverInTime = todayClockIn?.clockTime
            ? new Date(todayClockIn.clockTime).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false })
            : null;
          const serverOutTime = todayClockOut?.clockTime
            ? new Date(todayClockOut.clockTime).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false })
            : null;
          const clockInLocked = !!(todayClockIn || lockedClock?.clockType === "in");
          const clockOutLocked = !!(todayClockOut || lockedClock?.clockType === "out");
          const clockInTime = serverInTime || (lockedClock?.clockType === "in" ? lockedClock.timeStr : null);
          const clockOutTime = serverOutTime || (lockedClock?.clockType === "out" ? lockedClock.timeStr : null);

          return (
            <div className="grid grid-cols-2 gap-3">
              {clockInLocked ? (
                <button disabled className="h-14 rounded-lg bg-emerald-100 border-2 border-emerald-400 text-emerald-700 font-semibold text-sm flex flex-col items-center justify-center gap-0.5 cursor-not-allowed" data-testid="button-clock-in">
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>上班已打卡</span>
                  </div>
                  {clockInTime && <span className="text-xs font-bold">{clockInTime}</span>}
                </button>
              ) : (
                <button
                  className="h-12 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-base flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
                  onClick={() => handleClockIn("in")}
                  data-testid="button-clock-in"
                >
                  ↑ 上班
                </button>
              )}
              {clockOutLocked ? (
                <button disabled className="h-14 rounded-lg bg-blue-100 border-2 border-blue-400 text-blue-700 font-semibold text-sm flex flex-col items-center justify-center gap-0.5 cursor-not-allowed" data-testid="button-clock-out">
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>下班已打卡</span>
                  </div>
                  {clockOutTime && <span className="text-xs font-bold">{clockOutTime}</span>}
                </button>
              ) : (
                <button
                  className="h-12 rounded-lg bg-blue-500 hover:bg-blue-600 text-white font-semibold text-base flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
                  onClick={() => handleClockIn("out")}
                  data-testid="button-clock-out"
                >
                  ↓ 下班
                </button>
              )}
            </div>
          );
        })()}

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

            {needsReasonSelection && (
              <div className={`p-3 rounded-lg mb-3 border ${result.earlyArrival ? "bg-blue-50 border-blue-200" : "bg-orange-50 border-orange-200"}`} data-testid="card-reason-selection">
                <p className={`text-sm font-medium mb-3 ${result.earlyArrival ? "text-blue-700" : "text-orange-700"}`}>
                  {result.earlyArrival
                    ? `您提早 ${result.earlyMinutes} 分鐘到，請選擇原因：`
                    : `您晚於班表時間 ${result.lateMinutes} 分鐘下班，請選擇原因：`
                  }
                </p>
                <div className="space-y-2">
                  {(result.earlyArrival ? EARLY_ARRIVAL_REASONS : LATE_DEPARTURE_REASONS).map((r, i) => (
                    <button
                      key={i}
                      disabled={reasonSubmitting}
                      onClick={() => handleReasonSelect(r)}
                      className={`w-full py-2.5 px-3 rounded-lg text-sm font-medium text-left transition-colors disabled:opacity-50 ${
                        result.earlyArrival
                          ? "bg-blue-100 hover:bg-blue-200 text-blue-800 border border-blue-300"
                          : "bg-orange-100 hover:bg-orange-200 text-orange-800 border border-orange-300"
                      }`}
                      data-testid={`button-reason-${i}`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {reasonSubmitted && (
              <div className="p-3 rounded-lg mb-3 bg-green-50 border border-green-200" data-testid="card-reason-confirmed">
                <p className="text-sm text-green-700 font-medium">
                  {result.earlyArrival ? "已記錄，請於班表時間開始後正式上班" : "原因已記錄"}
                </p>
              </div>
            )}

            <AnomalyReportButton employee={employee} clockResult={result} accuracy={accuracy} context="打卡異常" />

            {!needsReasonSelection && (
              <button
                className="w-full h-10 rounded-lg border border-juns-border bg-white text-sm text-slate-600 hover:bg-slate-50 active:scale-[0.98] transition-all mt-2"
                onClick={() => { setStage("idle"); setResult(null); setReasonSubmitted(false); }}
                data-testid="button-clock-again"
              >
                返回打卡畫面
              </button>
            )}
          </div>
        )}

        {stage === "error" && (
          <div>
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 mb-3">
              <XCircle className="h-5 w-5 text-red-500 shrink-0" />
              <span className="font-medium text-sm text-red-500">{errorMsg}</span>
            </div>
            <AnomalyReportButton employee={employee} errorMsg={errorMsg} accuracy={accuracy} context="打卡錯誤" />
            <button
              className="w-full h-10 rounded-lg border border-juns-border bg-white text-sm text-slate-600 hover:bg-slate-50 active:scale-[0.98] transition-all mt-2"
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

interface ClockAmendmentRecord {
  id: number;
  employeeId: number;
  clockType: string;
  requestedTime: string;
  reason: string;
  status: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
}

function ClockAmendmentSection({ employee }: { employee: PortalEmployee }) {
  const [expanded, setExpanded] = useState(false);
  const [clockType, setClockType] = useState<"in" | "out">("in");
  const [requestedDate, setRequestedDate] = useState(() => {
    const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [requestedTime, setRequestedTime] = useState("09:00");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const { data: amendments = [], refetch: refetchAmendments } = useQuery<ClockAmendmentRecord[]>({
    queryKey: ["/api/portal/clock-amendments", employee.id],
    enabled: expanded,
  });

  const handleSubmit = async () => {
    if (!reason.trim()) {
      toast({ title: "請輸入補打卡原因", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const fullTime = `${requestedDate}T${requestedTime}:00+08:00`;
      await apiRequest("POST", "/api/portal/clock-amendment", {
        employeeId: employee.id,
        clockType,
        requestedTime: fullTime,
        reason: reason.trim(),
      });
      toast({ title: "補打卡申請已送出" });
      setReason("");
      refetchAmendments();
    } catch (err: any) {
      toast({ title: err.message || "送出失敗", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const statusLabel = (s: string) => {
    if (s === "pending") return "待審核";
    if (s === "approved") return "已批准";
    if (s === "rejected") return "已駁回";
    return s;
  };

  const statusColor = (s: string) => {
    if (s === "pending") return "bg-orange-500/10 text-orange-600 border-orange-500/20";
    if (s === "approved") return "bg-green-500/10 text-green-600 border-green-500/20";
    if (s === "rejected") return "bg-red-500/10 text-red-600 border-red-500/20";
    return "";
  };

  return (
    <div className="border border-juns-border rounded-xl bg-white overflow-hidden" data-testid="card-clock-amendment">
      <button
        className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors"
        onClick={() => setExpanded(!expanded)}
        data-testid="button-toggle-amendment"
      >
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-juns-teal" />
          <span className="text-sm font-semibold text-juns-navy">補打卡申請</span>
        </div>
        <ChevronRight className={`h-4 w-4 text-slate-400 transition-transform ${expanded ? "rotate-90" : ""}`} />
      </button>
      {expanded && (
        <div className="border-t border-juns-border p-4 space-y-4">
          <div className="space-y-3">
            <div className="flex gap-2">
              <button
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${clockType === "in" ? "bg-juns-teal text-white" : "bg-slate-100 text-slate-600"}`}
                onClick={() => setClockType("in")}
                data-testid="button-amendment-type-in"
              >
                上班
              </button>
              <button
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${clockType === "out" ? "bg-juns-teal text-white" : "bg-slate-100 text-slate-600"}`}
                onClick={() => setClockType("out")}
                data-testid="button-amendment-type-out"
              >
                下班
              </button>
            </div>
            <div className="flex gap-2">
              <input
                type="date"
                value={requestedDate}
                onChange={(e) => setRequestedDate(e.target.value)}
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                data-testid="input-amendment-date"
              />
              <input
                type="time"
                value={requestedTime}
                onChange={(e) => setRequestedTime(e.target.value)}
                className="w-28 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                data-testid="input-amendment-time"
              />
            </div>
            <textarea
              placeholder="請輸入補打卡原因（例：忘記打卡）"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white resize-none"
              rows={2}
              data-testid="input-amendment-reason"
            />
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full py-2.5 bg-juns-navy text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-juns-navy/90 transition-colors"
              data-testid="button-submit-amendment"
            >
              {submitting ? "送出中..." : "送出申請"}
            </button>
          </div>

          {amendments.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-500">申請記錄</p>
              {amendments.map((a) => (
                <div key={a.id} className="flex items-start gap-3 p-3 rounded-lg bg-slate-50" data-testid={`row-amendment-${a.id}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className={statusColor(a.status)} data-testid={`badge-status-${a.id}`}>
                        {statusLabel(a.status)}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {a.clockType === "in" ? "上班" : "下班"}
                      </Badge>
                    </div>
                    <p className="text-sm text-juns-navy">
                      {new Date(a.requestedTime).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">{a.reason}</p>
                    {a.reviewedByName && a.reviewedAt && (
                      <p className="text-xs text-slate-400 mt-0.5">
                        審核主管：{a.reviewedByName} | {new Date(a.reviewedAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    )}
                    {a.reviewNote && (
                      <p className="text-xs text-slate-400 mt-0.5">審核備註：{a.reviewNote}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface OvertimeRequestRecord {
  id: number;
  employeeId: number;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
  status: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
}

function OvertimeRequestSection({ employee }: { employee: PortalEmployee }) {
  const [expanded, setExpanded] = useState(false);
  const [date, setDate] = useState(() => {
    const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [startTime, setStartTime] = useState("18:00");
  const [endTime, setEndTime] = useState("19:00");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const { data: requests = [], refetch } = useQuery<OvertimeRequestRecord[]>({
    queryKey: ["/api/portal/overtime-requests", employee.id],
    enabled: expanded,
  });

  const handleSubmit = async () => {
    if (!reason.trim()) {
      toast({ title: "請輸入加班原因", variant: "destructive" });
      return;
    }
    if (startTime >= endTime) {
      toast({ title: "結束時間必須晚於開始時間", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest("POST", "/api/portal/overtime-request", {
        employeeId: employee.id,
        date,
        startTime,
        endTime,
        reason: reason.trim(),
      });
      toast({ title: "加班申請已送出" });
      setReason("");
      refetch();
    } catch (err: any) {
      toast({ title: err.message || "送出失敗", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const statusLabel = (s: string) => {
    if (s === "pending") return "待審核";
    if (s === "approved") return "已批准";
    if (s === "rejected") return "已駁回";
    return s;
  };

  const statusColor = (s: string) => {
    if (s === "pending") return "bg-orange-500/10 text-orange-600 border-orange-500/20";
    if (s === "approved") return "bg-green-500/10 text-green-600 border-green-500/20";
    if (s === "rejected") return "bg-red-500/10 text-red-600 border-red-500/20";
    return "";
  };

  return (
    <div className="border border-juns-border rounded-xl bg-white overflow-hidden" data-testid="card-overtime-request">
      <button
        className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors"
        onClick={() => setExpanded(!expanded)}
        data-testid="button-toggle-overtime"
      >
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-semibold text-juns-navy">加班申請</span>
        </div>
        <ChevronRight className={`h-4 w-4 text-slate-400 transition-transform ${expanded ? "rotate-90" : ""}`} />
      </button>
      {expanded && (
        <div className="border-t border-juns-border p-4 space-y-4">
          <div className="space-y-3">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
              data-testid="input-overtime-date"
            />
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs text-slate-500 mb-1 block">開始時間</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                  data-testid="input-overtime-start"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs text-slate-500 mb-1 block">結束時間</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                  data-testid="input-overtime-end"
                />
              </div>
            </div>
            <textarea
              placeholder="請輸入加班原因"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white resize-none"
              rows={2}
              data-testid="input-overtime-reason"
            />
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full py-2.5 bg-amber-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-amber-600 transition-colors"
              data-testid="button-submit-overtime"
            >
              {submitting ? "送出中..." : "送出加班申請"}
            </button>
          </div>

          {requests.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-500">申請記錄</p>
              {requests.map((r) => (
                <div key={r.id} className="flex items-start gap-3 p-3 rounded-lg bg-slate-50" data-testid={`row-overtime-${r.id}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className={statusColor(r.status)} data-testid={`badge-overtime-status-${r.id}`}>
                        {statusLabel(r.status)}
                      </Badge>
                    </div>
                    <p className="text-sm text-juns-navy">
                      {r.date} {r.startTime}~{r.endTime}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">{r.reason}</p>
                    {r.reviewedByName && r.reviewedAt && (
                      <p className="text-xs text-slate-400 mt-0.5">
                        審核主管：{r.reviewedByName} | {new Date(r.reviewedAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    )}
                    {r.reviewNote && (
                      <p className="text-xs text-slate-400 mt-0.5">審核備註：{r.reviewNote}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PortalMain({ employee }: { employee: PortalEmployee }) {
  const [viewMode, setViewMode] = useState<"calendar" | "list">("calendar");
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [showGuidelines, setShowGuidelines] = useState(false);
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  const [clockInResult, setClockInResult] = useState<ClockInResult | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserPos({ lat: position.coords.latitude, lng: position.coords.longitude });
        },
        () => {},
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    }
  }, []);

  const monthStart = format(startOfMonth(currentMonth), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(currentMonth), "yyyy-MM-dd");

  const { data: myShifts = [], isLoading: shiftsLoading } = useQuery<PortalShift[]>({
    queryKey: ["/api/portal/my-shifts", employee.id, monthStart, monthEnd],
  });

  const { data: todayCoworkers = [], isLoading: coworkersLoading } = useQuery<CoworkerGroup[]>({
    queryKey: ["/api/portal/today-coworkers", employee.id],
    enabled: !!employee?.id,
    staleTime: 60 * 1000,
  });

  const { data: attendance, isLoading: attendanceLoading } = useQuery<AttendanceSummary>({
    queryKey: ["/api/portal/my-attendance", employee.id],
    enabled: !!employee?.id,
    staleTime: 60 * 1000,
  });

  const { data: guidelinesData } = useQuery<{ items: GuidelineItem[]; allAcknowledged: boolean }>({
    queryKey: ["/api/portal/guidelines-check", employee.id],
    enabled: showGuidelines && !!employee?.id,
    staleTime: 60 * 1000,
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
        <RadarClockIn
          employee={employee}
          onPositionUpdate={(lat, lng) => setUserPos({ lat, lng })}
          onResult={(result) => {
            setClockInResult(result);
            if (result.status === "success" || result.status === "warning") {
              queryClient.invalidateQueries({ queryKey: ["/api/portal/my-attendance", employee.id] });
              queryClient.invalidateQueries({ queryKey: ["/api/portal/today-coworkers", employee.id] });
            }
          }}
          todayLatestClock={attendance?.todayLatestClock}
          todayClockIn={attendance?.todayClockIn}
          todayClockOut={attendance?.todayClockOut}
        />

        <div className="border border-juns-border rounded-xl bg-white overflow-hidden" data-testid="card-outing-signin">
          <button
            className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors"
            data-testid="button-outing-signin"
            onClick={() => toast({ title: "外出/簽到功能即將推出", description: "此功能尚未開放，敬請期待" })}
          >
            <span className="text-sm font-semibold text-juns-navy">外出/簽到</span>
            <ChevronRight className="h-4 w-4 text-slate-400" />
          </button>
        </div>

        <ClockAmendmentSection employee={employee} />
        <OvertimeRequestSection employee={employee} />

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
                <div className="grid grid-cols-7 gap-1">
                  {calendarDays.map((day, idx) => {
                    if (!day) return <div key={`pad-${idx}`} className="min-h-[90px]" />;
                    const dateStr = format(day, "yyyy-MM-dd");
                    const dayShifts = shiftsByDate.get(dateStr) || [];
                    const today = isToday(day);
                    return (
                      <div
                        key={dateStr}
                        className={`min-h-[72px] p-1 rounded-md border ${
                          today ? "border-juns-teal bg-juns-teal/5" : "border-slate-100"
                        } ${dayShifts.length > 0 ? "bg-slate-50" : ""}`}
                        data-testid={`cell-day-${dateStr}`}
                      >
                        <div className={`text-xs text-center mb-0.5 ${today ? "font-bold text-juns-teal" : "text-slate-400"}`}>
                          {format(day, "d")}
                        </div>
                        {dayShifts.map((s, i) => {
                          const rd = getRoleDisplay(s.assignedRole);
                          const roleAbbrev = ROLE_SHORT[s.assignedRole || ""] || "";
                          const timeStr = `${s.startTime.slice(0, 5).replace(":", "")}-${s.endTime.slice(0, 5).replace(":", "")}`;
                          const venuePart = s.venue?.shortName || "";
                          return (
                            <div key={i} className={`text-[10px] leading-tight px-0.5 py-0.5 rounded border-l-2 mb-0.5 ${rd.borderClass} bg-white whitespace-nowrap overflow-hidden`}>
                              <span className="font-semibold text-juns-navy">{venuePart}</span>
                              <span className={`font-medium ${rd.textClass}`}>{roleAbbrev}</span>
                              <span className="text-slate-500">{timeStr}</span>
                            </div>
                          );
                        })}
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
                          className={`flex items-center gap-2.5 py-1.5 px-3 rounded-lg border border-juns-border ${
                            isToday(d) ? "border-juns-teal bg-juns-teal/5" : "bg-white"
                          }`}
                          data-testid={`shift-row-${s.id}`}
                        >
                          <div className="text-center min-w-[40px] shrink-0">
                            <div className="text-xs text-slate-500 font-mono leading-none">{format(d, "M/d")}</div>
                            <div className={`text-[11px] leading-none mt-0.5 ${dayLabel === "日" || dayLabel === "六" ? "text-red-400" : "text-slate-400"}`}>
                              ({dayLabel})
                            </div>
                          </div>
                          <div className={`w-0.5 h-6 rounded-full shrink-0`} style={{ backgroundColor: rd.color }} />
                          <div className="flex-1 min-w-0 flex items-center gap-1 overflow-hidden">
                            <span className="text-sm font-medium text-juns-navy shrink-0">{s.venue?.shortName || "未知"}</span>
                            <span className="text-slate-300 shrink-0">·</span>
                            <span className={`text-xs shrink-0 ${rd.textClass}`}>{rd.label}</span>
                            <span className="text-slate-300 shrink-0">·</span>
                            <span className="text-xs text-slate-400 font-mono truncate">
                              {s.startTime.slice(0, 5)}-{s.endTime.slice(0, 5)}
                            </span>
                            {s.isDispatch && <span className="text-[10px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-600 shrink-0 ml-1">派遣</span>}
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
                    // 守望 is a lifeguard sub-type — merge under 救生 category
                    const rawRole = cw.shiftRole || "其他";
                    const key = rawRole === "守望" ? "救生" : rawRole;
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
                                    {rd.label}
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
            ) : !attendance || attendance.records.length === 0 ? (
              <p className="text-sm text-center text-slate-400 py-3">本月尚無出勤紀錄</p>
            ) : (
              <div>
                <div className="grid grid-cols-4 gap-2 mb-4">
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
                <div className="space-y-2">
                  {attendance.records.map((r, idx) => {
                    const d = parseISO(r.date);
                    const tags: string[] = [];
                    if (r.isLate) tags.push("遲到");
                    if (r.isEarlyLeave) tags.push("早退");
                    if (r.hasAnomaly) tags.push("異常");
                    return (
                      <div key={idx} className="rounded-lg border border-juns-border overflow-hidden">
                        <div className="px-3 py-1.5 bg-slate-50 border-b border-juns-border flex items-center justify-between">
                          <span className="text-xs font-semibold text-juns-navy font-mono">
                            {format(d, "M月d日")}（{format(d, "EEE", { locale: zhTW })}）
                          </span>
                          {r.shiftInfo && (
                            <span className="text-[10px] text-slate-400">{r.shiftInfo}</span>
                          )}
                        </div>
                        <div className="divide-y divide-juns-border">
                          <div className="flex items-center gap-2.5 px-3 py-2">
                            <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                            <span className="text-[11px] text-slate-400 w-12">上班打卡</span>
                            {r.clockIn ? (
                              <span className="text-sm font-mono font-semibold text-green-700">{r.clockIn}</span>
                            ) : (
                              <span className="text-xs text-slate-300 italic">未打卡</span>
                            )}
                            {r.isLate && (
                              <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-500">遲到</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2.5 px-3 py-2">
                            <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                            <span className="text-[11px] text-slate-400 w-12">下班打卡</span>
                            {r.clockOut ? (
                              <span className="text-sm font-mono font-semibold text-blue-700">{r.clockOut}</span>
                            ) : (
                              <span className="text-xs text-slate-300 italic">未打卡</span>
                            )}
                            {r.isEarlyLeave && (
                              <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-500">早退</span>
                            )}
                            {r.hasAnomaly && !r.isEarlyLeave && (
                              <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-500">異常</span>
                            )}
                          </div>
                          {tags.length === 0 && r.clockIn && r.clockOut && (
                            <div className="px-3 py-1 flex justify-end">
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-600">正常</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
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

        <div className="px-1">
          <p className="text-[11px] text-slate-400 leading-relaxed bg-slate-50 rounded-lg px-3 py-2">
            line＠通知訊息僅做日常提醒叮嚀使用，實際班別/課表請以系統公告之，不得主張因未收到line＠提醒而導致遲到、早退、曠班、曠課等一切未依班表或課表出席。
          </p>
        </div>
      </div>
    </div>
  );
}

function NotLineBrowser() {
  return (
    <div className="min-h-screen bg-juns-surface flex flex-col items-center justify-center p-8 text-center">
      <img src={junsLogo} alt="駿斯" className="h-14 w-14 rounded-xl mb-6 object-cover" />
      <h1 className="text-lg font-bold text-juns-navy mb-3">請使用 LINE 開啟</h1>
      <p className="text-sm text-slate-500 leading-relaxed mb-6">
        員工入口網站僅限在<span className="font-semibold text-juns-navy"> LINE 內建瀏覽器 </span>中使用，
        以確保帳號安全與正常功能。
      </p>
      <p className="text-xs text-slate-400 leading-relaxed">
        請在 LINE 中點選官方帳號連結，或由 LINE 選單進入此頁面。
      </p>
    </div>
  );
}

function PortalPageInner() {
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
    queryClient.invalidateQueries({ queryKey: ["/api/portal/today-coworkers", emp.id] });
    queryClient.invalidateQueries({ queryKey: ["/api/portal/my-attendance", emp.id] });
    queryClient.invalidateQueries({ queryKey: ["/api/portal/guidelines-check", emp.id] });
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

export default function PortalPage() {
  return <PortalPageInner />;
}
