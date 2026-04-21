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
  Video, FileText, Image as ImageIcon, CheckCircle2, Lock, UserCheck,
  AlertTriangle, ClipboardCheck, BookOpen, Navigation, Loader2, XCircle,
  Wifi, Signal, Copy, MessageSquareWarning, Camera, X, ImagePlus, Send,
  Menu, Home, LogOut, FileEdit, Briefcase, BarChart2,
  type LucideIcon,
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
  certificateImageUrl?: string | null;
  notes?: string | null;
  _isDispatchRecord?: boolean;
}

interface AnnouncementItem {
  id: number;
  title: string;
  content: string;
  targetRegion: string | null;
  publishedAt: string;
  expiresAt: string | null;
}

interface CoworkerGroup {
  venue: { id: number; shortName: string } | null;
  coworkers: { id: number; name: string; phone: string | null; role: string; shiftRole: string; shiftTime: string | null; isDispatch?: boolean }[];
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
  imageUrl: string | null;
  imageUrls: string[] | null;
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
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='260' height='130'><text transform='rotate(-30 130 65)' x='10' y='75' font-family='system-ui,sans-serif' font-size='13' font-weight='500' fill='rgba(128,128,128,0.08)'>${text}</text></svg>`;
  return (
    <div
      className="fixed inset-0 pointer-events-none z-50 select-none"
      aria-hidden="true"
      style={{
        backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
        backgroundRepeat: "repeat",
      }}
    />
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

function JunsHeader({
  employee, showBack, onBack, pageTitle, onMenuOpen,
}: {
  employee?: PortalEmployee;
  showBack?: boolean;
  onBack?: () => void;
  pageTitle?: string;
  onMenuOpen?: () => void;
}) {
  return (
    <div className="sticky top-0 z-40 bg-juns-navy text-white">
      <div className="px-4 py-3 flex items-center gap-3">
        {onMenuOpen ? (
          <button
            onClick={onMenuOpen}
            className="p-1.5 -ml-1 rounded-md hover:bg-white/10 active:bg-white/20 transition-colors shrink-0"
            data-testid="button-open-menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        ) : showBack && onBack ? (
          <button
            onClick={onBack}
            className="p-1.5 -ml-1 rounded-md hover:bg-white/10 active:bg-white/20 transition-colors shrink-0"
            data-testid="button-back"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        ) : null}
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold truncate" data-testid="text-portal-main-title">
            {pageTitle || (employee ? employee.name : "駿斯運動事業")}
          </h1>
        </div>
        {employee && (
          <div className="flex items-center gap-1 text-[11px] bg-juns-green/20 text-juns-green px-2 py-1 rounded-full shrink-0">
            <div className="w-1.5 h-1.5 rounded-full bg-juns-green animate-pulse" />
            已連線
          </div>
        )}
      </div>
    </div>
  );
}

type PortalView = "home" | "outing" | "attendance" | "schedule" | "coworkers" | "amendment" | "overtime" | "leave" | "guidelines";

const VIEW_TITLES: Record<PortalView, string> = {
  home: "打卡首頁",
  outing: "外出簽到",
  attendance: "本月出缺勤統計",
  schedule: "我的班表",
  coworkers: "今日工作夥伴",
  amendment: "補打卡申請",
  overtime: "加班申請",
  leave: "請假申請",
  guidelines: "員工守則",
};

function SideMenuDrawer({
  employee, activeView, amendmentRemaining, onNavigate, onClose, onLogout,
}: {
  employee: PortalEmployee;
  activeView: PortalView;
  amendmentRemaining: number;
  onNavigate: (view: PortalView) => void;
  onClose: () => void;
  onLogout: () => void;
}) {
  const categories: Array<{
    label: string;
    items: Array<{ view: PortalView; label: string; icon: LucideIcon; badge?: string }>;
  }> = [
    {
      label: "日常考勤",
      items: [
        { view: "home", label: "打卡首頁", icon: Home },
        { view: "outing", label: "外出簽到", icon: Navigation },
        { view: "attendance", label: "本月出缺勤統計", icon: BarChart2 },
      ],
    },
    {
      label: "排班協作",
      items: [
        { view: "schedule", label: "我的班表", icon: CalendarDays },
        { view: "coworkers", label: "今日工作夥伴", icon: Users },
      ],
    },
    {
      label: "表單申請",
      items: [
        { view: "amendment", label: "補打卡申請", icon: FileEdit, badge: `剩餘 ${amendmentRemaining} 次` },
        { view: "overtime", label: "加班申請", icon: Briefcase },
        { view: "leave", label: "請假申請", icon: CalendarDays },
      ],
    },
    {
      label: "系統資訊",
      items: [
        { view: "guidelines", label: "員工守則", icon: BookOpen },
      ],
    },
  ];

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-40 backdrop-blur-[2px]"
        onClick={onClose}
        data-testid="overlay-side-menu"
      />
      <div
        className="fixed left-0 top-0 bottom-0 w-72 bg-white z-50 shadow-2xl flex flex-col"
        data-testid="drawer-side-menu"
        style={{ animation: "slideInLeft 0.22s ease-out" }}
      >
        <div className="bg-juns-navy px-4 py-4 flex items-center justify-between">
          <span className="text-white font-semibold text-base">系統選單</span>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-white/10 text-white transition-colors"
            data-testid="button-close-menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-juns-teal/20 flex items-center justify-center shrink-0">
              <span className="text-juns-teal font-bold text-base">{employee.name.charAt(0)}</span>
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-juns-navy text-sm truncate">{employee.name}</p>
              <p className="text-[11px] text-slate-400">{employee.employeeCode} · {ROLE_LABELS[employee.role] || employee.role}</p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {categories.map((cat) => (
            <div key={cat.label} className="mb-1">
              <div className="px-4 pt-3 pb-1.5 border-b border-slate-100">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">{cat.label}</p>
              </div>
              {cat.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeView === item.view;
                return (
                  <button
                    key={item.view}
                    onClick={() => onNavigate(item.view)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-juns-teal/10 text-juns-teal border-r-2 border-juns-teal"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                    data-testid={`menu-item-${item.view}`}
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${isActive ? "text-juns-teal" : "text-slate-400"}`} />
                    <span className="flex-1 text-left">{item.label}</span>
                    {item.badge && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                        amendmentRemaining === 0
                          ? "bg-red-100 text-red-600"
                          : "bg-juns-teal/15 text-juns-teal"
                      }`}>
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="border-t border-slate-100 px-4 py-3">
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            data-testid="button-logout"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            登出系統
          </button>
        </div>
      </div>
      <style>{`
        @keyframes slideInLeft {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </>
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
  const [loadTimeout, setLoadTimeout] = useState(false);

  const { data, isLoading, isError } = useQuery<{ items: GuidelineItem[]; allAcknowledged: boolean }>({
    queryKey: ["/api/portal/guidelines-check", employee.id],
    staleTime: 60 * 1000,
  });

  // Auto-advance when all guidelines are already acknowledged
  useEffect(() => {
    if (data?.allAcknowledged) {
      onComplete();
    }
  }, [data?.allAcknowledged, onComplete]);

  // Fail-open: if the API errors, don't block the employee
  useEffect(() => {
    if (isError) {
      onComplete();
    }
  }, [isError, onComplete]);

  // Loading timeout: show a manual bypass button after 8 s; reset when loading clears
  useEffect(() => {
    if (!isLoading) {
      setLoadTimeout(false);
      return;
    }
    const t = setTimeout(() => setLoadTimeout(true), 8000);
    return () => clearTimeout(t);
  }, [isLoading]);

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
            {loadTimeout && (
              <button
                onClick={onComplete}
                className="w-full py-2.5 rounded-lg border border-slate-300 text-sm text-slate-500 hover:bg-slate-50 transition-colors"
                data-testid="button-skip-guidelines-timeout"
              >
                載入逾時，直接進入
              </button>
            )}
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
              <GuidelineItemCard key={item.id} item={item} employeeId={employee.id} />
            ))}
          </div>
        )}

        {monthlyItems.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-500 flex items-center gap-1.5 px-1">
              <CalendarDays className="h-3.5 w-3.5" /> 本月公告
            </h3>
            {monthlyItems.map((item) => (
              <GuidelineItemCard key={item.id} item={item} employeeId={employee.id} />
            ))}
          </div>
        )}

        {confidentialityItems.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-500 flex items-center gap-1.5 px-1">
              <Lock className="h-3.5 w-3.5" /> 保密同意書
            </h3>
            {confidentialityItems.map((item) => (
              <GuidelineItemCard key={item.id} item={item} employeeId={employee.id} />
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

function GuidelineItemCard({ item, employeeId }: { item: GuidelineItem; employeeId?: number }) {
  const [zoomedUrl, setZoomedUrl] = useState<string | null>(null);

  // Close on Escape, and lock body scroll while the lightbox is open
  // (mobile is the primary use case — prevents page scrolling behind the overlay).
  useEffect(() => {
    if (!zoomedUrl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoomedUrl(null);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [zoomedUrl]);

  const { data: fullItem } = useQuery<GuidelineItem>({
    queryKey: ["/api/portal/guidelines", item.id, employeeId],
    queryFn: async () => {
      const url = `/api/portal/guidelines/${item.id}?employeeId=${employeeId}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: item.contentType === "image" && !!employeeId,
  });

  return (
    <>
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
              {item.contentType === "image" && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 border border-juns-border">
                  <ImageIcon className="h-2.5 w-2.5 inline mr-0.5" />
                  圖片
                </span>
              )}
              {item.acknowledged && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-juns-green/10 text-juns-green">
                  <CheckCircle2 className="h-2.5 w-2.5 inline mr-0.5" />
                  已確認
                </span>
              )}
            </div>
            {item.content && (
              <p className="text-xs text-slate-500 whitespace-pre-wrap">{item.content}</p>
            )}
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
            {item.contentType === "image" && (() => {
              const source = fullItem || item;
              const urls = (source.imageUrls && source.imageUrls.length > 0)
                ? source.imageUrls
                : source.imageUrl ? [source.imageUrl] : [];
              return urls.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {urls.map((url, idx) => (
                    <img
                      key={idx}
                      src={url}
                      alt={`${item.title} ${idx + 1}`}
                      className="w-full max-h-64 object-contain rounded-lg border border-juns-border cursor-zoom-in active:opacity-80"
                      onClick={() => setZoomedUrl(url)}
                      data-testid={`img-portal-guideline-${item.id}-${idx}`}
                    />
                  ))}
                </div>
              ) : null;
            })()}
          </div>
        </div>
      </div>

      {zoomedUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="放大檢視圖片"
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
          onClick={() => setZoomedUrl(null)}
          data-testid="overlay-image-zoom"
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setZoomedUrl(null); }}
            aria-label="關閉"
            className="absolute top-4 right-4 h-10 w-10 rounded-full bg-white/15 hover:bg-white/25 active:bg-white/30 text-white flex items-center justify-center backdrop-blur-sm transition-colors"
            data-testid="button-close-image-zoom"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={zoomedUrl}
            alt="放大檢視"
            onClick={(e) => e.stopPropagation()}
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl select-none"
            data-testid="img-zoomed"
          />
          <span className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/60 text-xs pointer-events-none">點擊圖片以外區域或右上角關閉</span>
        </div>
      )}
    </>
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
    staleTime: 5 * 60 * 1000,
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

function RadarClockIn({ employee, onPositionUpdate, onResult, todayLatestClock, todayClockIn, todayClockOut, hideCard }: {
  employee: PortalEmployee;
  onPositionUpdate?: (lat: number, lng: number) => void;
  onResult?: (r: ClockInResult) => void;
  todayLatestClock?: { clockType: string; clockTime: string } | null;
  todayClockIn?: { clockTime: string } | null;
  todayClockOut?: { clockTime: string } | null;
  hideCard?: boolean;
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

  const clockContent = (
    <div className={hideCard ? "" : "p-4"}>
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
          const btnH = hideCard ? "h-20" : "h-14";
          const btnHDone = hideCard ? "h-20" : "h-14";

          return (
            <div className="grid grid-cols-2 gap-3">
              {clockInLocked ? (
                <button disabled className={`${btnHDone} rounded-xl bg-emerald-100 border-2 border-emerald-400 text-emerald-700 font-semibold flex flex-col items-center justify-center gap-0.5 cursor-not-allowed`} data-testid="button-clock-in">
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-4 w-4" />
                    <span className={hideCard ? "text-base" : "text-sm"}>上班已打卡</span>
                  </div>
                  {clockInTime && <span className={`font-bold ${hideCard ? "text-lg" : "text-xs"}`}>{clockInTime}</span>}
                </button>
              ) : (
                <button
                  className={`${btnH} rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition-all`}
                  onClick={() => handleClockIn("in")}
                  data-testid="button-clock-in"
                >
                  <span className={hideCard ? "text-lg" : "text-base"}>↑ 上班</span>
                </button>
              )}
              {clockOutLocked ? (
                <button disabled className={`${btnHDone} rounded-xl bg-blue-100 border-2 border-blue-400 text-blue-700 font-semibold flex flex-col items-center justify-center gap-0.5 cursor-not-allowed`} data-testid="button-clock-out">
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-4 w-4" />
                    <span className={hideCard ? "text-base" : "text-sm"}>下班已打卡</span>
                  </div>
                  {clockOutTime && <span className={`font-bold ${hideCard ? "text-lg" : "text-xs"}`}>{clockOutTime}</span>}
                </button>
              ) : (
                <button
                  className={`${btnH} rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition-all`}
                  onClick={() => handleClockIn("out")}
                  data-testid="button-clock-out"
                >
                  <span className={hideCard ? "text-lg" : "text-base"}>↓ 下班</span>
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
  );

  if (hideCard) return clockContent;
  return (
    <div className="border border-juns-border rounded-xl bg-white overflow-hidden" data-testid="card-gps-clock-in">
      <div className="px-4 py-3 border-b border-juns-border flex items-center gap-2">
        <Signal className="h-4 w-4 text-juns-teal" />
        <span className="text-sm font-semibold text-juns-navy">GPS 定位打卡</span>
      </div>
      {clockContent}
    </div>
  );
}

interface ClockAmendmentRecord {
  id: number;
  employeeId: number;
  clockType: string;
  requestedTime: string;
  reason: string;
  isSystemIssue: boolean;
  evidenceImageUrl: string | null;
  status: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
}

interface EligibleDate {
  date: string;
  missingClockType: "in" | "out";
  shiftStartTime: string;
  shiftEndTime: string;
  venueName: string;
  shiftId: number;
  hasExistingAmendment: boolean;
  amendmentStatus: string | null;
}

const AMENDMENT_REASONS = ["漏打卡", "系統異常", "入職開通中", "其他"] as const;
type AmendmentReason = typeof AMENDMENT_REASONS[number];

function ClockAmendmentSection({ employee }: { employee: PortalEmployee }) {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const thisYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [yr, mo] = thisYearMonth.split("-").map(Number);
  const firstDayOfMonth = new Date(yr, mo - 1, 1);
  const daysInMonth = new Date(yr, mo, 0).getDate();
  const startDow = firstDayOfMonth.getDay();

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [clockType, setClockType] = useState<"in" | "out">("in");
  const [requestedTime, setRequestedTime] = useState("09:00");
  const [reason, setReason] = useState<AmendmentReason>("漏打卡");
  const [notes, setNotes] = useState("");
  const [evidencePreview, setEvidencePreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();


  const { data: eligibleDates = [], isLoading: eligibleLoading } = useQuery<EligibleDate[]>({
    queryKey: ["/api/portal/amendment-eligible-dates", employee.id, thisYearMonth],
    queryFn: () => fetch(`/api/portal/amendment-eligible-dates?employeeId=${employee.id}&yearMonth=${thisYearMonth}`, { credentials: "include" }).then(r => r.json()),
    staleTime: 60 * 1000,
  });

  const { data: amendments = [], refetch: refetchAmendments } = useQuery<ClockAmendmentRecord[]>({
    queryKey: ["/api/portal/clock-amendments", employee.id],
  });

  const eligibleMap = new Map<string, EligibleDate[]>();
  for (const e of eligibleDates) {
    if (!eligibleMap.has(e.date)) eligibleMap.set(e.date, []);
    eligibleMap.get(e.date)!.push(e);
  }

  const monthlyUsed = amendments.filter(a => {
    const created = a.createdAt ? new Date(a.createdAt) : null;
    if (!created) return false;
    const ym = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}`;
    return ym === thisYearMonth && a.status !== "rejected" && !a.isSystemIssue;
  }).length;
  const monthlyRemaining = Math.max(0, 3 - monthlyUsed);
  const isSystemIssue = reason === "系統異常";

  const handleDateClick = (dateStr: string) => {
    const entries = eligibleMap.get(dateStr) || [];
    const clickable = entries.filter(e => e.amendmentStatus !== "approved" && e.amendmentStatus !== "pending");
    if (!clickable.length) return;
    const e = clickable.find(ent => ent.missingClockType === "in") || clickable[0];
    setSelectedDate(dateStr);
    setClockType(e.missingClockType);
    setRequestedTime(e.missingClockType === "in" ? e.shiftStartTime.substring(0, 5) : e.shiftEndTime.substring(0, 5));
  };

  const handleClockTypeChange = (type: "in" | "out") => {
    setClockType(type);
    if (selectedDate) {
      const e = (eligibleMap.get(selectedDate) || []).find(ent => ent.missingClockType === type);
      if (e) setRequestedTime(type === "in" ? e.shiftStartTime.substring(0, 5) : e.shiftEndTime.substring(0, 5));
    }
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        try {
          const MAX = 1024;
          let { width, height } = img;
          if (width > MAX || height > MAX) {
            if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
            else { width = Math.round(width * MAX / height); height = MAX; }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("canvas context unavailable");
          ctx.drawImage(img, 0, 0, width, height);
          setEvidencePreview(canvas.toDataURL("image/jpeg", 0.7));
        } catch {
          toast({ title: "圖片處理失敗，請重新選擇", variant: "destructive" });
        }
      };
      img.onerror = () => toast({ title: "圖片讀取失敗，請重新選擇", variant: "destructive" });
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!selectedDate) {
      toast({ title: "請選擇補打卡日期", variant: "destructive" });
      return;
    }
    if (!evidencePreview) {
      toast({ title: "請上傳與主管的同意對話截圖", variant: "destructive" });
      return;
    }
    const selectedEntry = (eligibleMap.get(selectedDate) || []).find(e => e.missingClockType === clockType);
    if (selectedEntry?.amendmentStatus === "pending" || selectedEntry?.amendmentStatus === "approved") {
      toast({ title: "該日期同類型已有申請，無法重複送出", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const fullTime = `${selectedDate}T${requestedTime}:00+08:00`;
      const fullReason = notes.trim() ? `${reason}：${notes.trim()}` : reason;
      await apiRequest("POST", "/api/portal/clock-amendment", {
        employeeId: employee.id,
        clockType,
        requestedTime: fullTime,
        reason: fullReason,
        isSystemIssue,
        evidenceImageUrl: evidencePreview,
        shiftId: selectedEntry?.shiftId ?? null,
      });
      toast({ title: "補打卡申請已送出" });
      setSelectedDate(null);
      setReason("漏打卡");
      setNotes("");
      setEvidencePreview(null);
      refetchAmendments();
      queryClient.invalidateQueries({ queryKey: ["/api/portal/amendment-eligible-dates", employee.id, thisYearMonth] });
    } catch (err: any) {
      toast({ title: err.message || "送出失敗", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const statusLabel = (s: string) => s === "pending" ? "待審核" : s === "approved" ? "已批准" : s === "rejected" ? "已駁回" : s;
  const statusColor = (s: string) => s === "pending" ? "bg-orange-500/10 text-orange-600 border-orange-500/20" : s === "approved" ? "bg-green-500/10 text-green-600 border-green-500/20" : "bg-red-500/10 text-red-600 border-red-500/20";

  const getDayCellStyle = (dateStr: string) => {
    const entries = eligibleMap.get(dateStr) || [];
    const isSelected = selectedDate === dateStr;
    if (!entries.length) return { cls: "text-slate-300 cursor-default", label: null, clickable: false };
    const allApproved = entries.every(e => e.amendmentStatus === "approved");
    if (allApproved) return {
      cls: `bg-green-100 text-green-700 cursor-default${isSelected ? " ring-2 ring-green-400" : ""}`,
      label: "已處理", clickable: false,
    };
    const hasMissingIn = entries.some(e => e.missingClockType === "in" && e.amendmentStatus !== "approved");
    const hasMissingOut = entries.some(e => e.missingClockType === "out" && e.amendmentStatus !== "approved");
    const allPending = entries.filter(e => e.amendmentStatus !== "approved").every(e => e.amendmentStatus === "pending");
    if (allPending) return {
      cls: `bg-slate-100 text-slate-400 cursor-default opacity-70${isSelected ? " ring-2 ring-offset-1 ring-slate-300" : ""}`,
      label: "待審核", clickable: false,
    };
    let cls = hasMissingIn
      ? "bg-amber-100 text-amber-700 border border-amber-300 cursor-pointer hover:bg-amber-200"
      : "bg-blue-100 text-blue-700 border border-blue-300 cursor-pointer hover:bg-blue-200";
    if (isSelected) cls += " ring-2 ring-offset-1 ring-juns-teal";
    const label = hasMissingIn && hasMissingOut ? "上下" : hasMissingIn ? "上班" : "下班";
    return { cls, label, clickable: true };
  };

  return (
    <div className="space-y-4" data-testid="section-clock-amendment">
      {/* Rules notice */}
      <div className="border border-amber-200 rounded-xl bg-amber-50 p-4">
        <p className="text-xs font-semibold text-amber-700 mb-2.5">補打卡申請規範</p>
        <ul className="space-y-1.5 text-xs text-amber-700">
          <li className="flex items-start gap-1.5">
            <span className="shrink-0 font-bold text-amber-500 mt-0.5">①</span>
            <span>每月上限 <strong>3 次</strong>（本月剩餘 <strong className={monthlyRemaining === 0 ? "text-red-600" : ""}>{monthlyRemaining}</strong> 次）</span>
          </li>
          <li className="flex items-start gap-1.5">
            <span className="shrink-0 font-bold text-amber-500 mt-0.5">②</span>
            <span>必須附上與主管的<strong>同意對話截圖</strong>，否則無法送出</span>
          </li>
          <li className="flex items-start gap-1.5">
            <span className="shrink-0 font-bold text-amber-500 mt-0.5">③</span>
            <span>選「系統異常」者<strong>不列入次數額度</strong>，仍須主管確認截圖</span>
          </li>
        </ul>
      </div>

      {/* Calendar */}
      <div className="border border-juns-border rounded-xl bg-white overflow-hidden" data-testid="calendar-amendment">
        <div className="px-4 py-3 border-b border-juns-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-juns-teal" />
            <span className="text-sm font-semibold text-juns-navy">
              {now.getFullYear()} 年 {now.getMonth() + 1} 月 — 選擇補卡日
            </span>
          </div>
          {eligibleLoading && <Loader2 className="h-4 w-4 text-slate-400 animate-spin" />}
        </div>
        <div className="p-3">
          <div className="grid grid-cols-7 mb-1.5">
            {["日","一","二","三","四","五","六"].map(d => (
              <div key={d} className="text-center text-[11px] font-medium text-slate-400 py-1">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {Array.from({ length: startDow }).map((_, i) => (
              <div key={`pad-${i}`} />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const dayNum = i + 1;
              const dateStr = `${thisYearMonth}-${String(dayNum).padStart(2, "0")}`;
              const { cls, label, clickable } = getDayCellStyle(dateStr);
              return (
                <button
                  key={dateStr}
                  onClick={() => clickable && handleDateClick(dateStr)}
                  disabled={!clickable}
                  className={`rounded-lg p-1 flex flex-col items-center min-h-[3rem] transition-all disabled:cursor-default ${cls}`}
                  data-testid={`cell-day-${dayNum}`}
                >
                  <span className="text-[13px] font-semibold leading-tight">{dayNum}</span>
                  {label && <span className="text-[9px] leading-tight mt-0.5">{label}</span>}
                </button>
              );
            })}
          </div>
        </div>
        <div className="px-3 pb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-100 border border-amber-300 inline-block" />缺上班打卡</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-100 border border-blue-300 inline-block" />缺下班打卡</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-100 inline-block" />已處理</span>
        </div>
        {eligibleDates.length === 0 && !eligibleLoading && (
          <div className="px-4 pb-4 text-center text-xs text-slate-400">本月無缺打卡異常記錄</div>
        )}
      </div>

      {/* Form — shown after date selection */}
      {selectedDate && (
        <div className="border border-juns-border rounded-xl bg-white overflow-hidden" data-testid="card-amendment-form">
          <div className="px-4 py-3 border-b border-juns-border flex items-center gap-2">
            <FileEdit className="h-4 w-4 text-juns-teal" />
            <span className="text-sm font-semibold text-juns-navy">
              {selectedDate.replace(/^\d{4}-(\d{2})-(\d{2})$/, "$1/$2")} 補打卡申請
            </span>
          </div>
          <div className="p-4 space-y-4">
            {monthlyRemaining === 0 && !isSystemIssue && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-100">
                <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-xs text-red-600">本月額度已用完。如為系統問題，請在下方原因選「系統異常」後送出（不佔額度）。</p>
              </div>
            )}

            {/* Clock type toggle — show only options that are missing */}
            <div>
              <p className="text-xs font-medium text-slate-500 mb-1.5">補卡類型</p>
              <div className="flex gap-2">
                {(eligibleMap.get(selectedDate) || [])
                  .filter(e => e.amendmentStatus !== "approved")
                  .map(e => {
                    const isPending = e.amendmentStatus === "pending";
                    return (
                      <button
                        key={e.missingClockType}
                        onClick={() => !isPending && handleClockTypeChange(e.missingClockType)}
                        disabled={isPending}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                          isPending
                            ? "bg-slate-100 text-slate-400 cursor-not-allowed opacity-60"
                            : clockType === e.missingClockType
                              ? "bg-juns-teal text-white"
                              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                        data-testid={`button-amendment-type-${e.missingClockType}`}
                      >
                        {e.missingClockType === "in" ? "補打上班" : "補打下班"}
                        {isPending && <span className="ml-1 text-[10px]">（待審核）</span>}
                      </button>
                    );
                  })}
              </div>
            </div>

            {/* Time */}
            <div>
              <p className="text-xs font-medium text-slate-500 mb-1.5">補卡時間（可調整）</p>
              <input
                type="time"
                value={requestedTime}
                onChange={(e) => setRequestedTime(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-base font-medium bg-white"
                data-testid="input-amendment-time"
              />
            </div>

            {/* Reason dropdown */}
            <div>
              <p className="text-xs font-medium text-slate-500 mb-1.5">補卡原因</p>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value as AmendmentReason)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-medium bg-white"
                data-testid="select-amendment-reason"
              >
                {AMENDMENT_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              {isSystemIssue && (
                <p className="text-[11px] text-blue-600 mt-1">✓ 系統異常不列入每月 3 次額度</p>
              )}
            </div>

            {/* Notes */}
            <div>
              <p className="text-xs font-medium text-slate-500 mb-1.5">備註說明<span className="text-slate-400">（選填）</span></p>
              <textarea
                placeholder="可補充說明詳情..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white resize-none"
                data-testid="input-amendment-notes"
              />
            </div>

            {/* Screenshot required */}
            <div>
              <p className="text-xs font-medium text-slate-500 mb-1.5">
                主管同意截圖 <span className="text-red-500 font-semibold">*必填</span>
              </p>
              {!evidencePreview ? (
                <label className="flex items-center justify-center gap-2 border-2 border-dashed border-slate-200 rounded-xl py-4 cursor-pointer hover:border-juns-teal hover:bg-slate-50 transition-colors" data-testid="label-upload-evidence">
                  <Camera className="h-5 w-5 text-slate-400" />
                  <span className="text-sm text-slate-500">點此上傳截圖</span>
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} data-testid="input-amendment-evidence" />
                </label>
              ) : (
                <div className="relative inline-block">
                  <img src={evidencePreview} className="h-28 w-auto rounded-lg border border-slate-200 object-cover" alt="截圖預覽" />
                  <button className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full p-0.5" onClick={() => setEvidencePreview(null)} data-testid="button-remove-evidence">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              {!evidencePreview && (
                <p className="text-[11px] text-red-500 mt-1">請上傳與主管的同意對話截圖，否則無法送出</p>
              )}
            </div>

            <button
              onClick={handleSubmit}
              disabled={submitting || !evidencePreview || (monthlyRemaining === 0 && !isSystemIssue)}
              className="w-full py-3 bg-juns-navy text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-juns-navy/90 active:scale-[0.99] transition-all"
              data-testid="button-submit-amendment"
            >
              {submitting ? "送出中..." : "送出補打卡申請"}
            </button>
            <button
              className="w-full py-2 border border-slate-200 rounded-xl text-sm text-slate-500 hover:bg-slate-50 transition-colors"
              onClick={() => setSelectedDate(null)}
              data-testid="button-cancel-amendment"
            >
              取消選擇
            </button>
          </div>
        </div>
      )}

      {/* Records list */}
      {amendments.length > 0 && (
        <div className="border border-juns-border rounded-xl bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-juns-border">
            <span className="text-sm font-semibold text-juns-navy">申請記錄</span>
          </div>
          <div className="divide-y divide-juns-border">
            {amendments.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(a => (
              <div key={a.id} className="px-4 py-3 flex items-start gap-3" data-testid={`row-amendment-${a.id}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 mb-1">
                    <Badge className={statusColor(a.status)} data-testid={`badge-status-${a.id}`}>{statusLabel(a.status)}</Badge>
                    <Badge variant="outline" className="text-xs">{a.clockType === "in" ? "上班" : "下班"}</Badge>
                    {a.isSystemIssue && <Badge variant="outline" className="text-xs text-blue-600 border-blue-300">系統異常</Badge>}
                  </div>
                  <p className="text-sm text-juns-navy">
                    {new Date(a.requestedTime).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">{a.reason}</p>
                  {a.reviewedByName && a.reviewedAt && (
                    <p className="text-xs text-slate-400 mt-0.5">
                      審核：{a.reviewedByName} | {new Date(a.reviewedAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  )}
                  {a.reviewNote && <p className="text-xs text-slate-400 mt-0.5">備註：{a.reviewNote}</p>}
                </div>
              </div>
            ))}
          </div>
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
  evidenceImageUrl: string | null;
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
  const [evidencePreview, setEvidencePreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const { data: requests = [], refetch } = useQuery<OvertimeRequestRecord[]>({
    queryKey: ["/api/portal/overtime-requests", employee.id],
    enabled: expanded,
  });

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        try {
          const MAX = 1024;
          let { width, height } = img;
          if (width > MAX || height > MAX) {
            if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
            else { width = Math.round(width * MAX / height); height = MAX; }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("canvas context unavailable");
          ctx.drawImage(img, 0, 0, width, height);
          setEvidencePreview(canvas.toDataURL("image/jpeg", 0.7));
        } catch {
          toast({ title: "圖片處理失敗，請重新選擇", variant: "destructive" });
        }
      };
      img.onerror = () => toast({ title: "圖片讀取失敗，請重新選擇", variant: "destructive" });
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

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
        evidenceImageUrl: evidencePreview || null,
      });
      toast({ title: "加班申請已送出" });
      setReason("");
      setEvidencePreview(null);
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
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-base font-medium bg-white"
              data-testid="input-overtime-date"
            />
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs text-slate-500 mb-1 block">開始時間</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-base font-medium bg-white"
                  data-testid="input-overtime-start"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs text-slate-500 mb-1 block">結束時間</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-base font-medium bg-white"
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
            <div>
              <p className="text-xs text-slate-500 mb-1.5">附上與主管的同意對話截圖（選填）</p>
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-600 hover:bg-slate-100 cursor-pointer active:scale-[0.98] transition-all">
                <Camera className="h-3.5 w-3.5" />
                上傳截圖
                <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} data-testid="input-overtime-evidence" />
              </label>
              {evidencePreview && (
                <div className="mt-2 relative inline-block">
                  <img src={evidencePreview} className="h-20 w-auto rounded-lg border border-slate-200 object-cover" alt="截圖預覽" />
                  <button
                    className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full p-0.5"
                    onClick={() => setEvidencePreview(null)}
                    data-testid="button-remove-overtime-evidence"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
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

const LEAVE_TYPES = ["休假", "特休", "病假", "事假", "喪假", "公假", "生理假", "國定假"] as const;
const CERTIFICATE_REQUIRED = ["病假", "生理假"];

const STATUS_LABEL: Record<string, string> = {
  pending: "審核中",
  approved: "已核准",
  rejected: "已拒絕",
};
const STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
};

interface LeaveRequestRecord {
  id: number;
  employeeId: number;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  certificateImageUrl: string | null;
  status: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
}

function LeaveRequestSection({ employee }: { employee: PortalEmployee }) {
  const [expanded, setExpanded] = useState(false);
  const todayStr = (() => {
    const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const [leaveType, setLeaveType] = useState<string>("特休");
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(todayStr);
  const [reason, setReason] = useState("");
  const [certPreview, setCertPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const { data: requests = [], refetch } = useQuery<LeaveRequestRecord[]>({
    queryKey: ["/api/portal/leave-requests", employee.id],
    queryFn: async () => {
      const res = await fetch(`/api/portal/leave-requests/${employee.id}`);
      if (!res.ok) throw new Error("載入失敗");
      return res.json();
    },
  });

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        try {
          const MAX = 1024;
          let { width, height } = img;
          if (width > MAX || height > MAX) {
            if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
            else { width = Math.round(width * MAX / height); height = MAX; }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("canvas context unavailable");
          ctx.drawImage(img, 0, 0, width, height);
          setCertPreview(canvas.toDataURL("image/jpeg", 0.7));
        } catch {
          toast({ title: "圖片處理失敗，請重新選擇", variant: "destructive" });
        }
      };
      img.onerror = () => toast({ title: "圖片讀取失敗，請重新選擇", variant: "destructive" });
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (startDate > endDate) {
      toast({ title: "結束日期必須在開始日期之後", variant: "destructive" });
      return;
    }
    if (CERTIFICATE_REQUIRED.includes(leaveType) && !certPreview) {
      toast({ title: `${leaveType}請附上證明文件照片`, variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest("POST", "/api/portal/leave-request", {
        employeeId: employee.id,
        leaveType,
        startDate,
        endDate,
        reason: reason.trim() || null,
        certificateImageUrl: certPreview || null,
      });
      toast({ title: "請假申請已送出" });
      setReason("");
      setCertPreview(null);
      setLeaveType("特休");
      setStartDate(todayStr);
      setEndDate(todayStr);
      refetch();
    } catch (err: any) {
      toast({ title: err.message || "送出失敗", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const needsCert = CERTIFICATE_REQUIRED.includes(leaveType);

  return (
    <div className="space-y-4">
      {/* Submit form */}
      <div className="border border-juns-border rounded-xl bg-white overflow-hidden">
        <button
          className="w-full px-4 py-3 flex items-center justify-between"
          onClick={() => setExpanded((v) => !v)}
          data-testid="button-toggle-leave-form"
        >
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-juns-teal" />
            <span className="text-sm font-semibold text-juns-navy">新增請假申請</span>
          </div>
          <ChevronRight className={`h-4 w-4 text-slate-400 transition-transform ${expanded ? "rotate-90" : ""}`} />
        </button>

        {expanded && (
          <div className="px-4 pb-4 border-t border-juns-border space-y-3 pt-3">
            {/* Leave type */}
            <div>
              <label className="text-xs text-slate-500 mb-1 block">假別</label>
              <Select value={leaveType} onValueChange={setLeaveType}>
                <SelectTrigger className="h-9 text-sm" data-testid="select-leave-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEAVE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}{CERTIFICATE_REQUIRED.includes(t) ? " *需附證明" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">開始日期</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full h-9 border border-slate-200 rounded-md px-2 text-sm text-juns-navy"
                  data-testid="input-leave-start"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">結束日期</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full h-9 border border-slate-200 rounded-md px-2 text-sm text-juns-navy"
                  data-testid="input-leave-end"
                />
              </div>
            </div>

            {/* Reason */}
            <div>
              <label className="text-xs text-slate-500 mb-1 block">原因（選填）</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="請輸入請假原因..."
                rows={2}
                className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm text-juns-navy resize-none"
                data-testid="textarea-leave-reason"
              />
            </div>

            {/* Certificate photo */}
            <div>
              <label className="text-xs text-slate-500 mb-1 block">
                證明文件{needsCert ? <span className="text-red-500 ml-1">*必填</span> : "（選填）"}
              </label>
              {certPreview ? (
                <div className="relative inline-block">
                  <img src={certPreview} alt="證明文件" className="h-24 w-auto rounded-lg border" />
                  <button
                    onClick={() => setCertPreview(null)}
                    className="absolute -top-1.5 -right-1.5 bg-white rounded-full shadow p-0.5"
                    data-testid="button-remove-cert"
                  >
                    <X className="h-3.5 w-3.5 text-slate-500" />
                  </button>
                </div>
              ) : (
                <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50 w-fit" data-testid="label-upload-cert">
                  <Camera className="h-4 w-4 text-slate-400" />
                  <span className="text-sm text-slate-500">上傳照片</span>
                  <input type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
                </label>
              )}
            </div>

            <Button
              className="w-full"
              onClick={handleSubmit}
              disabled={submitting}
              data-testid="button-submit-leave"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              送出申請
            </Button>
          </div>
        )}
      </div>

      {/* History */}
      <div className="border border-juns-border rounded-xl bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-juns-border flex items-center gap-2">
          <FileText className="h-4 w-4 text-juns-teal" />
          <span className="text-sm font-semibold text-juns-navy">請假紀錄</span>
        </div>
        {requests.length === 0 ? (
          <p className="text-sm text-center text-slate-400 py-4">尚無請假紀錄</p>
        ) : (
          <div className="divide-y divide-juns-border">
            {requests.map((r) => (
              <div key={r.id} className="px-4 py-3 space-y-1" data-testid={`card-leave-${r.id}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-juns-navy">{r.leaveType}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[r.status] || "bg-slate-100 text-slate-600"}`}>
                    {STATUS_LABEL[r.status] || r.status}
                  </span>
                </div>
                <p className="text-xs text-slate-500">{r.startDate} ～ {r.endDate}</p>
                {r.reason && <p className="text-xs text-slate-400">{r.reason}</p>}
                {r.reviewNote && (
                  <p className="text-xs text-slate-500 bg-slate-50 rounded px-2 py-1">審核備註：{r.reviewNote}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HomeView({
  employee, attendance, attendanceLoading, todayShifts, userPos, clockInResult, setClockInResult, setUserPos,
}: {
  employee: PortalEmployee;
  attendance: AttendanceSummary | undefined;
  attendanceLoading: boolean;
  todayShifts: PortalShift[];
  userPos: { lat: number; lng: number } | null;
  clockInResult: ClockInResult | null;
  setClockInResult: (r: ClockInResult | null) => void;
  setUserPos: (pos: { lat: number; lng: number }) => void;
}) {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const dateStr = format(time, "yyyy年M月d日（EEE）", { locale: zhTW });
  const timeHM = time.toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false });
  const timeSS = time.toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", second: "2-digit", hour12: false }).slice(-2);

  const todayVenueShortName = todayShifts[0]?.venue?.shortName;
  const todayShiftDisplay = todayShifts.length > 0
    ? `${todayShifts[0].startTime.slice(0, 5)} ~ ${todayShifts[0].endTime.slice(0, 5)}`
    : null;

  const todayClockIn = attendance?.todayClockIn;
  const todayClockOut = attendance?.todayClockOut;
  const todayClockInStr = todayClockIn?.clockTime
    ? new Date(todayClockIn.clockTime).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false })
    : null;
  const todayClockOutStr = todayClockOut?.clockTime
    ? new Date(todayClockOut.clockTime).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false })
    : null;

  return (
    <div className="max-w-lg mx-auto">
      <div className="flex justify-center pt-5 pb-2">
        <div className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-white border border-juns-border shadow-sm" data-testid="pill-venue-location">
          <MapPin className="h-3.5 w-3.5 text-juns-teal" />
          <span className="text-sm text-juns-navy font-medium">{todayVenueShortName || "尚未定位"}</span>
        </div>
      </div>

      <div className="text-center py-4 px-4">
        <p className="text-sm text-slate-400 mb-1" data-testid="text-today-date">{dateStr}</p>
        <div className="flex items-baseline justify-center gap-1">
          <span className="text-6xl font-bold text-juns-navy font-mono tracking-tight" data-testid="text-live-clock">{timeHM}</span>
          <span className="text-2xl font-bold text-slate-300 font-mono tracking-tight">{timeSS}</span>
        </div>
        <div className="mt-2 flex items-center justify-center gap-1.5">
          {todayShiftDisplay ? (
            <>
              <div className="w-1.5 h-1.5 rounded-full bg-juns-teal animate-pulse" />
              <span className="text-sm text-slate-500" data-testid="text-today-shift">今日班次 {todayShiftDisplay}</span>
            </>
          ) : (
            <span className="text-sm text-slate-400">今日無排班</span>
          )}
        </div>
      </div>

      <div className="px-4 mb-3">
        <LocationMap lat={userPos?.lat ?? null} lng={userPos?.lng ?? null} />
      </div>

      <div className="px-4 mb-4">
        <RadarClockIn
          employee={employee}
          hideCard
          onPositionUpdate={(lat, lng) => setUserPos({ lat, lng })}
          onResult={(result) => {
            setClockInResult(result);
            if (result.status === "success" || result.status === "warning") {
              queryClient.invalidateQueries({ queryKey: ["/api/portal/my-attendance", employee.id] });
              queryClient.invalidateQueries({ queryKey: ["/api/portal/today-coworkers", employee.id] });
            }
          }}
          todayLatestClock={attendance?.todayLatestClock}
          todayClockIn={todayClockIn}
          todayClockOut={todayClockOut}
        />
      </div>

      <div className="px-4 pb-4">
        <div className="border border-juns-border rounded-xl bg-white overflow-hidden" data-testid="card-today-attendance">
          <div className="px-4 py-2.5 border-b border-juns-border flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-juns-teal" />
            <span className="text-sm font-semibold text-juns-navy">今日出勤狀況</span>
          </div>
          <div className="grid grid-cols-2 divide-x divide-juns-border">
            <div className="px-4 py-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-xs text-slate-400">上班打卡</span>
              </div>
              {attendanceLoading ? (
                <div className="h-5 bg-slate-100 rounded animate-pulse mx-auto w-16" />
              ) : todayClockInStr ? (
                <span className="text-base font-bold font-mono text-emerald-700" data-testid="text-today-clock-in">{todayClockInStr}</span>
              ) : (
                <span className="text-sm text-slate-300 italic">未打卡</span>
              )}
            </div>
            <div className="px-4 py-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
                <span className="text-xs text-slate-400">下班打卡</span>
              </div>
              {attendanceLoading ? (
                <div className="h-5 bg-slate-100 rounded animate-pulse mx-auto w-16" />
              ) : todayClockOutStr ? (
                <span className="text-base font-bold font-mono text-blue-700" data-testid="text-today-clock-out">{todayClockOutStr}</span>
              ) : (
                <span className="text-sm text-slate-300 italic">未打卡</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PortalMain({ employee }: { employee: PortalEmployee }) {
  const [activeView, setActiveView] = useState<PortalView>("home");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"calendar" | "list">("calendar");
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDateStr, setSelectedDateStr] = useState<string | null>(null);
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  const [clockInResult, setClockInResult] = useState<ClockInResult | null>(null);
  const [certShiftId, setCertShiftId] = useState<number | null>(null);
  const [certPreviewShiftId, setCertPreviewShiftId] = useState<number | null>(null);

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

  const portalLineUserId = employee.lineUserId || (typeof window !== "undefined" ? localStorage.getItem("portal_line_user_id") : null) || "";
  const { data: todayCoworkers = [], isLoading: coworkersLoading } = useQuery<CoworkerGroup[]>({
    queryKey: ["/api/portal/today-coworkers", employee.id],
    enabled: !!employee?.id && !!portalLineUserId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const res = await fetch(`/api/portal/today-coworkers/${employee.id}`, {
        headers: { "x-line-user-id": portalLineUserId },
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
  });

  const { data: attendance, isLoading: attendanceLoading } = useQuery<AttendanceSummary>({
    queryKey: ["/api/portal/my-attendance", employee.id],
    enabled: !!employee?.id,
    staleTime: 60 * 1000,
  });

  const { data: guidelinesData } = useQuery<{ items: GuidelineItem[]; allAcknowledged: boolean }>({
    queryKey: ["/api/portal/guidelines-check", employee.id],
    enabled: activeView === "guidelines" && !!employee?.id,
    staleTime: 60 * 1000,
  });

  const { data: amendments = [] } = useQuery<ClockAmendmentRecord[]>({
    queryKey: ["/api/portal/clock-amendments", employee.id],
    staleTime: 30 * 1000,
  });

  const [expandedAnnouncementId, setExpandedAnnouncementId] = useState<number | null>(null);
  const { data: activeAnnouncements = [] } = useQuery<AnnouncementItem[]>({
    queryKey: ["/api/announcements/active"],
    staleTime: 5 * 60 * 1000,
  });

  const uploadCertMutation = useMutation({
    mutationFn: async ({ shiftId, imageUrl }: { shiftId: number; imageUrl: string | null }) => {
      const res = await apiRequest("PATCH", `/api/portal/shifts/${shiftId}/certificate`, {
        employeeId: employee.id,
        certificateImageUrl: imageUrl,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/my-shifts", employee.id, monthStart, monthEnd] });
      setCertShiftId(null);
    },
  });

  const amendmentRemaining = useMemo(() => {
    const now = new Date();
    const thisYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const usedThisMonth = amendments.filter((a) => {
      if (a.isSystemIssue) return false;
      if (a.status === "rejected") return false;
      const created = a.createdAt ? new Date(a.createdAt) : null;
      if (!created) return false;
      const ym = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}`;
      return ym === thisYearMonth;
    }).length;
    return Math.max(0, 3 - usedThisMonth);
  }, [amendments]);

  const shiftsByDate = useMemo(() => {
    const map = new Map<string, PortalShift[]>();
    myShifts.forEach((s) => {
      const key = s.date;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    });
    return map;
  }, [myShifts]);

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const todayShifts = shiftsByDate.get(todayStr) || [];

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

  function handleLogout() {
    localStorage.removeItem("portal_employee");
    localStorage.removeItem("portal_line_user_id");
    window.location.reload();
  }

  function handleNavigate(view: PortalView) {
    setActiveView(view);
    setDrawerOpen(false);
  }

  const headerTitle = VIEW_TITLES[activeView];

  return (
    <div className="min-h-screen bg-juns-surface">
      <JunsHeader employee={employee} pageTitle={headerTitle} onMenuOpen={() => setDrawerOpen(true)} />
      <Watermark name={employee.name} code={employee.employeeCode} />

      {drawerOpen && (
        <SideMenuDrawer
          employee={employee}
          activeView={activeView}
          amendmentRemaining={amendmentRemaining}
          onNavigate={handleNavigate}
          onClose={() => setDrawerOpen(false)}
          onLogout={handleLogout}
        />
      )}

      {activeView === "home" && (
        <HomeView
          employee={employee}
          attendance={attendance}
          attendanceLoading={attendanceLoading}
          todayShifts={todayShifts}
          userPos={userPos}
          clockInResult={clockInResult}
          setClockInResult={setClockInResult}
          setUserPos={setUserPos}
        />
      )}

      {activeView === "outing" && (
        <div className="max-w-lg mx-auto p-4 pt-6">
          <div className="border border-juns-border rounded-xl bg-white overflow-hidden">
            <div className="px-4 py-10 flex flex-col items-center gap-3 text-center">
              <Navigation className="h-10 w-10 text-slate-300" />
              <p className="text-sm font-semibold text-slate-500">外出/簽到功能即將推出</p>
              <p className="text-xs text-slate-400">此功能尚未開放，敬請期待</p>
            </div>
          </div>
        </div>
      )}

      {activeView === "attendance" && (
        <div className="max-w-lg mx-auto p-4 pb-8">
          <div className="border border-juns-border rounded-xl bg-white overflow-hidden" data-testid="card-attendance-summary">
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
        </div>
      )}

      {activeView === "schedule" && (
        <div className="max-w-lg mx-auto p-4 pb-8">
        {activeAnnouncements.length > 0 && (
          <div className="space-y-2 mb-3">
            {activeAnnouncements.map((ann) => (
              <div
                key={ann.id}
                className="bg-blue-50 border border-blue-100 rounded-lg p-3 cursor-pointer"
                onClick={() => setExpandedAnnouncementId(expandedAnnouncementId === ann.id ? null : ann.id)}
                data-testid={`announcement-card-${ann.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-blue-800">{ann.title}</p>
                    {expandedAnnouncementId === ann.id && (
                      <p className="text-xs text-blue-700 mt-1 leading-relaxed whitespace-pre-wrap">{ann.content}</p>
                    )}
                  </div>
                  <span className="text-xs text-blue-400 shrink-0">
                    {format(parseISO(ann.publishedAt), "M/d")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
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
                    if (!day) return <div key={`pad-${idx}`} className="min-h-[64px]" />;
                    const dateStr = format(day, "yyyy-MM-dd");
                    const dayShifts = shiftsByDate.get(dateStr) || [];
                    const today = isToday(day);
                    const isSelected = selectedDateStr === dateStr;
                    const isWeekend = getDay(day) === 0 || getDay(day) === 6;
                    return (
                      <div
                        key={dateStr}
                        className={`min-h-[64px] p-0.5 rounded-md border transition-colors ${
                          today
                            ? "border-juns-teal bg-juns-teal/5"
                            : isSelected
                              ? "border-juns-teal/50 bg-sky-50"
                              : dayShifts.length > 0
                                ? "border-slate-200 bg-white cursor-pointer active:bg-slate-50"
                                : "border-slate-100"
                        }`}
                        onClick={() => {
                          if (dayShifts.length > 0) setSelectedDateStr(isSelected ? null : dateStr);
                        }}
                        data-testid={`cell-day-${dateStr}`}
                      >
                        <div className={`text-[11px] text-center font-medium mb-0.5 ${
                          today ? "font-bold text-juns-teal" :
                          isWeekend ? "text-red-400" : "text-slate-400"
                        }`}>
                          {format(day, "d")}
                        </div>
                        {dayShifts.map((s, i) => {
                          const rd = getRoleDisplay(s.assignedRole);
                          const roleAbbrev = ROLE_SHORT[s.assignedRole || ""] || "班";
                          const isLeave = s.startTime.slice(0, 5) === "00:00" && s.endTime.slice(0, 5) === "00:00";
                          return (
                            <div key={i} className={`mb-0.5 rounded text-center py-0.5 px-0.5 ${rd.bgClass}`}>
                              <div className={`text-[10px] font-bold leading-tight ${rd.textClass}`}>{roleAbbrev}</div>
                              {!isLeave && (
                                <div className="text-[8px] text-slate-400 font-mono leading-tight">
                                  {s.startTime.slice(0, 5)}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>

                {/* 點擊日期後展開當日詳情 */}
                {selectedDateStr && (shiftsByDate.get(selectedDateStr) || []).length > 0 && (
                  <div className="mt-3 rounded-xl border border-juns-teal/20 bg-white overflow-hidden">
                    <div className="px-3 py-2 bg-juns-teal/5 border-b border-juns-teal/10 flex items-center justify-between">
                      <span className="text-sm font-semibold text-juns-navy">
                        {format(parseISO(selectedDateStr), "M月d日 (E)", { locale: zhTW })} 班次詳情
                      </span>
                      <button
                        onClick={() => setSelectedDateStr(null)}
                        className="p-1 rounded-md hover:bg-slate-100 transition-colors"
                        data-testid="button-close-day-detail"
                      >
                        <X className="h-3.5 w-3.5 text-slate-400" />
                      </button>
                    </div>
                    {(shiftsByDate.get(selectedDateStr) || []).map(s => {
                      const rd = getRoleDisplay(s.assignedRole);
                      const isLeave = s.startTime.slice(0, 5) === "00:00" && s.endTime.slice(0, 5) === "00:00";
                      return (
                        <div key={s.id} className="px-3 py-2.5 flex items-center gap-3 border-b border-slate-50 last:border-0">
                          <div className="w-1.5 h-10 rounded-full shrink-0" style={{ backgroundColor: rd.color }} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold text-juns-navy">
                                {isLeave ? (s.assignedRole || "休假") : (s.venue?.shortName || "未知場館")}
                              </span>
                              {!isLeave && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${rd.badgeBg}`}>
                                  {s.assignedRole}
                                </span>
                              )}
                              {s.isDispatch && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-medium">派遣</span>
                              )}
                            </div>
                            {!isLeave && (
                              <div className="text-xs text-slate-400 font-mono mt-0.5">
                                {s.startTime.slice(0, 5)} – {s.endTime.slice(0, 5)}
                              </div>
                            )}
                            {s.notes && (
                              <div className="text-xs text-slate-500 mt-0.5 truncate">{s.notes}</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
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
                      const hasCert = !!s.certificateImageUrl;
                      return (
                        <div key={s.id} className="space-y-1">
                          <div
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
                            {!s._isDispatchRecord && hasCert ? (
                              <button
                                type="button"
                                className="shrink-0 h-8 w-8 rounded-md overflow-hidden border border-juns-border"
                                onClick={() => setCertPreviewShiftId(certPreviewShiftId === s.id ? null : s.id)}
                                data-testid={`button-view-cert-${s.id}`}
                                title="查看證明文件"
                              >
                                <img src={s.certificateImageUrl!} alt="證明" className="h-full w-full object-cover" />
                              </button>
                            ) : !s._isDispatchRecord ? (
                              <label
                                className="shrink-0 h-8 w-8 rounded-md border border-dashed border-slate-300 flex items-center justify-center cursor-pointer hover:bg-slate-50 transition-colors"
                                title="上傳證明文件"
                                data-testid={`label-upload-cert-${s.id}`}
                              >
                                <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  const img = new Image();
                                  const url = URL.createObjectURL(file);
                                  img.onload = () => {
                                    const MAX = 1024;
                                    const scale = Math.min(1, MAX / Math.max(img.width, img.height));
                                    const canvas = document.createElement("canvas");
                                    canvas.width = img.width * scale;
                                    canvas.height = img.height * scale;
                                    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
                                    uploadCertMutation.mutate({ shiftId: s.id, imageUrl: canvas.toDataURL("image/jpeg", 0.7) });
                                    URL.revokeObjectURL(url);
                                  };
                                  img.src = url;
                                  e.target.value = "";
                                }} />
                                <span className="text-slate-400 text-base leading-none">📎</span>
                              </label>
                            ) : null}
                          </div>
                          {certPreviewShiftId === s.id && hasCert && (
                            <div className="px-3 pb-1">
                              <div className="relative rounded-lg border border-juns-border overflow-hidden bg-slate-50">
                                <img src={s.certificateImageUrl!} alt="證明文件" className="w-full max-h-48 object-contain" />
                                <button
                                  type="button"
                                  className="absolute top-1 right-1 h-6 w-6 rounded-full bg-red-500 text-white text-xs flex items-center justify-center hover:bg-red-600 transition-colors"
                                  onClick={() => uploadCertMutation.mutate({ shiftId: s.id, imageUrl: null })}
                                  data-testid={`button-remove-cert-${s.id}`}
                                  title="移除證明文件"
                                >✕</button>
                              </div>
                            </div>
                          )}
                          {s.notes && (
                            <div className="mx-3 mb-1 pt-2 pb-2 border-t border-blue-100 flex items-start gap-1.5" data-testid={`shift-notes-${s.id}`}>
                              <span className="text-blue-400 text-xs mt-0.5">📋</span>
                              <p className="text-xs text-blue-700 leading-relaxed">{s.notes}</p>
                            </div>
                          )}
                        </div>
                      );
                    })
                )}
              </div>
            )}
          </div>
        </div>
        </div>
      )}

      {activeView === "coworkers" && (
        <div className="max-w-lg mx-auto p-4 pb-8">
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
                                        {cw.isDispatch && (
                                          <span className="text-[10px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-600 shrink-0">派遣</span>
                                        )}
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
        </div>
      )}

      {activeView === "amendment" && (
        <div className="max-w-lg mx-auto p-4 pb-8">
          <ClockAmendmentSection employee={employee} />
        </div>
      )}

      {activeView === "overtime" && (
        <div className="max-w-lg mx-auto p-4 pb-8">
          <OvertimeRequestSection employee={employee} />
        </div>
      )}

      {activeView === "leave" && (
        <div className="max-w-lg mx-auto p-4 pb-8">
          <LeaveRequestSection employee={employee} />
        </div>
      )}

      {activeView === "guidelines" && (
        <div className="max-w-lg mx-auto p-4 pb-8">
        <div className="border border-juns-border rounded-xl bg-white overflow-hidden" data-testid="card-guidelines-review">
          <div className="px-4 py-3 border-b border-juns-border flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-juns-teal" />
            <span className="text-sm font-semibold text-juns-navy">員工守則</span>
          </div>
          <div className="p-4 space-y-2">
            {!guidelinesData ? (
              <div className="h-24 bg-slate-100 rounded-lg animate-pulse" />
            ) : guidelinesData.items.length === 0 ? (
              <p className="text-sm text-center text-slate-400 py-3">目前沒有守則</p>
            ) : (
              guidelinesData.items.map((item) => (
                <GuidelineItemCard key={item.id} item={item} employeeId={employee?.id} />
              ))
            )}
          </div>
        </div>
        </div>
      )}
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

/** Returns true only when running inside LINE's in-app browser (mobile or desktop). */
function isLineInAppBrowser(): boolean {
  const ua = navigator.userAgent;
  // LINE's in-app browser always includes "Line/" in the UA string.
  // LIFF SDK also sets this flag when the page is opened inside LINE.
  return /Line\//i.test(ua);
}

export default function PortalPage() {
  if (!isLineInAppBrowser() && !import.meta.env.DEV) {
    return <NotLineBrowser />;
  }
  return <PortalPageInner />;
}
