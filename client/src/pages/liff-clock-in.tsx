import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MapPin, CheckCircle2, AlertTriangle, XCircle, Loader2, Navigation } from "lucide-react";

const LIFF_ID = import.meta.env.VITE_LIFF_ID || "";

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

type Stage = "init" | "ready" | "locating" | "submitting" | "done" | "error";

export default function LiffClockInPage() {
  const [stage, setStage] = useState<Stage>("init");
  const [liff, setLiff] = useState<any>(null);
  const [profile, setProfile] = useState<{ userId: string; displayName: string; pictureUrl?: string } | null>(null);
  const [result, setResult] = useState<ClockInResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [accuracy, setAccuracy] = useState<number | null>(null);

  useEffect(() => {
    initLiff();
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

      const userProfile = await liffInstance.getProfile();
      setLiff(liffInstance);
      setProfile({
        userId: userProfile.userId,
        displayName: userProfile.displayName,
        pictureUrl: userProfile.pictureUrl,
      });
      setStage("ready");
    } catch (err: any) {
      console.error("LIFF init error:", err);
      setErrorMsg(err.message || "LIFF 初始化失敗");
      setStage("error");
    }
  }

  const handleClockIn = useCallback(async () => {
    if (!profile) return;
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

      const resp = await fetch("/api/liff/clock-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineUserId: profile.userId,
          latitude,
          longitude,
          accuracy: Math.round(acc),
        }),
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
  }, [profile]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {profile && (
          <div className="text-center mb-6" data-testid="text-employee-info">
            {profile.pictureUrl && (
              <img
                src={profile.pictureUrl}
                alt=""
                className="w-16 h-16 rounded-full mx-auto mb-2 border-2 border-white/20"
              />
            )}
            <p className="text-white/80 text-sm">你好，</p>
            <p className="text-white text-lg font-semibold">{profile.displayName}</p>
          </div>
        )}

        {stage === "init" && (
          <Card className="p-8 text-center bg-slate-800/50 border-slate-700">
            <Loader2 className="h-10 w-10 animate-spin mx-auto text-blue-400 mb-4" />
            <p className="text-white/70">正在初始化...</p>
          </Card>
        )}

        {stage === "ready" && (
          <Card className="p-8 bg-slate-800/50 border-slate-700">
            <div className="text-center">
              <div className="w-20 h-20 rounded-full bg-blue-500/20 flex items-center justify-center mx-auto mb-6">
                <MapPin className="h-10 w-10 text-blue-400" />
              </div>
              <p className="text-white/60 text-sm mb-6">
                點擊下方按鈕，系統將自動取得您的 GPS 位置進行打卡
              </p>
              <Button
                size="lg"
                className="w-full h-14 text-lg font-semibold bg-blue-600 hover:bg-blue-700"
                onClick={handleClockIn}
                data-testid="button-clock-in"
              >
                <Navigation className="mr-2 h-5 w-5" />
                GPS 打卡
              </Button>
            </div>
          </Card>
        )}

        {stage === "locating" && (
          <Card className="p-8 text-center bg-slate-800/50 border-slate-700">
            <div className="w-20 h-20 rounded-full bg-blue-500/20 flex items-center justify-center mx-auto mb-4 animate-pulse">
              <Navigation className="h-10 w-10 text-blue-400" />
            </div>
            <p className="text-white font-medium mb-1">正在定位中...</p>
            <p className="text-white/50 text-sm">請確認已開啟 GPS</p>
          </Card>
        )}

        {stage === "submitting" && (
          <Card className="p-8 text-center bg-slate-800/50 border-slate-700">
            <Loader2 className="h-10 w-10 animate-spin mx-auto text-blue-400 mb-4" />
            <p className="text-white font-medium mb-1">正在處理打卡...</p>
            {accuracy && (
              <p className="text-white/50 text-sm">GPS 精度：±{accuracy}m</p>
            )}
          </Card>
        )}

        {stage === "done" && result && (
          <ResultCard result={result} accuracy={accuracy} onRetry={() => { setResult(null); setStage("ready"); }} />
        )}

        {stage === "error" && (
          <Card className="p-8 text-center bg-slate-800/50 border-slate-700">
            <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
              <XCircle className="h-10 w-10 text-red-400" />
            </div>
            <p className="text-white font-medium mb-2">發生錯誤</p>
            <p className="text-white/60 text-sm whitespace-pre-line mb-6">{errorMsg}</p>
            <Button
              variant="outline"
              className="w-full border-slate-600 text-white hover:bg-slate-700"
              onClick={() => { setErrorMsg(""); setStage("ready"); }}
              data-testid="button-retry"
            >
              重試
            </Button>
          </Card>
        )}

        <p className="text-center text-white/30 text-xs mt-6">
          駿斯運動 GPS 打卡系統
        </p>
      </div>
    </div>
  );
}

function ResultCard({ result, accuracy, onRetry }: { result: ClockInResult; accuracy: number | null; onRetry: () => void }) {
  const isSuccess = result.status === "success";
  const isWarning = result.status === "warning";
  const isFail = result.status === "fail" || result.status === "error";

  const bgColor = isSuccess ? "bg-green-500/20" : isWarning ? "bg-yellow-500/20" : "bg-red-500/20";
  const iconColor = isSuccess ? "text-green-400" : isWarning ? "text-yellow-400" : "text-red-400";
  const Icon = isSuccess ? CheckCircle2 : isWarning ? AlertTriangle : XCircle;

  const clockLabel = result.clockType === "in" ? "上班打卡" : "下班打卡";
  const isNotBound = isFail && (result.failReason?.includes("尚未綁定") || result.failReason?.includes("找不到員工"));
  const statusText = isSuccess
    ? `${clockLabel}成功！`
    : isWarning
      ? "打卡已記錄（無排班）"
      : result.failReason || "打卡失敗";

  return (
    <Card className="p-6 bg-slate-800/50 border-slate-700" data-testid="card-clock-result">
      <div className="text-center mb-4">
        <div className={`w-16 h-16 rounded-full ${bgColor} flex items-center justify-center mx-auto mb-3`}>
          <Icon className={`h-8 w-8 ${iconColor}`} />
        </div>
        <p className={`text-lg font-semibold ${iconColor}`}>{statusText}</p>
      </div>

      {isNotBound && (
        <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-4 mb-4" data-testid="card-not-bound-guide">
          <p className="text-orange-300 font-semibold text-sm mb-2">帳號綁定步驟：</p>
          <ol className="text-orange-200/80 text-xs leading-relaxed space-y-1.5 list-decimal list-inside">
            <li>回到 LINE 官方帳號對話</li>
            <li>傳送您的<strong>「員工編號」</strong>（純數字）</li>
            <li>系統自動完成綁定</li>
            <li>綁定成功後即可打卡</li>
          </ol>
          <p className="text-orange-400/60 text-[11px] mt-2">如不確定員工編號，請洽詢主管或 HR。</p>
        </div>
      )}

      <div className="space-y-2 text-sm">
        {result.employeeName && (
          <InfoRow label="員工" value={result.employeeName} />
        )}
        {result.venueName && (
          <InfoRow label="場館" value={result.venueName} />
        )}
        {result.distance !== null && (
          <InfoRow label="距離" value={`${result.distance}m${result.radius ? ` / ${result.radius}m 內` : ""}`} />
        )}
        <InfoRow label="時間" value={`${result.date} ${result.time}`} />
        {result.shiftInfo && (
          <InfoRow label="班別" value={result.shiftInfo} />
        )}
        {isSuccess && result.failReason && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-500/20 border border-orange-500/30">
            <AlertTriangle className="h-4 w-4 text-orange-400 shrink-0" />
            <span className="text-orange-300 font-medium text-sm" data-testid="text-late-info">{result.failReason}</span>
          </div>
        )}
        {accuracy && (
          <InfoRow label="GPS 精度" value={`±${accuracy}m`} />
        )}
      </div>

      <Button
        variant="outline"
        className="w-full mt-6 border-slate-600 text-white hover:bg-slate-700"
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
    <div className="flex justify-between py-1.5 border-b border-slate-700/50">
      <span className="text-white/50">{label}</span>
      <span className="text-white font-medium">{value}</span>
    </div>
  );
}
