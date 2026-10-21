# 暑假班表系統 架構書（Architecture Document）

> 版本標記：v40　｜　文件日期：2026-06-24（**已含 2026-06-24 儲存/UI 重構**）
> 對象頁面：`/admin/summer-schedule-v40.html`
> 行號為重構後之**近似值**（頁面持續編輯中可能微移）；請以**函式名**為主要定位。

---

## 0. 變更紀錄（2026-06-24 重構）

本次重構解決兩個生產問題（資料像外部快取、republish 失敗、輸入後「跳掉」）並調整入口 UI。重點：

1. **儲存改為「資料庫為唯一真實來源」（DB single source of truth）。** 新增 in-memory 權威狀態 `scheduleState`（每週 `cells`/`meta`）；畫面一律從它映射，`localStorage` 降為**離線備援**。詳見 §5、§6。
2. **修「跳掉」。** 8 秒輪詢不再用陳舊資料覆蓋 localStorage 再重繪；改為：有未存編輯／正在輸入／剛編輯過時**不套遠端、不重繪**，只在安全時重繪。
3. **發布改 DB 驅動。** 前端只送 `{weekNo}`，後端讀母表 `summer_schedule_assignments.shiftEntries` 發布 → republish 與已存內容永遠一致。
4. **入口 UI：先選館別 → 四部位。** `render()` 仍建構**全部館別**（避免存檔/發布漏館），改用 CSS `body[data-venue-view]` 只顯示選定館別。四部位＝`duty`（櫃台/救生）、`course`（平日）、`holiday`（假日）、`manual`（手動+外部）。
5. **櫃台改成像救生的「輸入框」**（`frontdesk-source` + `renderFrontdesks`，自動展開到時段表）。**手動課程區下新增唯讀「外部課程」表**（報名 feed）。

> ⚠️ 仍未解決的結構特性（技術債，見 §8）：整週存成單一 JSONB blob（last-writer-wins、無逐格合併）；published shift 與來源僅靠 notes 文字標記連結；無 DB-level FK；`version`/`v40` 與 2026 週次硬編；前端無自動化測試。

---

## 1. 系統概觀

**暑假班表系統（三館排班表）** 是台灣 PT 排班管理系統底下的一個子系統，供管理員建置、驗證並發布 **2026 年暑假（9 週，2026-07-01 至 2026-08-30）三個場館** 的班表。三館＝**新北高中、三重商工、三民高中**。

- **線上網址：** `https://smart-schedule-manager.replit.app/admin/summer-schedule-v40.html`
- **使用者：** 管理員（admin）。員工透過 React 員工 portal 查看被發布的班表與填報可排班時段。

**核心：** 管理員先選「週次 + 館別」，再於四個部位排人員：櫃台/救生（皆輸入式，自動展開）、平日課程、假日游泳課、本週手動課程（含外部課程唯讀對照）。頁面驗證人數上下限、標示衝突與缺口、估薪、提供手機檢視，可發布到員工 LINE portal。

**與主 React SPA 的關係：這是「獨立自包含靜態頁」，不是 SPA 的一部分。** React build 不 import/嵌入/route 到此檔；唯一連結是側欄 `app-sidebar.tsx` 一個 `external:true` 外連結（新分頁開）。**兩 UI 的耦合點是資料庫，不是前端：** 此頁「寫入」班表（發布到共用 `shifts` 表），員工 portal「讀回」。

---

## 2. 部署與服務方式

### 服務機制（dev vs prod）
同一個 URL，在兩種環境由**兩個實體來源**提供：

| 環境 | 服務者 | 實體來源檔案 |
|---|---|---|
| 開發（`npm run dev`） | Vite middleware（`server/vite.ts`） | `client/public/admin/summer-schedule-v40.html` |
| 正式（live） | `express.static`（`server/static.ts`，serve `dist/public`） | `dist/public/admin/summer-schedule-v40.html` |

切換在 `server/bootstrap/viteOrStatic.ts`：`NODE_ENV==='production'` → `serveStatic`，否則 `setupVite`。

### dist/public 是 build artifact —— 重要警告
- **務必編輯來源檔 `client/public/admin/summer-schedule-v40.html`。**
- **絕對不要編輯 `dist/public/admin/summer-schedule-v40.html`** —— 由 `vite build`（publicDir 預設）自動複製，每次 build 覆寫。
- **開發：** 編輯後重新整理瀏覽器即可（publicDir 靜態檔不 HMR，需手動 refresh）。
- **正式：需 rebuild + redeploy。** `npm run build`（或 Replit 重新發布）才會把更新複製進 `dist/public`。**只改 `client/public` 不會改變 live 頁面。**

---

## 3. 前端頁面結構（summer-schedule-v40.html）

整支約 **3646 行**，完全自包含：inline `<style>` ≈ L7-650；`<body>` ≈ L650-1040；inline `<script>` ≈ L1041-3645。**無任何外部 CDN/字型/script。**

### 主要 UI 區塊
- **頂部列／全域動作：** `h1`、`#syncStatus`、按鈕（清除離線備份 `clearStorage`、複製上週、檢查 API、立即儲存 `saveToServer`、發布員工前台 `publishToEmployeePortal`、列印）；`#weekSelect`、`#venueFilter`。
- **View tabs：** `#tabSchedule`/`#tabAvailability`/`#tabPayroll`/`#tabMobile`（`showView()`）。
- **先選館別列（新）：** `#scheduleView` 內 `.venue-bar` 的 `.venue-pill[data-venue-pill]`（呼叫 `selectVenueView`）。
- **Schedule tools：** issue panel、LINE push check、Replit status、filter-tools（畫面模式、顯示區塊四部位 pill `setSectionView`、快速篩選）。
- **Schedule view `#venueList`：** `render()` 為每個館別填一張 `.venue-card`（**一律全部三館**）。
- **次要分頁：** Availability（員工問卷+已填/缺口）、Payroll、Mobile、員工挑選 modal `#employeePickerModal`。

### JS 模組／函式（以函式名定位）

**儲存核心（DB 權威，2026-06-24 新增/改寫）：**
- `scheduleState`（約 L1143）：`{weekNo, cells:Map<cellKey,value>, meta:Map<cellKey,employee[]>, loaded, updatedAt}` —— **目前週的權威記憶體狀態**。
- `setCellValue(key,value,opts)`（約 L1163）：寫 state（權威）→ 鏡像 localStorage（備援）→ 視需要 `markDirty`。`opts.dirty===false` 用於衍生/載入正規化。
- `getSaved(key)`（約 L1341）：`loaded` 後**只認 state**；未載入才退回 localStorage（含 v39 legacy）。`getEmployeeMeta`/`saveEmployeeMeta` 同理走 `scheduleState.meta`。
- `markDirty`/`hasUnsavedChanges`/`isEditingFocused`/`isSafeToRerender`/`resetScheduleState`/`currentWeekNo`/`nowHm`（約 L1150-1175）。
- `loadExistingScheduleAssignments`（約 L2816）：每週**冪等**從 DB `rawEntries` 水合 `scheduleState`，DB 空時呼叫 `migrateLocalWeekIntoState` 把本機草稿遷進 state 並 `saveToServer` 推進 DB。
- `saveToServer`（約 L2495）：flush DOM→state → `collectSchedulePayload`（rawEntries 由 **state** 蒐集，涵蓋未顯示館別）→ POST；含 backoff 重試與 dirty flag。
- `scheduleAutoSave`（900ms debounce）、`bindAutoSave`（input→`setCellValue`）、`startSyncPolling`（約 L2537，8s；未存/聚焦/剛編輯→不套遠端，安全才重繪）。
- 協調 flag：`_isApplyingRemote`/`_isSaving`/`_lastEditTime`/`_lastServerUpdatedAt`/`_dirty`/`_saveRetryTimer`。

**版面建構（template-string）：**
- `render()`（約 L2488，唯一 re-render 進入點；**一律建構全部館別** + `applyVenueView()`）。
- 四部位：`buildDutySection`（約 L1537，內含 `buildFrontdeskInputs` + `buildLifeguardInputs` + duty 表）、`buildCourseSection`、`buildHolidayCourseSection`、`buildManualCourseSection`（含外部課程容器）。
- **櫃台輸入式（新）：** `frontdeskSourceKey`、`buildFrontdeskInputs`（約 L1535，`.frontdesk-source` `data-role="frontdesk-source"`）、`buildDutyRows`（櫃台/救生皆為唯讀 `*-display` 格）、`allFrontdeskShifts`、`renderFrontdesks`（約 L1875，鏡像 `renderLifeguards`）。
- **先選館別（新）：** `applyVenueView`（約 L2465，設 `body[data-venue-view]`）、`selectVenueView`。
- **外部課程（新）：** `externalCourseData`/`externalCourseLoaded`、`renderExternalCourses`（約 L2168，唯讀，依館別+週次過濾報名 feed）。

**解析/計數/驗證/衝突：** `parseShiftLines`、`parseAssignments`、`countWeekday/Single`、`validateCourseCell`、`renderFrontdesks`/`renderLifeguards`、`applyAllWorkConflicts`/`applyConflictWarnings`、`extractFrontdeskEntries`（已改為來源輸入框模型）、`collectCurrentIssues`/`updateIssueSummary`。
**手動課程 CRUD：** `loadManualCoursesForWeek`(GET)、`addManualCourseFromForm`(POST，含「非當週」提示與 venueName 強制對齊)、`updateManualCourseField`→`queueManualCoursePatch`(PATCH)、`deleteManualCourse`(DELETE)。
**報名整合：** `loadEnrollmentCounts`/`applyEnrollmentCounts`（同時餵 `renderExternalCourses`）/`applyZeroEnrollmentRows`。
**Payload/發布：** `collectNormalizedAssignments`、`collectShiftRowsForPortal`、`collectSchedulePayload`、`publishToEmployeePortal`（約 L2756，發布前強制存檔成功、只送 `{weekNo}`）。
**Boot：** `bootSummerScheduleV40`（DOMContentLoaded；`ensureAdminLoggedIn` → 預設選第一館 → `loadEmployeesForSchedule` → `render` → `startSyncPolling`；切週前先 flush+重置 state，切館只切 CSS 視圖）。

### Rendering 方式
`render()` 重建 `#venueList.innerHTML`。儲存格文字由 `getSaved`（**讀 `scheduleState`**，未載入才退 localStorage）水合。班表內容不在 HTML body 內，由 JS 動態產生。

---

## 4. 後端 API

| Method | Path | Handler / Service | Auth | 觸及的表 | 用途 |
|---|---|---|---|---|---|
| POST | `/api/admin/login`、GET `/api/admin/me`、POST `/logout`、`/dev-login` | `admin.routes.ts` | 公開（gate 前） | employees | 登入/檢查/登出；`dev-login` 沙盒免密（部署停用） |
| GET | `/api/admin/summer-employees` | `service.getEmployeesForSchedule` | `requireAdmin` | employees、venues | 列在職員工（line-bound 優先）。回 `{items:[...]}` |
| GET | `/api/schedule/enrollment-counts?weekNo=N` | `service.getEnrollmentCounts` | `requireAdmin` | （外部 enrollment API） | 各館/課/時段報名人數；**亦驅動外部課程唯讀區** |
| GET | `/api/admin/schedule-assignments?weekNo=N` | `service.getScheduleAssignments` | `requireAdmin` | `summer_schedule_assignments` | 讀母表（`rawEntries`/`assignments`/`shiftEntries`，回應 `shiftEntries`→`shifts`）。**前端載入/輪詢以此水合 `scheduleState`** |
| POST | `/api/admin/schedule-assignments` | `service.saveScheduleAssignments` | `requireAdmin` | `summer_schedule_assignments` | upsert 某週（unique `version+weekNo`）。**這是唯一真實來源的寫入點** |
| GET/POST/PATCH/DELETE | `/api/admin/manual-schedule-courses[/:id]` | `service.*ManualCourse(s)` | `requireAdmin` | `manual_schedule_courses` | 手動課程 CRUD（軟刪除）。**本身已是 DB 權威，未納入 `scheduleState`** |
| POST | `/api/admin/summer-schedule/publish-shifts` | `service.publishShifts` → `applyPublish` | `requireAdmin` | `shifts`、`shift_audit_log` | **DB 驅動發布（改）：** 新版只送 `{weekNo}` → 服務端讀母表 `shiftEntries`；舊版帶 `{shifts:[...]}` 仍相容。刪該週 `%暑假排班v40%` 舊班（軟取消+audit）再插新班（notes 標記 `暑假排班v40｜weekNo=N`，role 預設 `教練`，缺欄位略過） |
| GET | `/api/portal/my-summer-shifts/:weekNo` | `service.getMySummerShifts` | **LINE-ID** | `shifts`、venues | 員工 LIFF 讀自己某週已發布班（filter notes 含 `暑假排班v40`） |
| GET/POST | `/api/portal/summer-availability[/:weekNo]` | `summerAvailabilityRepository` | **LINE-ID** | `summer_availabilities` | 員工填報可排班（React portal 用） |
| USE | 全域 gate `/api/*`（除 `OPEN_API_PREFIXES`） | `gateAdminApi` | — | — | 非白名單一律檢查 `session.adminId`。`/api/portal/` 在白名單；`/api/admin/` 刻意不在 |

> `server/modules/summerSchedule/summerSchedule.service.ts` 的私有 `applyPublish(week, weekNo, incoming)` 先整批檢查新班次，有任何一筆不合格就回 422、不動舊班；全部合格才軟取消舊班再新增。`publishShifts` 在無 `payload.shifts` 時自動讀母表 `shiftEntries`。`publishShiftsFromSaved(weekNo)` 沒有任何路由呼叫。

---

## 5. 資料模型

來源：`shared/schema.ts`（Drizzle/PostgreSQL）。**三張專屬表 + 共用核心表。所有整數參照欄皆為「邏輯 FK」，schema 無任何 DB-level FK 約束。**

### 母資料表（單一真實來源）
**`summer_schedule_assignments`** —— 每 `version+week` 一列：
- `rawEntries` jsonb：**每格資料的權威儲存**，`[{key, value, employees[]}]`（`key`＝前端 `cellKey`/`sourceKey`；`employees`＝員工指派 meta）。前端 `scheduleState.cells`/`meta` 即由它水合；存檔時由 `scheduleState` 蒐集寫回（涵蓋未顯示館別）。
- `assignments` jsonb：正規化後的指派（衍生）。
- `shiftEntries` jsonb（回應改名 `shifts`）：**待發布的 shift 列；DB 驅動發布即讀此欄。**
- UNIQUE `(version, weekNo)`；手動 select-then-update/insert。

> **localStorage 角色已降級為離線備援**（鏡像鍵 `schedule-v40-{cellKey}`、`schedule-v40-employee-meta-{cellKey}`）。`getSaved` 在 `scheduleState.loaded` 後不再回讀 localStorage，避免陳舊值復活造成分歧。首次載入若 DB 空、本機有舊草稿，`migrateLocalWeekIntoState` 會把它（含 v39 legacy）遷進 state 並推進 DB。

**`manual_schedule_courses`** —— 管理員手動課程（需配教練）。**已是 DB 權威（CRUD API），不走 `scheduleState`**；惟「教練格」屬 assignment 格（key `…-manual-{id}-coach`）走 state。

**`summer_availabilities`** —— 每員工每週可排班填報（UNIQUE `(employeeId, weekNo)`，onConflict upsert）。DB 權威，summer 頁只消費此表。

### 共用核心表
- **`shifts`** —— 共用具體班表（發布目標）。`role` 預設 `救生`（summer 發布覆寫為 `教練`）；**`notes` 承載 summer 標記 `暑假排班v40｜weekNo=N`**，發布時 LIKE 比對；無 DB unique。
- **`employees`**（`lineId` 為 portal 辨識）／**`venues`**（`shortName`；內部 venueId 與外部 enrollment id 不同，service 以 `EXTERNAL_VENUE_ID_MAP {1→1,3→2,4→3}` 轉換）／**`regions`**。
- `shift_audit_log`（發布以 actor `summer-schedule-publish` 寫入）。

### 一筆 shift 如何被 key
功能上以 `employeeId+venueId+date+startTime+endTime+role` 辨識；**summer 來源辨識完全靠 `shifts.notes` 內的自由文字標記 + 週日期範圍**，無 column-level link 連回母表。週次（1-9）對應日期只存在程式常數 `SUMMER_WEEKS`（service.ts）。

---

## 6. 資料流（端到端，DB 權威版）

1. **BOOT（`bootSummerScheduleV40`）：** `ensureAdminLoggedIn`（`GET /api/admin/me`）→ 非 ok 即換成登入畫面停止 → `purgeLegacyStorageOnce` → `initWeeks` → **預設選第一館** → `await loadEmployeesForSchedule` → `render()` → `startSyncPolling`。

2. **LOAD/RENDER（`render()`）：** **一律建構全部三館**的 `.venue-card`（`buildDutySection`＝櫃台/救生輸入式+時段表、`buildCourseSection`、`buildHolidayCourseSection`、`buildManualCourseSection`+外部課程容器）→ `applyVenueView()` 以 CSS 只顯示選定館別。儲存格由 `getSaved`（讀 `scheduleState`）水合。接著 `bindAutoSave`、`validateAll`（含 `renderFrontdesks`/`renderLifeguards`）、`loadEnrollmentCounts`（→`applyEnrollmentCounts`→`renderExternalCourses`）、`loadManualCoursesForWeek`、`loadExistingScheduleAssignments`（**每週冪等水合 `scheduleState`**）。

3. **EDIT：** input → `bindAutoSave` → `setCellValue`（**state 權威** + localStorage 備援 + `markDirty`）→ `refreshEmployeeChips` → `validateAll` → `scheduleAutoSave`(900ms)。櫃台/救生改在上方輸入框輸入，`renderFrontdesks`/`renderLifeguards` 解析後填入唯讀時段格。手動課程欄走 `updateManualCourseField`→`queueManualCoursePatch`(700ms PATCH)。員工挑選 modal 同樣寫 state。

4. **SAVE（`saveToServer`）：** flush DOM→state → `collectSchedulePayload`（rawEntries 由 **state** 蒐集）→ `POST /api/admin/schedule-assignments` → 成功清 dirty、記 `_lastServerUpdatedAt`；失敗 backoff 重試。

5. **SYNC POLL（`startSyncPolling`，8s）：** **未存/聚焦/剛編輯（<5s）→ 跳過**；遠端 `updatedAt` 較新且同週才整批套用進 `scheduleState`（包 `_isApplyingRemote`），**只在 `isSafeToRerender()` 時 render**（防「跳掉」）。

6. **PUBLISH（`publishToEmployeePortal`）：** 先確保已成功存檔（dirty 則 `await saveToServer`，仍失敗則中止）→ 預檢缺漏（提示用）→ `POST publish-shifts {weekNo}` → 後端讀母表 `shiftEntries` 經 `applyPublish` 刪舊插新。**republish 永遠與已存內容一致。**

7. **員工讀回（React portal）：** `GET /api/portal/my-summer-shifts/:weekNo`（`x-line-user-id`）→ filter notes 含 `暑假排班v40` → `SummerShiftCard` 呈現。

---

## 7. 動刀指引（要改哪裡）

### 改儲存／同步行為（最敏感）
- **唯一真實來源是 `scheduleState`**；任何「寫一格」一律走 `setCellValue`，「讀一格」走 `getSaved`。新增寫入點務必同步 state（否則存檔漏資料）。
- 員工 meta 走 `getEmployeeMeta`/`saveEmployeeMeta`（`scheduleState.meta`）。**只改格子文字不改 meta → republish 會靜默丟掉對不到名字的指派。**
- 動 `render()`/輪詢/autosave 時，注意 flag：`_isApplyingRemote`（遠端套用中，禁止標 dirty/重繪回授）、`_dirty`、`_lastEditTime`/`_lastServerUpdatedAt`、`isSafeToRerender`。破壞守門會重現「跳掉」或存/輪迴圈。
- 切週前要 flush + `resetScheduleState`；切館只切 CSS 視圖（`applyVenueView`），**不要改回「只 render 選定館別」**，否則存檔/發布漏館。

### 改版面／四部位
- 各部位 builder：`buildDutySection`/`buildCourseSection`/`buildHolidayCourseSection`/`buildManualCourseSection`；改完呼叫 `render()`。
- 部位切換靠 body class `section-{all|duty|course|holiday|manual}`（`setSectionView` + CSS）。
- 每格 `data-*`（`data-key`、`data-role`、`data-period`、`data-venue/-venue-id`，課程列另有 `data-course-*`）會被 `collectNormalizedAssignments` 讀取——改 markup 務必保留。
- 櫃台/救生為**來源輸入框**（`data-role="frontdesk-source"`/`lifeguard-source"`）+ 唯讀 display 格（`frontdesk-display`/`lifeguard-display`）；蒐集走 `parseShiftLines`（每行自帶時段）。

### 改/加 API
- 前端 endpoint 集中 `API_ENDPOINTS`；fetch 帶 `credentials:'include'`，維持受保護前綴。
- 後端新增 summer endpoint 在 `summerSchedule.routes.ts`，邏輯放 `summerSchedule.service.ts`；寫 `shifts` 一律走 `storage.createShift/deleteShift`（保 audit+soft-delete），沿用 `暑假排班v40` 標記、`SUMMER_WEEKS`、`normalizeWeekNo`。要開放員工（無 admin cookie）的端點放 `/api/portal/` 並驗 `x-line-user-id`。

### 不要動 / 陷阱
- `manual_schedule_courses`、`summer_availabilities` 已是 DB 權威，勿改走 `scheduleState`。
- 版本字串散落多處需一起改：`LOCAL_STORAGE_PREFIX`/`LEGACY_STORAGE_PREFIX`、`REPLIT_READY_VERSION`、`purgeLegacyStorageOnce` regex。
- 已知 stub（刻意未實作）：`copyPreviousWeek`、`addDutyRow/addCourseRow/addHolidayCourseRow` 目前只 `alert()`。
- 編輯此 HTML 不影響 React bundle；`schedule.tsx` 與 summer 無關，勿動。唯一影響「能否進入」的是 `app-sidebar.tsx` 的側欄外連結。

---

## 8. 風險與未知

### 已解決 / 已釐清（本次）
- ✅ **資料像外部快取、republish 失敗** → DB 為唯一真實來源 + 發布讀母表 `shiftEntries`。
- ✅ **輸入後「跳掉」** → 輪詢不在未存/聚焦/剛編輯時覆蓋重繪。
- ✅ **`publish-shifts` 路徑** → 確認走 live endpoint（DB 驅動），HTML 端過時 fallback 訊息已移除。
- ✅ **存檔漏館** → `render()` 一律建構全部館別 + state 蒐集 rawEntries。

### 仍存在的技術債 / 待評估（重要）
1. **整週存成單一 JSONB blob → last-writer-wins、無逐格合併。** 單一管理員可接受；**多分頁/多管理員同週同編會互蓋**（輪詢 +1000ms skew 只防自我回授，不解決並發）。逐格合併需改 schema。
2. **published shift 與來源僅靠 notes 文字標記。** 改標記文字或編輯 notes 會孤立先前已發布的班。建議評估加結構化欄（`source`/`sourceWeekNo`）。
3. **無 DB-level FK；三種場館 keying 並存**（availabilities 用 shortName、manual/shifts 用內部 venueId、enrollment 用外部 id 經 map 轉換）。
4. **硬編 2026 / `v40`**（`SUMMER_WEEKS`、前端 `weeks[]`、處處 `version='v40'`）→ 未來年度需 data-driven。
5. **櫃台資料模型變更**：櫃台由逐格改輸入框後，**舊的 per-segment 櫃台格資料會被孤立**（仍在 DB rawEntries，但不顯示於新輸入框，需重新輸入）。
6. **前端為 ~3646 行單檔 inline JS、無自動化測試**，靠多個 debounce（900ms autosave / 700ms manual patch / 8s poll）與 render-loop flags 協調 → 易回歸。建議評估抽模組 + 加冒煙測試（本次已用 jsdom 冒煙驗證可作基礎）。
7. **安全面**：靜態 HTML 在 HTTP 層公開（只有 `/api/*` 有 gate），`ensureAdminLoggedIn` 為 client-side 軟性可繞過；`ADMIN_PASSWORD` 明文比對；`SESSION_SECRET` 未設會 fallback。需確認 Replit Secrets。
8. **外部依賴**：`enrollment-counts` 依 `ENROLLMENT_API_URL/KEY`；課名對應依硬編中文映射（`normalizeCourseName`），課名漂移會 silently 綁不上。
9. **dist 是否進版控**：改 `client/public` 後正式站需 rebuild/redeploy 才生效。

### 主要相關檔案
- `client/public/admin/summer-schedule-v40.html`（**唯一要編輯的前端來源**）／`dist/public/...`（**勿編輯**）
- `server/modules/summerSchedule/summerSchedule.{routes,service}.ts`、`summerAvailability.repository.ts`
- `server/modules/portal/portal.summer.routes.ts`、`server/modules/admin/*`、`server/shared/middleware/requireAdmin.ts`、`server/config/openApiPrefixes.ts`
- `shared/schema.ts`、`server/bootstrap/migrations.ts`
- `client/src/components/app-sidebar.tsx`、`client/src/pages/portal.tsx`、`client/src/components/SummerShiftCard.tsx`
