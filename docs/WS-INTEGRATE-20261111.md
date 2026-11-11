# WS-INTEGRATE-20261111

2026-11-11，本機整合修正。分支 `boyam01/ws-integrate-fix`，起始 `519c449cf28957306db129f36372ee66cac014c4`；整合候選 `8327251`（產品自 `4b2167e` 後未變）。僅完成本工單清單，不部署、不推送、不修改原 ISSUE 或中樞。

## 修正與提交

| 項目 | Commit | 結果與理由 |
| --- | --- | --- |
| P1-1 路徑檢查 | `35a12b4` | 解碼前拒絕編碼分隔符，權限路徑保留 parent segments；既有 gate 將無效路徑回為 400。 |
| P1-2 合併路由權限 | `49d0003` | 兩條 health 子路由歸 IT 監控讀取；暑假頁失敗回報歸 `summer:write`。 |
| health-v1 範例 bytes | `57d3e23` | `.gitattributes` 固定範例 LF，保持與中樞 byte-identical。 |
| 次要日誌清理 | `67f76b2` | logs purge 失敗不覆蓋已成功的 errors purge；主要刪除失敗仍向上傳遞。 |
| 日誌輸入界限 | `ee495eb` | message 先截 4000 字，再遮蔽，最後截 2000 字。 |
| DB 載入時機 | `f5922ac` | 四個共用服務入口延到實際 I/O 才載入 repository。 |
| 跨分支 health fixtures | `329c3f4` | 補齊訊號、查詢假資料與個人後台 session；保留原斷言。 |
| 舊 unit 的 DB 隔離 | `4b2167e` | 11 份測試隔離既有 DB 模組初始化，保留 repository／transaction fakes。 |
| 合併後管線數量 | `8327251` | watchdog-only 的 47 條加其他四分支管線為 51；只更新 itest 總數與四個 ID 存在性，保留原只讀及日誌斷言。 |

## 產品檔與設定

| 檔案 | 原因 |
| --- | --- |
| `shared/admin-permissions.ts` | 拒絕編碼分隔符，避免改變 Express 實際 route 的授權對象；不消除 `..`。 |
| `server/modules/admin/admin.policy.ts` | 補足三條合併後的管理路由並限定其讀寫分類。 |
| `server/modules/errors/errors.service.ts` | 隔離次要 log retention 失敗，保留主要 errors purge 結果。 |
| `server/shared/logging/buffer.ts` | 在同步遮蔽前限制 message 輸入大小。 |
| `server/shared/health/healthState.ts` | 在狀態讀寫時才載入 system repository。 |
| `server/modules/health/healthLogs.ts` | 在查詢或附加日誌時才載入 log repository。 |
| `server/modules/region/region.service.ts` | 在兩個原有 async lookup 呼叫中才載入 region repository。 |
| `server/shared/logging/persistence.ts` | 在 sink flush／purge 時才載入 log I/O，保留同步 startup／stop 契約。 |
| `.gitattributes`（設定） | 固定 health-v1 範例 LF，避免 Windows checkout 改變契約 bytes。 |

## 根因與範例對齊

`watchdog-all` 的 `c7e26eb` 新增 `healthLogs → healthLogs.repository → db` 與 `persistence → infra/logs → db` 的 eager import。`healthState → system.repository` 是既有 `bb78e25`，`region → region.repository` 是既有 `b8e6c80`。其餘 11 份 unit 的未隔離業務 DB imports 多數也在既有 `b8e6c80`；MCP 的 DB import 更早為 `9b6bdb99`。因此只延後四個工單點名／直接相連的共用入口，未擴大改寫其他業務服務。

`auditActor.test.ts` 補其他分支的 `pushDelivery`、`clockNeverSuccess`、`scheduleSave` 健康訊號；`health.service.test.ts` 補 workflow `pool.query`、audit／clock aggregates 與 logs 假資料。原本「只有目標管線異常」的整份報告斷言保留。`clockNeverSuccess.routes.test.ts` 補新權限服務所需的 `it-monitor:read` 個人 session。

範例沒有分支內容衝突：Git blob 原本就是 LF，Windows 工作副本成為 CRLF。從中樞複製原 bytes 後 SHA256 為 `39192e13f6656e1512dea6b3c0615ce94ddddb24b2bc4d5b5df3dc727b632939`，與 `report.test.ts` 既有預期一致；未改測試雜湊、未改中樞。

## 驗證證據

原始 log／JSON、失敗、命令與輔助腳本保存在 `C:/Users/ians0/AppData/Local/Temp/WS-INTEGRATE-20261111/`。檔案計數與 testcase 狀態由 root 從原始 JSON 獨立重算。

| 驗證 | 結果 |
| --- | --- |
| P1 修正前 | 校正參數 fixture 後 2 檔：11 FAIL／141 PASS；其中 P1-1 5 FAIL，P1-2 6 FAIL。首版兩個任意 config key 的假失敗另留原文。 |
| P1 修正後 | 6 檔／186 PASS，包含兩種真實 employee routes、編碼大小寫、原 gate 與 logs route。 |
| 路由盤點 | 從 server AST 抽取受 gate 的 HTTP 註冊；既有 config key 展開後共 140 個行政請求樣本，全權限逐項允許；另測最小權限與拒絕。 |
| 四入口無 DB import | 修正前 4 FAIL；修正後無 `DATABASE_URL`，throwing DB factory 未觸發。 |
| Agent A 相關回歸 | `TZ=Asia/Taipei`，18 檔／90 PASS；包含原 12 個失敗測試家族與延後 I/O 行為。 |
| errors／buffer | 2 檔／9 PASS；errors 另在 Taipei 通過。200KB 測試修前同步工作超過 15.239 秒仍未結束，停止自有測試 tree；修後完整案例約 0.038 秒，內部 add 斷言 `<1000ms`。 |
| 突變 | P1 五個、errors／buffer 四個，9/9 被預期行為斷言捕獲並精準還原。 |
| tsc | 8GB heap，worktree 外獨立 `--tsBuildInfoFile`。`0a73574` 與候選各 30 筆；檔名、TS code、完整訊息多重集合新增 0／移除 0。僅既有 `leave.routes.ts` 42→50 行位移。 |
| 中樞 `cargo test --locked` | 在中樞目錄使用 README 指定既有 GNU 1.88 工具鏈、編譯輸出置 TEMP：34 unit＋8 end-to-end＝42 PASS。中樞 Git diff 空。 |
| 完整 Vitest | 最終 `8327251`：78 檔／816 PASS，exit 0；`vitest-current.log/json`，原始 JSON 重算一致。 |
| 完整 itest | 最終 `8327251`：38 檔／402 PASS，exit 0；`itest-final.log/json`，原始 JSON 重算一致。拋棄 PG 由腳本停止並清理。 |

完整 unit 首跑在 tsc 同時執行時為 78 檔、813 PASS／3 FAIL；三項均為既有 `layering.test.ts` 同步掃描超過 5000ms，未改測試、timeout、allowlist 或 config。`vitest-full.log/json` 保留；其後在重作業結束後以原命令獨立再驗，另存結果。中樞初期 PATH Cargo 過舊、MSVC／SDK 不齊與命令 quoting 失敗也全部保留；修正本程序工具鏈選擇，未安裝新工具鏈或修改中樞。

完整命令以 PowerShell 執行 `npx vitest run`、Git Bash 的 `bash scripts/itest.sh`；僅額外附 `--reporter=default --reporter=json --outputFile.json=<TEMP 專屬檔>` 取證，沒有改 worker、timeout 或測試範圍。型別命令為 `$env:NODE_OPTIONS='--max-old-space-size=8192'; npx tsc --noEmit -p . --tsBuildInfoFile "$env:TEMP/WS-INTEGRATE-20261111/ws-integrate-fix-final.tsbuildinfo"`，更新 itest 後增量重跑仍為 30。原始比較見 `tsc-current-comparison.json`。

## 邊界與交接

新資料表／SQL：無。未連開發庫／正式庫，未呼叫真 LINE／Ragic，未讀 `.env`，未 push／Publish／部署。中樞 end-to-end 為其既有 stub 測試，不代表正式 Telegram 或遠端監控驗收。一次唯讀交叉檢查未發現 P1 實作缺陷；最終完整測試與原始計數由 root 負責。

待負責人決定：夜間 instance 未醒時，`/api/health*` 不觸發補跑，`errors.purge` 可能亮紅。按工單只記錄，不修改此設計取捨。

收尾：完成驗證後，工作區與基準副本兩個 junction 各以 `cmd /c rmdir <絕對路徑>` 一次拆除，兩次均 exit 0；fresh `cleanup.json` 確認連結不存在，共用依賴與工作區起始的實體依賴備份均保留。兩位執行 Agent 已 completed；本任務 runner 皆已退出，按工作區／證據路徑與兩個拋棄 PG cluster 名稱核對的存活程序為 0。未開瀏覽器或其他背景服務。

保留的環境差異：執行期間出現的 `package-lock.json` 非需求變動已完整保全至 TEMP，再回復起始 blob；沒有提交依賴更動。原始實體依賴備份在 `TEMP/WS-INTEGRATE-20261111/preexisting-node_modules`，不刪未授權內容。報告提交後以 `git status --porcelain` 確認工作樹乾淨。
