import { useState, useEffect, useCallback, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MapPin, CheckCircle2, AlertTriangle, XCircle, Loader2, Navigation, Smartphone, Settings, Camera, ImagePlus, X, Send } from "lucide-react";

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
  const [errorCode, setErrorCode] = useState<number | null>(null);
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
      setErrorCode(err.code ?? null);
      if (err.code === 1) {
        setErrorMsg("位置存取權限被拒絕");
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
          <ResultCard
            result={result}
            accuracy={accuracy}
            lineUserId={profile?.userId}
            displayName={profile?.displayName}
            onRetry={() => { setResult(null); setStage("ready"); }}
          />
        )}

        {stage === "error" && errorCode === 1 ? (
          <Card className="bg-slate-800/50 border-slate-700 overflow-hidden" data-testid="card-permission-guide">
            <div className="bg-orange-500/20 border-b border-orange-500/30 p-5 text-center">
              <div className="w-16 h-16 rounded-full bg-orange-500/20 flex items-center justify-center mx-auto mb-3">
                <MapPin className="h-8 w-8 text-orange-400" />
              </div>
              <p className="text-orange-300 font-bold text-base">需要開啟位置權限</p>
              <p className="text-orange-200/70 text-xs mt-1">請依下方步驟開啟後再打卡</p>
            </div>

            <div className="p-5 space-y-4">
              <div className="bg-slate-700/50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center shrink-0">
                    <Smartphone className="h-3.5 w-3.5 text-white" />
                  </div>
                  <p className="text-blue-300 font-semibold text-sm">iPhone 設定步驟</p>
                </div>
                <ol className="space-y-2">
                  {[
                    "關閉這個視窗，回到手機桌面",
                    "開啟手機「設定」App",
                    "往下滑找到「LINE」→ 點進去",
                    "點「位置」→ 選「使用 App 時」",
                    "回到 LINE，重新點打卡連結",
                  ].map((step, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-xs text-white/70">
                      <span className="w-5 h-5 rounded-full bg-slate-600 text-white/80 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                      <span className="leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="bg-slate-700/50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full bg-green-600 flex items-center justify-center shrink-0">
                    <Settings className="h-3.5 w-3.5 text-white" />
                  </div>
                  <p className="text-green-300 font-semibold text-sm">Android 設定步驟</p>
                </div>
                <ol className="space-y-2">
                  {[
                    "關閉這個視窗，回到手機桌面",
                    "長按 LINE 圖示 → 點「App 資訊」",
                    "點「權限」→「位置」",
                    "選「只在使用中允許」",
                    "回到 LINE，重新點打卡連結",
                  ].map((step, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-xs text-white/70">
                      <span className="w-5 h-5 rounded-full bg-slate-600 text-white/80 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                      <span className="leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <p className="text-center text-white/30 text-[11px]">
                開啟後若還是有問題，請聯絡主管
              </p>

              <Button
                variant="outline"
                className="w-full border-slate-600 text-white hover:bg-slate-700"
                onClick={() => { setErrorMsg(""); setErrorCode(null); setStage("ready"); }}
                data-testid="button-retry"
              >
                我已開啟，重試打卡
              </Button>
            </div>
          </Card>
        ) : stage === "error" ? (
          <Card className="p-8 text-center bg-slate-800/50 border-slate-700">
            <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
              <XCircle className="h-10 w-10 text-red-400" />
            </div>
            <p className="text-white font-medium mb-2">發生錯誤</p>
            <p className="text-white/60 text-sm whitespace-pre-line mb-6">{errorMsg}</p>
            <Button
              variant="outline"
              className="w-full border-slate-600 text-white hover:bg-slate-700"
              onClick={() => { setErrorMsg(""); setErrorCode(null); setStage("ready"); }}
              data-testid="button-retry"
            >
              重試
            </Button>
          </Card>
        ) : null}

        <p className="text-center text-white/30 text-xs mt-6">
          駿斯運動 GPS 打卡系統
        </p>
      </div>
    </div>
  );
}

// ── Photo proof section (shown when GPS fail due to distance) ─────────────────

type ProofStage = "idle" | "submitting" | "submitted" | "error";

function PhotoProofSection({
  result,
  lineUserId,
  displayName,
}: {
  result: ClockInResult;
  lineUserId?: string;
  displayName?: string;
}) {
  const [photos, setPhotos] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [proofStage, setProofStage] = useState<ProofStage>("idle");
  const [proofError, setProofError] = useState("");
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const addPhoto = (file: File) => {
    if (photos.length >= 3) return;
    const url = URL.createObjectURL(file);
    setPhotos((prev) => [...prev, file]);
    setPreviews((prev) => [...prev, url]);
  };

  const removePhoto = (idx: number) => {
    URL.revokeObjectURL(previews[idx]);
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
    setPreviews((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async () => {
    if (photos.length === 0) {
      setProofError("請先拍攝或選擇至少一張照片");
      return;
    }
    setProofStage("submitting");
    setProofError("");

    try {
      const formData = new FormData();
      const payload = {
        context: "拍照證明 — GPS 超出打卡範圍",
        employee: {
          name: displayName || result.employeeName || "未知",
          lineUserId: lineUserId || "",
        },
        clockResult: {
          status: result.status,
          clockType: result.clockType,
          time: result.time,
          date: result.date,
          venueName: result.venueName,
          distance: result.distance,
          failReason: result.failReason,
        },
        userNote: note.trim() || "員工提交拍照證明",
      };
      formData.append("data", JSON.stringify(payload));
      photos.forEach((p) => formData.append("images", p));

      const resp = await fetch("/api/anomaly-report", { method: "POST", body: formData });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.message || "送出失敗");
      }
      setProofStage("submitted");
    } catch (err: any) {
      setProofError(err.message || "送出失敗，請稍後再試");
      setProofStage("error");
    }
  };

  if (proofStage === "submitted") {
    return (
      <div className="mt-4 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 p-5 text-center">
        <CheckCircle2 className="h-10 w-10 text-emerald-400 mx-auto mb-2" />
        <p className="text-emerald-300 font-semibold text-sm">拍照證明已送出</p>
        <p className="text-emerald-200/60 text-xs mt-1">
          主管收到後將確認您的出勤狀況，如需補卡請聯繫主管
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 overflow-hidden" data-testid="section-photo-proof">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-amber-500/20">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
            <Camera className="h-4 w-4 text-amber-400" />
          </div>
          <div>
            <p className="text-amber-300 font-semibold text-sm leading-tight">請拍照證明您目前在場館內執勤</p>
            <p className="text-amber-200/60 text-[11px] mt-0.5">GPS 定位超出範圍，請拍攝現場照片送交主管確認</p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* Photo grid */}
        <div className="grid grid-cols-3 gap-2">
          {previews.map((src, idx) => (
            <div key={idx} className="relative aspect-square rounded-xl overflow-hidden bg-slate-700" data-testid={`photo-preview-${idx}`}>
              <img src={src} alt="" className="w-full h-full object-cover" />
              <button
                onClick={() => removePhoto(idx)}
                className="absolute top-1 right-1 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center"
                data-testid={`button-remove-photo-${idx}`}
              >
                <X className="h-3 w-3 text-white" />
              </button>
            </div>
          ))}

          {photos.length < 3 && (
            <button
              onClick={() => cameraInputRef.current?.click()}
              className="aspect-square rounded-xl border-2 border-dashed border-amber-500/40 flex flex-col items-center justify-center gap-1 bg-amber-500/5 hover:bg-amber-500/10 transition-colors"
              data-testid="button-take-photo"
            >
              <Camera className="h-6 w-6 text-amber-400/70" />
              <span className="text-[10px] text-amber-400/70 font-medium">拍照</span>
            </button>
          )}
        </div>

        {/* Camera input (hidden) — capture from camera */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) addPhoto(file);
            e.target.value = "";
          }}
          data-testid="input-camera-capture"
        />

        {/* Gallery input (hidden) — pick from library */}
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            files.slice(0, 3 - photos.length).forEach(addPhoto);
            e.target.value = "";
          }}
          data-testid="input-gallery-select"
        />

        {/* Alternate: pick from gallery */}
        {photos.length < 3 && (
          <button
            onClick={() => galleryInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-amber-500/25 text-amber-400/70 text-xs hover:bg-amber-500/10 transition-colors"
            data-testid="button-select-gallery"
          >
            <ImagePlus className="h-3.5 w-3.5" />
            從相簿選取（最多 {3 - photos.length} 張）
          </button>
        )}

        {/* Note */}
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="補充說明（選填）：例如「我在三民場館救生員崗位」…"
          className="w-full bg-slate-800/60 border border-slate-600/50 rounded-xl text-white/80 text-xs placeholder:text-white/30 p-3 resize-none focus:outline-none focus:ring-1 focus:ring-amber-500/50"
          rows={2}
          data-testid="textarea-photo-note"
        />

        {proofError && (
          <p className="text-red-400 text-xs text-center" data-testid="text-proof-error">{proofError}</p>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={proofStage === "submitting" || photos.length === 0}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-black transition-colors"
          data-testid="button-submit-photo-proof"
        >
          {proofStage === "submitting" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              送出中...
            </>
          ) : (
            <>
              <Send className="h-4 w-4" />
              送出拍照證明
            </>
          )}
        </button>

        <p className="text-center text-white/25 text-[10px]">
          照片將送交主管確認，不影響 GPS 打卡紀錄
        </p>
      </div>
    </div>
  );
}

// ── Result card ───────────────────────────────────────────────────────────────

function ResultCard({
  result,
  accuracy,
  lineUserId,
  displayName,
  onRetry,
}: {
  result: ClockInResult;
  accuracy: number | null;
  lineUserId?: string;
  displayName?: string;
  onRetry: () => void;
}) {
  const isSuccess = result.status === "success";
  const isWarning = result.status === "warning";
  const isFail = result.status === "fail" || result.status === "error";

  const bgColor = isSuccess ? "bg-green-500/20" : isWarning ? "bg-yellow-500/20" : "bg-red-500/20";
  const iconColor = isSuccess ? "text-green-400" : isWarning ? "text-yellow-400" : "text-red-400";
  const Icon = isSuccess ? CheckCircle2 : isWarning ? AlertTriangle : XCircle;

  const clockLabel = result.clockType === "in" ? "上班打卡" : "下班打卡";
  const isNotBound = isFail && (result.failReason?.includes("尚未綁定") || result.failReason?.includes("找不到員工"));
  const isDistanceFail = isFail && !isNotBound;

  const statusText = isSuccess
    ? `${clockLabel}成功！`
    : isWarning
      ? "打卡已記錄（無排班）"
      : result.failReason || "打卡失敗";

  return (
    <div>
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
            <InfoRow label="距離" value={`${result.distance}m${result.radius ? ` / 需在 ${result.radius}m 內` : ""}`} />
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

      {/* Photo proof section — shown only when distance fail (not an unbound-account fail) */}
      {isDistanceFail && (
        <PhotoProofSection
          result={result}
          lineUserId={lineUserId}
          displayName={displayName}
        />
      )}
    </div>
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
