# 健康管線與工作流訊號

健康入口為 `GET /api/health/pipelines`（health token）與 `GET /api/admin/health`（管理員登入）。報告只讀資料，不會補跑排程、寄信、推播或修改業務資料。`overall` 取全部管線最嚴重的燈號；各管線仍保留自己的理由與來源。

## drilldown-v1

紅／黃管線有可用失敗事件時附選填 `evidence`，依時間新到舊最多 5 筆。一般路由管線取最近 24 小時 `app_errors` 5xx metadata，沿 `pipelineForPath()` 歸屬，`server.errors` 同時提供全站 5xx；路由樣板共用 errors-v1 的 `routeTemplate()`。登入、手動週出勤通知另沿既有非 HTTP `pipeline_logs` warn/error 訊號；排程／同步等管線可讀既有 warn/error、job/integration 的 `lastFailureAt`、`schedule.save` 失敗時間；LINE webhook 使用既有事件失敗時間，定位警告另對應 `clock.geolocation`。沒有可自然轉換的事件或綠燈就省略。原 `logs` 保留；`summary` 只用固定文字，不取原始 message、stack 或業務內容。`requestId` 限 1–64 個英數字或 `-`，否則 `null`。

可選設定 `HEALTH_PUBLIC_URL` 為本系統正式 HTTPS 網址。設定有效時，每條管線附一筆 `links`，只用該網址的 origin 組成 `/it-monitor#<pipeline id>`，不傳 query、token 或個資；未設定、非 HTTPS 或含帳密時省略 links。未登入在原網址顯示既有後台登入頁；登入後才讀取監控資料，並捲至對應卡片。

`/api/health/errors` 每筆多選填 `pipeline`；使用同一個 `pipelineForPath()`，對不上回 `null`。health-v1 的 `build`、errors-v1 的 `build`／`release` 共用 `getHealthBuild()`：執行時 `HEALTH_BUILD_LABEL` 優先，其次是 `npm run build` 內嵌的 Git 短 SHA，最後才 `unknown`。沒有 Git 的來源封存檔仍可建置；既有錯誤表沒有歷史版本欄位，`release` 表示目前執行版本。

`server/core/health/flowRules.ts` 定義工作流、路由歸屬與純函式判斷；`server/modules/health/flowSignals.repository.ts` 執行資料庫 SELECT；`flowSignals.ts` 加入目前環境是否執行排程。日誌可直接使用純函式 `pipelineForPath(path)`、`pipelineForJob(job)`，不需載入健康 service 或資料庫。

健康路由不觸發醒來補跑；`catchUpMissedRuns` 排除 `/api/health`、`/api/admin/health` 及其子路徑（不分大小寫），以維持查詢只讀。路由日誌映射同樣不分大小寫，與 Express 預設相同。補跑有自己的 `scheduler.catch-up` logging context，不繼承訪客流程。

## HTTP 工作流

下表每條管線都讀 `app_errors` 的路由 5xx：1 小時內有錯為紅，只有 24 小時內較舊錯誤為黃，24 小時內沒有錯誤為綠。時間窗包含起訖端點，排除未來時間；4xx 不計為伺服器錯誤。路由先去除 query，再按最長、完整路徑段前綴歸屬，例如 `/api/employees/1` 屬員工管理，`/api/employees-private` 不屬於它。

綠燈表示觀察期間沒有該路由的 5xx，不代表已有使用量、所有業務結果正確或外部服務已驗通。資料讀取拋錯為該訊號所屬管線的紅燈，回報固定訊息，不帶 SQL、連線字串或原始例外。共用 `app_errors` 讀取失敗會影響所有使用此來源的 HTTP 工作流；其他來源繼續讀取。

| id | 工作流與主要路徑 | 額外訊號 |
| --- | --- | --- |
| `clock.amendment` | 補打卡申請、審核；`/api/clock-amendments`、`/api/portal/clock-amendment(s)`、`amendment-eligible-dates` | `clock_amendments` 待審超過 7 天筆數 |
| `leave.request` | 請假申請、審核、餘額；`/api/leave-requests`、`/api/leave-balances`、portal 的 leave 入口 | `leave_requests` 待審超過 7 天筆數 |
| `overtime.request` | 加班申請、審核；`/api/overtime-requests`、portal 的 overtime 入口 | `overtime_requests` 待審超過 7 天筆數 |
| `availability.submit` | 排班意願填報與查詢；`/api/availabilities`、portal availability、monthly-holidays | — |
| `dispatch.manage` | 派遣班次及取消班次；`/api/dispatch-shifts`、`dispatch-shifts-cancelled` | — |
| `anomaly.report` | 異常回報、處理；`/api/anomaly-report(s)` | — |
| `guideline.ack` | 工作須知、簽收；`/api/guidelines`、`/api/guideline-ack`、portal guidelines、acknowledge-all | — |
| `attendance.import` | 出勤匯入、紀錄、刪除；`/api/attendance-upload(s)`、`/api/attendance-records` | — |
| `summer.schedule` | 暑假排班、課程匯入、發布、意願；`/api/schedule`、admin summer、schedule-assignments、manual-schedule-courses、portal summer 入口 | — |
| `portal.login` | 員工登入；portal line-callback、verify、dev-login、dev-employees | 對應 `pipeline_logs` warn/error 驗證失敗；24 小時內只黃，路由 5xx 仍照共用規則 |
| `portal.read` | 員工班表、出勤、同事、外出；portal my-shifts、shifts、my-attendance、workmates、upcoming-coworkers、outing-record(s) 與 `/api/outing-records` | — |
| `admin.login` | 管理員 login、dev-login、me、logout | 對應 `pipeline_logs` warn/error 驗證失敗；24 小時內只黃，路由 5xx 仍照共用規則 |
| `employee.manage` | 員工管理；`/api/employees`、`/api/employees-all` | — |
| `venue.manage` | 場館與地區；`/api/venues`、`venues-all`、`regions`、portal region-hours | — |
| `system.config` | 系統設定、薪資費率；`/api/system-config`、`/api/salary-rates` | — |
| `payroll.report` | 薪資報表與匯出、四週合規；`/api/salary-report`、`/api/four-week-compliance` | — |
| `notification.manage` | 通知收件人、測試信；`/api/notification-recipients`、`/api/test-email` | — |
| `announcement.manage` | 公告與待辦；`/api/announcements`、`/api/pending-counts` | — |
| `mcp` | MCP HTTP 入口；`/mcp` | — |
| `internal.api` | 內部查詢與匯出；`/api/internal` | 手動觸發週班表的子路徑歸既有 `push.weekly-schedule` |
| `schedule.slots` | 排班時段、需求、範本；`/api/schedule-slots`、`venue-requirements`、`venue-shift-templates` | — |
| `shift.manage` | 一般班次新增、修改、刪除、批次、複製、取消與恢復；`/api/shifts`、`shifts-cancelled` | — |
| `clock.records` | 打卡紀錄、報表、原因補登；`/api/clock-records`、`/api/reports/clock-records`、`/api/reports/anomalies`、portal clock-records | — |
| `clock.entry` | LIFF 打卡入口；`/api/liff/clock-in` | — |
| `manual.weekly-attendance` | 每週出勤報表及手動通知；`/api/weekly-attendance` | 最後一次 job 結果、同管線 `pipeline_logs` error |
| `line.webhook` | LINE webhook；`/api/line/webhook` | `line_webhook_events.status='failed'` 的 1h/24h 筆數 |
| `errors.browse` | 管理員錯誤紀錄查詢；`/api/admin/errors` | — |

待審條件為 `status='pending'` 且 `created_at < now - 7 天`，恰好 7 天不計入；有積壓只黃並顯示筆數。待審資料讀取失敗仍紅。LINE 事件使用 `processed_at`，缺少時使用 `received_at`；只計 failed，不把已成功事件算入失敗。

每週出勤沒有固定排程：未執行過為綠，最近一次 job 失敗為黃，後續成功恢復綠。通知 service 可能捕捉寄信失敗後繼續回傳，因此還會讀同管線 error 日誌，1 小時內紅、24 小時內黃；job success 不會蓋掉這項失敗。這裡不會重送通知。

## 伺服器與排程

| id | 來源 | 綠／黃／紅 |
| --- | --- | --- |
| `server.errors` | 全站 `app_errors` 5xx，包含未歸屬路由 | 24h 無錯綠；24h 較舊錯黃；15 分鐘內錯紅 |
| `server.restarts` | `pipeline_logs` 的 `pipeline='server.restarts'`、`level='info'`、`message='server.started'` | 24h ≤3 次綠；>3 次黃；讀取失敗黃；不會紅 |
| `scheduler.catch-up` | `pipeline_logs` 的同名 pipeline；`catch-up.started` 計次，error 計失敗 | 無失敗綠；24h 較舊失敗黃；1h 失敗紅；顯示24h補跑次數 |
| `errors.purge` | `system_configs['health:job:errors.purge']` | 每天台北04:00、30分鐘寬限；最近應執行輪次成功綠；無紀錄或本環境不跑排程黃；應跑未成功／失敗紅 |

`server.restarts` 計算持久化啟動事件，涵蓋多個執行個體，不從單一程序的 uptime 推估。`catch-up.completed` 不再多算一次補跑；計次僅表示嘗試次數，不等於每次成功，也不表示有新通知送達。日期欄位為 UTC 的無時區 timestamp 時，查詢明確用 `AT TIME ZONE 'UTC'`；`app_errors.occurred_at` 則使用 timestamptz。

## 既有管線與擴充邊界

既有 Ragic 員工同步、H01 webhook、手動場館同步、五項通知排程、LINE/mail/Ragic/enrollment 整合、打卡覆蓋、資料庫、假日表與安全設定，繼續由 `report.ts` 與 `rules.ts` 組裝。Ragic 與手動通知觸發路由會歸屬原管線 id。`pipelineForJob('ragic.sync')` 回傳 `ragic.employee-sync`，`ragic.webhook` 回傳 `ragic.h01-webhook`，其餘保留 job id。

健康本身的四個報告／日誌查詢入口不另設業務管線，其 5xx 仍計入 `server.errors`。推播逐筆投遞、audit actor、班表保存證據及打卡從未成功等進階業務規則應各自使用其獨立訊號；路由無5xx不能代替它們的業務驗收。

## 驗證入口

- 純函式：`node node_modules/vitest/vitest.mjs run server/core/health/flowRules.test.ts`。每個 HTTP 工作流都有獨立綠／黃／紅案例，另驗待審、登入、讀取失敗、重啟不紅與排程結果。
- 真實 PostgreSQL：由既有本機 throwaway 測試環境設定 `TEST_DATABASE_URL` 後，執行 `node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts server/modules/health/flowSignals.itest.ts`。涵蓋1h/15m/24h端點、嚴格>7天、啟動與補跑計次、登入warn、LINE事件、吞錯日誌、SELECT-only及單一來源失敗隔離。

測試只允許 loopback throwaway PostgreSQL，沿用 integration harness 的對外網路封鎖；不得指向開發或正式庫，也不需要真實 LINE、Ragic 或郵件呼叫。

## 日誌自由文字盤點與限制

以下為原始碼呼叫點盤點，只列位置與種類，不複製實際內容。搜尋包含 console/log 的 `.name`、`employee.name`、`err.message`、回應 `.text()` 與 `JSON.stringify`，並查看同呼叫的物件／Error參數。

- 外部回應原文：`server/adapters/line.ts:28` 的 `resp.text()`；`server/modules/portal/portal.service.ts:230` 的 `tokenRes.text()`。字串可能含上游自行提供的自由文字。
- 序列化與物件：`server/modules/summerSchedule/summerSchedule.service.ts:580` 的 `JSON.stringify(rawVenueSample)`；`server/modules/ragic/ragic.service.ts:91` 的 `result.skipReasons`；`server/bootstrap/scheduler.ts:95` 的錯誤字串陣列合併。
- 名稱插值：`server/modules/line/linePush.service.ts:450` 的 `venueName`；`server/bootstrap/seed.ts:81` 的 `r.name`；`server/bootstrap/dataMigrations.ts:61` 的 `migration.name`。本次未找到直接把 `employee.name` 放進 console/log 的呼叫；該欄位另用於通知正文，不能把正文送進日誌。
- 自由文字錯誤：`server/bootstrap/scheduler.ts:98`、`:112`、`:134`、`:157`、`:180`、`:207`、`:230`、`:247`，`server/modules/ragic/ragic.service.ts:77`、`:136`，`server/shared/health/healthState.ts:36`，以及 `server/bootstrap/migrations.ts:233` 起各 migration catch 的 `err.message`。
- Error／錯誤字串參數：`server/modules/system/system.service.ts:597`、`:604`；`server/modules/line/lineWebhook.service.ts:183`；`server/modules/mcp/mcp.routes.ts:269`；`server/modules/errors/errors.service.ts:42`；`server/modules/health/health.routes.ts:57`。anomaly、importExport、portal.outing、liff、notification 的 route catch 也會記 Error；`server/shared/http/errorHandler.ts` 會處理原始 message/stack。

一般 info 保持在既有 stdout，只有明確的結構事件持久化；console 物件參數以 `[object omitted]` 記錄，Error 僅取 message。已知秘密格式可遮蔽，但任意姓名、原因、備註及上游自由文字無法可靠自動辨識；字串或 Error.message 仍可能含這些內容，不能宣稱完整個資去敏。普通 info 不進 `pipeline_logs` 也不表示 stdout 已去敏。此工作流盤點不修改上述業務日誌呼叫，也不以遮蔽測試宣稱任意自由文字安全；健康 collector 只回傳數量、時間與固定讀取失敗訊息。
