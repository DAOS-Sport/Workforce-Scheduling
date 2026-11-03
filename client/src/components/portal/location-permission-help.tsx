import { useState } from "react";
import { ExternalLink, Copy } from "lucide-react";
import {
  detectPlatform,
  isInLine,
  portalUrl,
  externalPortalUrl,
  type Platform,
} from "@/lib/location-help";

interface Guide {
  title: string;
  steps?: string[];
  text?: string;
  note?: string;
}

const LINE_TITLE = "LINE 沒有取得定位權限";
const BROWSER_TITLE = "瀏覽器沒有取得定位權限";

function guideFor(inLine: boolean, platform: Platform): Guide {
  if (platform === "ios") {
    return inLine
      ? {
          title: LINE_TITLE,
          steps: [
            "打開 iPhone「設定」→「隱私權與安全性」→「定位服務」，確認最上面的開關是開啟的。",
            "同一頁往下找到「LINE」，選「使用 App 期間」，並打開「精確位置」。",
            "把 LINE 從背景完全滑掉後重新打開，再進打卡頁按打卡；跳出詢問時請按「允許」。",
          ],
          note: "不需要清除 LINE 的快取或資料。",
        }
      : {
          title: BROWSER_TITLE,
          steps: [
            "打開 iPhone「設定」→「隱私權與安全性」→「定位服務」→「Safari 網站」，選「使用 App 期間」。",
            "回到 Safari，點網址列左邊的「大小」圖示 →「網站設定」→「位置」→「允許」。",
            "重新整理頁面，再按打卡。",
          ],
        };
  }
  if (platform === "android") {
    return inLine
      ? {
          title: LINE_TITLE,
          steps: [
            "打開手機「設定」→「應用程式」→「LINE」→「權限」→「位置」，選「僅在使用應用程式時允許」，並打開「使用精確位置」。",
            "確認手機下拉選單裡的「定位」是開啟的。",
            "回到 LINE 重新進打卡頁，再按打卡。",
          ],
        }
      : {
          title: BROWSER_TITLE,
          steps: [
            "點網址列左邊的圖示 →「權限」→「位置」→「允許」。",
            "確認手機的「定位」是開啟的，重新整理頁面再按打卡。",
          ],
        };
  }
  return {
    title: BROWSER_TITLE,
    text: "請在瀏覽器的網站設定中允許此網站使用位置，並確認裝置的定位服務已開啟。",
  };
}

function currentUa(): string {
  return typeof navigator === "undefined" ? "" : navigator.userAgent ?? "";
}

function currentOrigin(): string {
  return typeof window === "undefined" ? "" : window.location.origin;
}

/**
 * LIFF 頁面裡 openExternalBrowser=1 無效，要用 liff.openWindow({ external: true })；
 * LINE 一般內建瀏覽器則靠 openExternalBrowser=1。任何例外都退回後者。
 */
async function openInExternalBrowser(origin: string) {
  try {
    const liff = (await import("@line/liff")).default;
    const liffId = import.meta.env.VITE_LIFF_ID;
    if (!liff.id && liffId) await liff.init({ liffId });
    if (liff.isInClient()) {
      liff.openWindow({ url: portalUrl(origin), external: true });
      return;
    }
  } catch {
    // 退回 openExternalBrowser=1
  }
  window.location.href = externalPortalUrl(origin);
}

export function LocationPermissionHelp({
  ua = currentUa(),
  origin = currentOrigin(),
}: {
  ua?: string;
  origin?: string;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const inLine = isInLine(ua);
  const guide = guideFor(inLine, detectPlatform(ua));
  const url = portalUrl(origin);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <div
      className="mt-3 w-full min-w-0 rounded-xl border border-juns-border bg-white p-4 text-left"
      data-testid="location-permission-help"
    >
      <p className="text-sm font-semibold text-juns-navy" data-testid="text-location-help-title">
        {guide.title}
      </p>

      {guide.steps && (
        <ol className="mt-3 space-y-2">
          {guide.steps.map((step, i) => (
            <li key={i} className="flex items-start gap-2.5 text-xs leading-relaxed text-slate-600">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-juns-teal/10 text-[10px] font-bold text-juns-teal">
                {i + 1}
              </span>
              <span className="min-w-0 break-words">{step}</span>
            </li>
          ))}
        </ol>
      )}
      {guide.text && <p className="mt-2 text-xs leading-relaxed text-slate-600">{guide.text}</p>}
      {guide.note && <p className="mt-2 text-[11px] text-slate-400">{guide.note}</p>}

      {inLine && (
        <div className="mt-4 border-t border-juns-border pt-4">
          <button
            type="button"
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-juns-teal text-sm font-medium text-white transition-all active:scale-[0.98]"
            onClick={() => void openInExternalBrowser(origin)}
            data-testid="button-open-external-browser"
          >
            <ExternalLink className="h-4 w-4" />
            改用 Safari／Chrome 開啟打卡頁
          </button>
          <p className="mt-2 text-center text-[11px] text-slate-500">開啟後用 LINE 登入即可打卡</p>

          <p
            className="mt-3 break-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-600 select-all"
            data-testid="text-portal-url"
          >
            {url}
          </p>
          <button
            type="button"
            className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-juns-border bg-white text-xs text-slate-600 transition-all active:scale-[0.98]"
            onClick={copyUrl}
            data-testid="button-copy-portal-url"
          >
            <Copy className="h-3.5 w-3.5" />
            複製網址
          </button>
          {copyState === "copied" && (
            <p className="mt-2 text-center text-[11px] text-juns-teal" role="status">
              已複製
            </p>
          )}
          {copyState === "failed" && (
            <p className="mt-2 text-center text-[11px] text-orange-600" role="status">
              無法自動複製，請長按網址手動複製。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
