import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MapPin, CheckCircle2, AlertTriangle, XCircle, Loader2, Navigation, Radar } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import junsLogo from "@assets/logo_(1)_1771907823260.jpg";

const LIFF_ID = import.meta.env.VITE_LIFF_ID || "";
const LINE_CHANNEL_ID = import.meta.env.VITE_LINE_CHANNEL_ID || "";

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
  nearbyVenues?: Array<{ name: string; distance: number; radius: number; inRange: boolean }>;
}

interface UserIdentity {
  mode: "liff" | "line-login";
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  employeeId?: number;
  employeeName?: string;
}

type Stage = "init" | "login" | "ready" | "locating" | "submitting" | "done" | "error";

export default function LiffClockInPage() {
  const { toast } = useToast();
  const [stage, setStage] = useState<Stage>("init");
  const [user, setUser] = useState<UserIdentity | null>(null);
  const [result, setResult] = useState<ClockInResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [accuracy, setAccuracy] = useState<number | null>(null);

  useEffect(() => {
    if (LIFF_ID) {
      initLiff();
    } else if (LINE_CHANNEL_ID) {
      initLineLogin();
    } else {
      setErrorMsg("尚未設定 LINE 登入，請聯繫管理員。");
      setStage("error");
    }
  }, []);

  async function initLiff() {
    try {
      const liffModule = await import("@line/liff");
      const liffInstance = liffModule.default;
      await liffInstance.init({ liffId: LIFF_ID });

      if (!liffInstance.isLoggedIn()) {
        liffInstance.login();
        return;
      }

      const profile = await liffInstance.getProfile();
      setUser({
        mode: "liff",
        lineUserId: profile.userId,
        displayName: profile.displayName,
        pictureUrl: profile.pictureUrl,
      });
      setStage("ready");
    } catch (err: any) {
      console.error("LIFF init error:", err);
      setErrorMsg(err.message || "LIFF 初始化失敗");
      setStage("error");
    }
  }

  function initLineLogin() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");

    if (code) {
      handleLineCallback(code);
    } else {
      setStage("login");
    }
  }

  async function handleLineCallback(code: string) {
    try {
      const redirectUri = `${window.location.origin}/liff/clock-in`;
      const res = await apiRequest("POST", "/api/portal/line-callback", { code, redirectUri });
      const data = await res.json();
      window.history.replaceState({}, "", "/liff/clock-in");

      setUser({
        mode: "line-login",
        lineUserId: data.lineUserId || "",
        displayName: data.name,
        employeeId: data.id,
        employeeName: data.name,
      });
      setStage("ready");
    } catch (err: any) {
      console.error("LINE callback error:", err);
      toast({
        title: "LINE 登入失敗",
        description: err.message || "驗證失敗，請重試",
        variant: "destructive",
      });
      window.history.replaceState({}, "", "/liff/clock-in");
      setStage("login");
    }
  }

  function handleLineLogin() {
    const redirectUri = encodeURIComponent(`${window.location.origin}/liff/clock-in`);
    const state = Math.random().toString(36).substring(7);
    window.location.href = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${LINE_CHANNEL_ID}&redirect_uri=${redirectUri}&state=${state}&scope=profile%20openid`;
  }

  const handleClockIn = useCallback(async () => {
    if (!user) return;
    setStage("locating");

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

      const body: Record<string, any> = { latitude, longitude, accuracy: Math.round(acc) };
      if (user.employeeId) {
        body.employeeId = user.employeeId;
      } else {
        body.lineUserId = user.lineUserId;
      }

      const resp = await fetch("/api/liff/clock-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.message || "打卡請求失敗");
      }

      const data: ClockInResult = await resp.json();
      setResult(data);
      setStage("done");
    } catch (err: any) {
      console.error("Clock-in error:", err);
      if (err.code === 1) {
        setErrorMsg("請允許位置存取權限後再試一次。\n\n請到手機設定 → LINE → 位置 → 允許");
      } else if (err.code === 2) {
        setErrorMsg("無法取得您的位置，請確認 GPS 已開啟。");
      } else if (err.code === 3) {
        setErrorMsg("定位逾時，請到戶外空曠處再試一次。");
      } else {
        setErrorMsg(err.message || "打卡過程發生錯誤");
      }
      setStage("error");
    }
  }, [user]);

  return (
    <div className="min-h-screen bg-juns-surface flex flex-col">
      <header className="bg-juns-navy text-white px-4 py-3 flex items-center gap-3" data-testid="liff-header">
        <img src={junsLogo} alt="駿斯運動" className="h-8 w-8 rounded-lg object-cover" />
        <div className="flex-1">
          <h1 className="text-sm font-semibold tracking-wide">GPS 打卡</h1>
          {user && <p className="text-xs text-white/60">{user.displayName || user.employeeName}</p>}
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">

          {stage === "init" && (
            <Card className="p-8 text-center border-juns-border">
              <Loader2 className="h-10 w-10 animate-spin mx-auto text-juns-teal mb-4" />
              <p className="text-muted-foreground text-sm">正在初始化...</p>
            </Card>
          )}

          {stage === "login" && (
            <Card className="p-6 border-juns-border text-center">
              <div className="w-16 h-16 rounded-xl bg-[#06C755] flex items-center justify-center mx-auto mb-4">
                <svg viewBox="0 0 24 24" className="w-9 h-9 text-white fill-current">
                  <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold mb-1">GPS 打卡系統</h2>
              <p className="text-sm text-muted-foreground mb-6">使用 LINE 帳號登入後即可打卡</p>
              <Button
                className="w-full h-12 text-base font-semibold bg-[#06C755] hover:bg-[#05b54c] text-white"
                onClick={handleLineLogin}
                data-testid="button-line-login"
              >
                LINE 登入
              </Button>
            </Card>
          )}

          {stage === "ready" && (
            <Card className="p-6 border-juns-border" data-testid="card-gps-clock-in">
              <div className="text-center">
                <div className="relative w-40 h-40 mx-auto mb-6">
                  <div className="absolute inset-0 rounded-full border-2 border-juns-teal/20" />
                  <div className="absolute inset-4 rounded-full border border-juns-teal/15" />
                  <div className="absolute inset-8 rounded-full border border-juns-teal/10" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-3 h-3 rounded-full bg-juns-teal" />
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mb-6">
                  點擊下方按鈕，系統將自動取得您的 GPS 位置進行打卡
                </p>
                <Button
                  size="lg"
                  className="w-full h-14 text-lg font-semibold bg-juns-green hover:bg-juns-green/90 text-white rounded-xl"
                  onClick={handleClockIn}
                  data-testid="button-gps-clock-in"
                >
                  <Navigation className="mr-2 h-5 w-5" />
                  一鍵打卡
                </Button>
              </div>
            </Card>
          )}

          {stage === "locating" && (
            <Card className="p-8 text-center border-juns-border">
              <div className="relative w-40 h-40 mx-auto mb-4">
                <div className="absolute inset-0 rounded-full border-2 border-juns-teal/30 animate-radar-ping" />
                <div className="absolute inset-0 rounded-full overflow-hidden">
                  <div className="absolute inset-0 animate-radar-sweep"
                    style={{ background: "conic-gradient(from 0deg, transparent 0%, rgba(27,177,165,0.3) 15%, transparent 30%)" }} />
                </div>
                <div className="absolute inset-4 rounded-full border border-juns-teal/15" />
                <div className="absolute inset-8 rounded-full border border-juns-teal/10" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-3 h-3 rounded-full bg-juns-teal animate-pulse" />
                </div>
              </div>
              <p className="font-medium mb-1">正在定位中...</p>
              <p className="text-muted-foreground text-sm">請確認已開啟 GPS</p>
            </Card>
          )}

          {stage === "submitting" && (
            <Card className="p-8 text-center border-juns-border">
              <Loader2 className="h-10 w-10 animate-spin mx-auto text-juns-teal mb-4" />
              <p className="font-medium mb-1">正在處理打卡...</p>
              {accuracy && (
                <p className="text-muted-foreground text-sm">GPS 精度：±{accuracy}m</p>
              )}
            </Card>
          )}

          {stage === "done" && result && (
            <ResultCard result={result} accuracy={accuracy} onRetry={() => { setResult(null); setStage("ready"); }} />
          )}

          {stage === "error" && (
            <Card className="p-8 text-center border-juns-border">
              <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
                <XCircle className="h-8 w-8 text-red-500" />
              </div>
              <p className="font-medium mb-2">發生錯誤</p>
              <p className="text-muted-foreground text-sm whitespace-pre-line mb-6">{errorMsg}</p>
              <Button
                variant="outline"
                className="w-full border-juns-border"
                onClick={() => { setErrorMsg(""); setStage(user ? "ready" : "login"); }}
                data-testid="button-retry"
              >
                重試
              </Button>
            </Card>
          )}

          <p className="text-center text-muted-foreground/50 text-xs mt-6">
            駿斯運動 GPS 打卡系統
          </p>
        </div>
      </div>
    </div>
  );
}

function ResultCard({ result, accuracy, onRetry }: { result: ClockInResult; accuracy: number | null; onRetry: () => void }) {
  const isSuccess = result.status === "success";
  const isWarning = result.status === "warning";

  const bgColor = isSuccess ? "bg-green-50" : isWarning ? "bg-yellow-50" : "bg-red-50";
  const iconColor = isSuccess ? "text-green-500" : isWarning ? "text-yellow-500" : "text-red-500";
  const Icon = isSuccess ? CheckCircle2 : isWarning ? AlertTriangle : XCircle;

  const clockLabel = result.clockType === "in" ? "上班打卡" : "下班打卡";
  const statusText = isSuccess
    ? `${clockLabel}成功！`
    : isWarning
      ? "打卡已記錄（無排班）"
      : result.failReason || "打卡失敗";

  return (
    <Card className="p-6 border-juns-border" data-testid="card-clock-result">
      <div className="text-center mb-4">
        <div className={`w-16 h-16 rounded-full ${bgColor} flex items-center justify-center mx-auto mb-3`}>
          <Icon className={`h-8 w-8 ${iconColor}`} />
        </div>
        <p className={`text-lg font-semibold ${iconColor}`}>{statusText}</p>
      </div>

      <div className="space-y-0">
        {result.employeeName && <InfoRow label="員工" value={result.employeeName} />}
        {result.venueName && <InfoRow label="場館" value={result.venueName} />}
        {result.distance !== null && (
          <InfoRow label="距離" value={`${result.distance}m${result.radius ? ` / ${result.radius}m 內` : ""}`} />
        )}
        <InfoRow label="時間" value={`${result.date} ${result.time}`} />
        {result.shiftInfo && <InfoRow label="班別" value={result.shiftInfo} />}
        {accuracy && <InfoRow label="GPS 精度" value={`±${accuracy}m`} />}
      </div>

      {result.nearbyVenues && result.nearbyVenues.length > 0 && (
        <div className="mt-4 pt-3 border-t border-juns-border">
          <p className="text-xs text-muted-foreground mb-2">附近場館</p>
          <div className="space-y-1.5">
            {result.nearbyVenues.map((v, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className={v.inRange ? "text-juns-teal font-medium" : "text-muted-foreground"}>
                  {v.inRange ? "✓ " : ""}{v.name}
                </span>
                <span className="font-mono text-muted-foreground">{v.distance}m</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Button
        variant="outline"
        className="w-full mt-6 border-juns-border"
        onClick={onRetry}
        data-testid="button-clock-again"
      >
        再次打卡
      </Button>
    </Card>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-2 border-b border-juns-border/50 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}
