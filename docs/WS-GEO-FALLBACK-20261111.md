# 定位失敗退路盤點

工單：WS-GEO-FALLBACK-20261111。基底：`6fc3201`（`boyam01/ws-batch2`）。本機修正；未部署、未連開發或正式資料庫、未呼叫真實 LINE／Ragic。

下表的「退路」指重新取得位置、LINE 內沿用既有 Safari／Chrome 外開及複製網址、開啟既有補打卡申請表；一般瀏覽器依需求不顯示外開按鈕。申請仍須截圖、受既有額度及重複檢查限制，只有主管審核後才可能補卡。

| 入口／失敗路徑 | 改前 | 改後 |
| --- | --- | --- |
| LIFF／PERMISSION_DENIED | 顯示平台權限步驟、外開網址與回到 ready 的重試，另有照片異常回報。 | 預查 denied 後立即引導，重取直接再次定位，並可開啟預填的既有補卡申請。 |
| portal／PERMISSION_DENIED | 顯示權限步驟、外開網址與返回 idle 的重試，另有異常回報。 | 預查 denied 後立即引導，重取保留原上／下班方向，並可開啟預填的既有補卡申請。 |
| LIFF／POSITION_UNAVAILABLE | 單次高精度失敗後只剩一般重試及照片回報，沒有外開及補卡入口。 | 自動低精度再試一次，仍失敗時顯示完整退路。 |
| portal／POSITION_UNAVAILABLE | 已有低精度重試，但最終失敗只有一般重試及異常回報。 | 保留兩階段定位，最終失敗顯示完整退路。 |
| LIFF／TIMEOUT | 原生 15 秒定位加 20 秒保護後顯示一般錯誤，沒有第二階段定位。 | 高精度 10 秒後低精度 20 秒，各有額外 1 秒不回呼保護，最終提供退路。 |
| portal／TIMEOUT | 有 10／20 秒兩階段定位，但完全不回呼的 WebView 可能一直 scanning。 | 兩階段各有不回呼保護，最多兩次定位後提供退路。 |
| LIFF／不支援 geolocation | 呼叫不存在的 API 後落入一般錯誤及照片回報。 | 明確顯示不支援訊息及完整退路。 |
| portal／不支援 geolocation | 顯示不支援與一般重試，沒有權限外開或補卡引導。 | 明確顯示不支援訊息及完整退路。 |
| 兩入口／非安全來源 | 沒有主動區分，可能顯示不支援、權限拒絕或一般例外。 | 先檢查 isSecureContext，提示 HTTPS 並提供退路，不嘗試打卡。 |
| 兩入口／精度太差 | 沒有獨立精度門檻，定位結果交給既有距離判斷。 | 只在原距離判斷已 fail 且 accuracy 大於回應 radius 時提示精度與退路，原 success／warning 不變。 |
| 兩入口／未知定位例外 | 顯示一般例外訊息，沒有明確補卡路徑。 | 分類 UNKNOWN，不上報原始例外文字，顯示完整退路。 |
| 兩入口／Permissions API 不支援或拒絕 query | 未先查詢權限。 | query 不可用或拒絕時仍照原定位流程，query 不回應超過 1 秒也繼續定位。 |
| 新員工／第一次授權 | 只在主動按打卡時請求，避免載入時誤拒絕。 | 保留主動請求；prompt／granted 進入定位，失敗皆有退路。 |
| 舊員工／以前已拒絕 | 再按時依賴 geolocation 回呼，WebView 可能不再彈授權視窗。 | 支援 query 時直接判 denied，顯示設定步驟，網頁不假稱能強制重新彈窗。 |
| iOS／LINE | 權限拒絕才出現 iPhone／LINE 權限步驟與外開。 | 所有定位失敗皆可外開或複製網址，沿用 iPhone／LINE 步驟。 |
| Android／LINE | 權限拒絕才出現 Android／LINE 權限步驟與外開。 | 所有定位失敗皆可外開或複製網址，沿用 Android／LINE 步驟。 |
| Safari／Chrome／一般瀏覽器 | 可 LINE 登入，拒絕時依平台顯示網站權限步驟。 | 保留一般瀏覽器登入及平台步驟，提供重取及補卡，不顯示 LINE 專用外開。 |
| LIFF／前次結果後再定位失敗 | 沒有補卡預填，舊 result 可留在 state。 | 新一次定位先清除舊 result，無座標時不沿用舊打卡方向。 |

## 採用的預設

- LIFF 原本自動判上／下班；定位失敗、尚無後端方向時，補卡預填「上班」，員工可在原表單切換「下班」。portal 預填原本按下的方向；已有精度失敗回應時 LIFF 使用回應方向。
- 補卡原因選「其他」，備註預填 `定位失敗：<kind>`，完整 reason 為 `其他：定位失敗：<kind>`；不自行標記「系統異常」來豁免每月額度。
- 開啟申請時以 Asia/Taipei 現在日期、分鐘預填原表單，仍可調整；送出後明確顯示「已送出，待主管審核」。
- 第一階段 `maximumAge=0`；第二階段 `maximumAge=120000`，只因 code 2／3 自動重試一次。

## 觀測

沿用 `POST /api/anomaly-report` 的 JSON 分支，只收 event 固定值及 kind、entry、platform、inLine 四個白名單欄位，額外欄位拒絕。每個失敗 attempt（包含後來被 fallback 恢復的高精度失敗）寫一筆 warn，歸 `clock.coverage`；不記座標、LINE ID、姓名或原始 UA。

新增 `clock.geolocation`：15 分鐘至少 3 次失敗為紅；24 小時有失敗而未達紅門檻為黃；已讀取的 24 小時沒有失敗回報為綠；缺訊號為黃，讀取失敗只讓該條紅。這是失敗次數，不是受影響員工數，也不能判斷某員工是否已透過重試恢復。沿用既有日誌儲存、IT 監控與 health-v1，中樞沒有改動。

## 產品檔

| 檔案 | 原因 |
| --- | --- |
| `client/src/pages/liff-clock-in.tsx` | 接上共用兩階段定位及錯誤退路，清除重試前舊結果。 |
| `client/src/pages/portal.tsx` | 補齊定位保護、匿名回報與退路，沿用既有補卡表單預填和待審狀態。 |
| `server/modules/anomaly/anomaly.routes.ts` | 沿既有端點以嚴格白名單收定位失敗，寫入 warn。 |
| `server/core/health/rules.ts` | 新增定位失敗三燈純函式。 |
| `server/core/health/report.ts` | 在既有 health-v1 報告組裝獨立定位管線。 |
| `server/modules/health/health.service.ts` | 以 attempt／ReadError 唯讀統計既有 pipeline_logs。 |

無新資料表、SQL migration 或依賴。原距離、半徑、打卡成功條件與後端補卡審核不變；員工身分驗證不在本單範圍。

## 驗證

| 實跑項目 | 結果 |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run` | 84 檔、897/897 PASS，0 skipped。 |
| `bash scripts/itest.sh` | 40 檔、408/408 PASS，0 skipped，僅拋棄式 PostgreSQL。 |
| `TZ=Asia/Taipei` 定位／健康 focused tests | 3 檔、41/41 PASS。 |
| `tsc --noEmit -p . --tsBuildInfoFile <worktree 外檔案>` | 與基底同 30 筆診斷、exit 2，兩份原文 4258 bytes 完全相同。 |
| 新前端案例先紅後綠 | 最初 26/26 FAIL；相同 26 例最終 PASS，另加 5 個回歸案例全過。 |
| 新後端案例先紅後綠 | unit 21 FAIL／1 PASS → 22 PASS；PG 5 FAIL → 5 PASS。 |
| LIFF 舊結果序列反例 | 真正重現 1 FAIL，修正後於全套通過；兩次未正確刺激序列的早期結果另保留。 |
| 獨立 reviewer 選定的關鍵突變 | 隔離副本 31/31 被行為斷言抓到，33 個失敗斷言；逐案還原原 bytes。 |

全量 itest 首輪 407 PASS／1 FAIL 是舊測試固定要求 51 條管線；依新增 watchdog 契約更新為 52 並明確包含新 ID 後，全量重跑 408 PASS。原始失敗保留。最初有一次合成 response 漏欄位導致 52 個斷言雖過、程序 exit 1，沒有計為 GREEN；修正 fixture 後才計入以上全套結果。

完整實跑數字、RED／GREEN 原始輸出、獨立 reviewer 選定的突變結果、tsc 基底比對與環境收尾記在本工單外部 evidence。真手機權限、LINE WebView 和正式站未實機驗收；Computer Use 回報 `The browser access host is unavailable`，瀏覽器檢查為 BLOCKED／NOT_RUN，不能把 jsdom／合成硬體結果視為真機通過。
