# WS-WATCHDOG-ALL-20261111 驗證紀錄

日期：2026-11-11；基底 `0a735744ffeb898011a909bfcfdb0c6e36b811c0`；分支 `boyam01/ws-watchdog-all`。實作快照 `c7e26eb`；最終程式版本 `f060a02`，本文件後續提交僅補驗收收據。原卡 F14、F10 文字與檢查點未改。本紀錄只涵蓋本機合成資料、mock 外部服務及拋棄式 PostgreSQL，不代表正式站驗收。

2026-11-11 整併更新：新診斷表名稱依本輪追加需求統一為 `pipeline_logs`，SQL 檔案路徑仍為 `docs/sql/20261111-app-logs.sql`。下列版本、測試數字及 FAIL／BLOCKED 均為歷史收據，不代表更名後版本已驗；本輪最新驗證結果見文末追加紀錄。

**交付狀態：功能／自動化驗證通過；最終清理 BLOCKED。** 清理命令在 CreateProcess 階段被拒絕（`rejected: blocked by policy`），未執行。依工單平台拒絕即停，沒有換工具重做刪除。`node_modules` junction 與 `.cache/` 兩個本任務測試 helper 仍保留，因此不宣稱工作樹乾淨或 DONE WHEN 全部達成。

## 結果與驗收對應

- 新增 31 條工作流／伺服器／排程燈號，加上原有 16 條共 47 條；完整清單、訊號與門檻見 [health-pipelines.md](health-pipelines.md)。其他分支的 `push.delivery`、`audit.actor`、`schedule.save`、`clock.never-success` 未重做；日誌查詢接受任意管線 id，報告會依當次管線清單附日誌。
- F14①／③：token 健康 API 與後台登入健康報告呼叫同一 service，附每條最近 24h、最多 20 筆 warn/error；IT 監控新增一個日誌區塊及查詢／載入更多。
- F14②：保留錯誤訊息與 requestId；AI 主因判讀依工單排除。
- F10①：既有 5xx 通用錯誤代碼與 `app_errors` 寫入行為保留；既有錯誤整合測試包含在全套。F10②／③：既有 `/api/admin/errors?requestId=` 保留，新增日誌以時間／管線／等級分頁，顯示 requestId；業務資料關聯仍由 `app_errors.subject` 提供，不複製 request body。
- 健康查詢排除醒來補跑；真 health service 測試確認 47 條、日誌與查詢不新增 `pipeline_logs`／`system_configs`。
- 瀏覽器驗視 `NOT_RUN`：CUA `getState` 回傳原文 `aborted before dispatch`，未提供原因；未換工具重做。React DOM 渲染／查詢／分頁互動另有單元測試，不能代稱瀏覽器驗收。

## 測試與原始證據

原始 stdout／失敗輸出保存在 OS TEMP 下 `WS-WATCHDOG-ALL-20261111/`。使用虛構資料，未讀 `.env`、未呼叫真 LINE／Ragic，未連開發／正式庫。以下最終 gate 結果在完成後填入；歷史失敗保留。

| 檢查 | 基準／首次結果 | 最終結果與證據 |
| --- | --- | --- |
| `npx vitest run`／直接呼叫同一 `vitest.mjs run` | 工單基準 50 檔／370 PASS；首跑 13 檔 FAIL（設定、分層及 CRLF 問題） | 固定f060a02：55檔／534 PASS，`final-unit-utc.log` |
| `TZ=Asia/Taipei` 單元測試 | 審查反例修正後曾55檔／532 PASS；固定版本並行檢查時1個原有靜態掃描5000ms逾時（533 PASS） | 原命令序列確認仍533 PASS／1個原靜態掃描5000ms逾時（errors.test）；兩個FAIL保留。--maxWorkers=1完整55檔／534 PASS；原5000ms門檻／原斷言不變，`final-unit-taipei-one-worker.log` |
| `bash scripts/itest.sh`（Windows 使用已安裝 Git Bash 完整路徑） | 工單基準29檔／306 PASS；本機曾32檔／321 PASS | 固定f060a02：32檔／322 PASS，`final-itest-utc.log` |
| Taipei 新增時間相關 itest | 原 integration config 強制 UTC，另用未提交的暫存 config 選 Asia/Taipei | 3檔／16 PASS，`final-itest-taipei.log`（開始時間15:16，UTC版本為07時） |
| `tsc --noEmit -p . --tsBuildInfoFile <worktree 外專用檔>` | 隔離 base 以 6144MB heap 重跑：30 筆；預設 4GB 曾 OOM | 候選曾31筆（新增itest型別錯誤）；最終30筆、exit2，與隔離基底error TS行集合差異0；`final-tsc.log`／`final-tsc-delta.log` |
| 中樞相容性 | 原始 `contract.rs` 由 TEMP Rust harness 直接引用，讀原始共用範例 | 6/6 PASS：原解析測試＋每條新增 `logs`／`logsError` 後仍通過；`contract.log`；中樞未改 |
| 關鍵突變 | 每次只改一處，序列執行，保存失敗後還原；已先 commit 實作 | 38種最終38/38捕獲，共39次執行；歷史1次存活保留。`mutations.json`、`mutations-r2.json`、`mutations-r3.json`、`mutation-summary.json` 與對應原始 log |

原 integration harness 會對本次 loopback 拋棄式資料庫執行其原有 schema 建置；沒有執行業務庫 `db:push` 或本工單附給開發庫的 SQL。`DATABASE_URL` 只由測試建立虛構 loopback 設定，未讀取既有憑證。

### 修正前／後的直接反例

| 案例 | 修正前實跑輸出 | 修正後 |
| --- | --- | --- |
| 新流程規則 | `flow-red.log`：15 failed / 33 passed（保留更早缺模組失敗） | `flow-green-r3.log`：134 passed；後續含大小寫／理由去敏測試 137 passed |
| 日誌 API／UI | `read-red.log`：4 個新 route 404，另 2 suite 缺模組 | `read-repository-green.log`：36 passed |
| 日誌 buffer | `logging-red.log`：Cannot find module './buffer' | `logging-green.log`：8 passed；`logging-wiring.log`：34 passed |
| 路由大小寫、健康查詢補跑、ALS、quoted secret | `review-red.log`：7 failed / 161 passed | `review-green.log`：168 passed |
| 新燈號理由不含 raw job error | `reason-privacy-red.log`：2 failed / 135 passed | `reason-privacy-green.log`：137 passed |
| 非登入的 `/admin/me` 401 與成功登入不產生誤報日誌 | `login-noise-red.log`：1 failed / 2 passed | `login-noise-green.log`：3 passed |

突變歷史：`catchup-count-start-only` 初次存活（16 tests passed），因 fixture 開始與完成數皆為1。保留原輸出後，新增第二次開始、維持一次完成與一次失敗，原實作9例通過，原突變再測確實失敗；只續跑該項與尚未執行項，沒有改產品計數規則。`success-log-level-red.log` 雖命名RED，實際PASS，因測試載入前已修正，故不計為RED；後以序列 counterfactual 實跑舊錯誤分類取得FAIL（`success-log-level-counterfactual-red.log`），還原後3例PASS（`success-log-level-final-green.log`）。

`read-green.log` 的 mock DB 載入錯誤、`flow-layering-green.log` 的分層失敗、首次 tsc OOM 與候選 31 筆錯誤均保留，未以後續 PASS 覆蓋。Orca 初始 CRLF 契約副本與 incidental package-lock 差異也留有紀錄；原範例回復 Git blob 的 LF，未改契約內容或依賴。

## 改動檔案

| 檔案 | 做什麼／為什麼 |
| --- | --- |
| `server/core/health/flowRules.ts` | 新工作流 registry、路由／job 歸屬及共用純函式燈號；避免逐條重複規則。 |
| `server/core/health/flowRules.test.ts` | 新流程三色、ReadError、待審／重啟例外與理由去敏測試。 |
| `server/core/health/report.ts` | 一行組裝新工作流，保留原管線。 |
| `server/core/health/types.ts` | 定義附加日誌欄位，維持 health-v1 原欄位。 |
| `server/modules/health/flowSignals.ts` | 接上環境排程狀態與只讀 collector。 |
| `server/modules/health/flowSignals.repository.ts` | SELECT 各流程錯誤、待審、啟動、登入、補跑與工作結果。 |
| `server/modules/health/flowSignals.itest.ts` | 真 PG 視窗／邊界／故障隔離與 47 條完整報告接線。 |
| `server/modules/health/healthLogs.ts` | 查詢驗證、穩定游標與每管線近期日誌組裝。 |
| `server/modules/health/healthLogs.repository.ts` | 參數化 SQL、微秒 keyset、每管線最多20筆。 |
| `server/modules/health/healthLogs.test.ts` | 日誌參數、游標、錯誤隔離單元測試。 |
| `server/modules/health/healthLogs.itest.ts` | 真 SQL／HTTP／token／admin-cookie 篩選與分頁測試。 |
| `server/modules/health/health.service.ts` | 收集新訊號並為兩個健康入口附同份日誌。 |
| `server/modules/health/health.routes.ts` | 共用 HEALTH_TOKEN 檢查，新增 health／admin 日誌 API。 |
| `server/modules/health/health.routes.test.ts` | 權限、503／401、查詢與錯誤回應測試。 |
| `server/shared/logging/buffer.ts` | 1000筆總上限、100筆批次、已知格式遮蔽與寫入失敗丟棄／防循環。 |
| `server/shared/logging/buffer.test.ts` | 緩衝、in-flight 上限、遮蔽與遞迴失敗測試。 |
| `server/shared/logging/collector.ts` | 非阻塞 sink、1秒 flush，console 物件省略，不載入 DB。 |
| `server/shared/logging/collector.test.ts` | requestId／管線／物件省略、DB失敗仍成功回應及登入誤報測試。 |
| `server/shared/logging/context.ts` | 隔離 HTTP／job 的管線 ALS。 |
| `server/shared/logging/requestLogging.ts` | 依路徑歸管線，只以路徑／狀態記登入拒絕，不記 body/query。 |
| `server/shared/logging/persistence.ts` | 啟動事件與14天保留期服務。 |
| `server/shared/logging/persistence.itest.ts` | 真 pipeline_logs 寫入、job映射與保留期清理。 |
| `server/infra/logs.ts` | 寫入／清理 pipeline_logs 的資料存取。 |
| `server/shared/log.ts` | 接 warn/error 與既有 error log，不重複收補跑事件。 |
| `server/shared/http/errorHandler.ts` | 在既有 requestContext 接管線 ALS，保留原錯誤代碼行為。 |
| `server/shared/health/healthState.ts` | 集中 job 起訖／結果與 integration 失敗日誌。 |
| `server/shared/health/catchUp.ts` | 補跑事件與獨立 context，健康查詢不觸發補跑。 |
| `server/shared/health/catchUp.test.ts` | 健康入口只讀及訪客管線隔離的反例測試。 |
| `server/bootstrap/index.ts` | 啟動共用持久日誌與 startup 事件。 |
| `server/modules/errors/errors.service.ts` | 沿既有 errors.purge 清14天前日誌，維持既有回傳。 |
| `server/modules/system/system.salary.routes.ts` | 手動週出勤通知記最後一次 job 結果。 |
| `shared/schema.ts` | 只新增 pipeline_logs 與兩個索引。 |
| `client/src/components/health-logs.tsx` | 單一日誌清單區塊，管線／時間／等級與載入更多。 |
| `client/src/components/health-logs.test.tsx` | 同份報告嵌入、查詢及分頁互動測試。 |
| `client/src/pages/it-monitor.tsx` | 接入日誌清單，維持原健康頁與刷新行為。 |
| `client/src/pages/it-monitor.test.tsx` | 確認頁面實際渲染報告中的日誌。 |
| `docs/health-pipelines.md` | 全流程盤點、門檻、日誌來源與自由文字呼叫點。 |
| `docs/sql/20261111-app-logs.sql` | 給開發庫另行審閱執行的新增表／索引 SQL，本次未執行。 |
| `docs/health-watchdog-verification.md` | 本工單驗收結果、失敗歷史與交接。 |

既有非 health／logging 業務檔保守計入 `bootstrap/index.ts`、`shared/http/errorHandler.ts`、`system.salary.routes.ts`、`shared/schema.ts` 共4個；`errors.service.ts` 本身是錯誤日誌管理，即使再保守算入仍為5個，沒有超限。其餘既有變更屬 health／logging 或其測試。

## 預設、差異與交接

- Taipei完整unit的預設並行跑與原命令序列重驗分別在layering.test/errors.test的原靜態掃描5000ms逾時；保留 `final-unit-taipei.log`、`final-unit-taipei-sequential.log`。限定再做一次 `--maxWorkers=1` 的整套確認；這是測試檔執行資源差異，沒有改fixture、斷言、timeout或產品設定，PG實際併發檢查保持原樣。

- 待審門檻7天；重啟24h超過3次黃；登入4xx只黃，不把一般未登入 session probe 當登入失敗。ReadError 依工單紅，重啟例外黃。其他門檻沿工單與原規則。
- 約20條擴為31條，因 repo 盤點另有員工、場館、薪資、MCP 等流程；使用同一條共用路由規則，未重構原16條。
- 配合既有 layering gate 新增 repository／infra 檔，未修改 gate 或加例外。
- `/api/health/logs`、`/api/admin/health/logs` 的 since 使用 UTC ISO `Z`；預設50筆，最大100；`level=warn` 包含error，cursor 為不透明 keyset。
- 日誌 DB 寫入失敗直接丟棄；滿載丟最舊尚未送出的項目；程序被強制終止可遺失未 flush 的最後一批。這是非阻塞批次方案的限制，沒有宣稱無損稽核。
- 姓名與任意自由文字仍可能存在於原始字串／Error.message；呼叫點清單在盤點文件。已知格式遮蔽通過不代表所有個資已清除。
- 新資料表／SQL：`pipeline_logs`，僅新增；負責人需在適當資料庫另行執行附帶 SQL，再按既定合併順序整併與部署。本次沒有 push／PR／部署，也未更動監控中樞。
- 最終程式f060a02已測；本文為收據提交，不改程式。原實體依賴保留於TEMP；隔離baseline worktree已移除，共用依賴目標未刪除。最終清理受平台拒絕：main junction與`.cache/ws-watchdog-all-itest-taipei.sh`、`.cache/ws-watchdog-all.itest-taipei.config.ts`仍在，工作樹含`.cache/`未追蹤項目。測試runner均已取得結束碼，兩個執行Agent完成；最後一份OS程序核對命令也未執行，不冒稱已獨立核對程序清零。Obsidian完整回寫專案目標／經驗；遠端同步交既有機制並另行查核。
- 其他四張工單的分支尚未合入本分支，本結果不代表指定合併順序完成後的整合版本已驗收。
- 無新增業務決策；後續由負責人執行SQL、依既定順序整併與部署，並安排瀏覽器／正式站驗收。

## 2026-11-11 追加：獨立診斷日誌表

起始 `8254d48400edd15b42d1800acbfcb7df1361a464`，分支 `boyam01/ws-integrate-fix`。本輪只將診斷表改為 `pipeline_logs`，索引為 `pipeline_logs_pipeline_time_idx`、`pipeline_logs_time_idx`；保留 `appLogs` 變數及所有欄位、資料存取函式與燈號門檻。交付 SQL 仍在 [20261111-app-logs.sql](sql/20261111-app-logs.sql)，僅有建立新表與兩索引的三個 `CREATE IF NOT EXISTS` 敘述，未對開發庫或正式庫執行。

新增 `server/shared/logging/pipelineLogs.legacy.itest.ts`：在 `scripts/itest.sh` 新建的拋棄式 PostgreSQL 中，先於獨立 schema 建立不相容遺留表，再執行交付 SQL。使用真正的 DB module、Drizzle batch 寫入、分頁／附加日誌及 flow 訊號查詢，沒有 mock DB；確認新表 5 筆、兩索引存在、四條日誌管線與啟動次數讀取成功，遺留表維持 0 筆且欄位定義不變。該檔是使用者允許的唯一遺留名稱測試例外。

| 檢查 | 本輪實跑結果 |
| --- | --- |
| 同一份碰撞 itest，改名前 `8254d48` | 1 檔／1 FAIL；原 SQL 在既有異欄表上建立索引時報 `42703: column pipeline does not exist`。 |
| 改名後碰撞與相關 PG 回歸 | 4 檔／17 PASS，exit 0。 |
| `npx vitest run` | 78 檔／816 PASS，exit 0；預設 workers、原 timeout。 |
| `bash scripts/itest.sh` | 39 檔／403 PASS，exit 0；較前版新增 1 檔／1 case。 |
| `TZ=Asia/Taipei` 相關健康 unit | 2 檔／141 PASS，exit 0。 |
| `npx tsc --noEmit -p . --tsBuildInfoFile <worktree 外專屬路徑>`，8GB heap | 30 筆既有診斷，exit 2；與本輪 `8254d48` 基準及前輪保存的 `0a73574` 原始診斷，按檔名／TS code／完整訊息多重集合比對，新增 0／移除 0。 |
| 三個表綁定突變 | Drizzle 寫入、日誌 raw SQL、flow raw SQL 分別改回錯誤來源，三次均被同一碰撞 itest 捕獲並精準還原。 |
| 引用盤點 | server／shared／client 僅新增碰撞 itest 的 6 行 fixture／斷言；全 repo 另兩行是原有遺留說明；SQL 零命中。 |

所有完整命令僅另附 default／JSON reporter 取證，未改測試範圍、timeout 或設定。原始 stdout、JSON、RED、突變、獨立 testcase 重算與 tsc 比較保存在 `C:/Users/ians0/AppData/Local/Temp/WS-INTEGRATE-20261111-LOGNAME/`：`collision-red.log/json`、`collision-and-related-green.log/json`、`vitest-final.log/json`、`itest-final.log/json`、`taipei-health.log/json`、`mutation-*.log/json`、`raw-recount-final.json`、`tsc-comparison.json`。新測試只有使用 `scripts/itest.sh` 真入口的結果算入本紀錄；沒有直接連任意本機資料庫。

既有 `node_modules` junction 依本輪指示保留，由主 Session 收尾。本輪拋棄式 PG 由腳本停止，新增測試的獨立 pool 亦在 `finally` 關閉；未啟動其他背景服務。沒有 push／Publish、沒有改中樞，亦未連開發庫或正式庫。原有歷史失敗與清理 BLOCKED 紀錄保留。
