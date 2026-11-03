# 暑假排班 v40 規則覆蓋對照

由 `node scripts/summer-v40/check-rule-coverage.cjs` 產生，不要手改。資料來源是 `rule-coverage.cjs` 與 `client/src/lib/summer/__tests__` 的測試名稱。

規則 242 條：已實作 176、刪除 25、待後續批 41。與 v40 不同的測試 16 個，涵蓋 S23 R010、R020、R057、R062、R066、R074、R129、R131、R134、R163、R168、R190。

## 與 v40 不同的行為

- 與 v40 不同：已排判斷只認完整姓名，「陳美玲」不會擋住排「陳美」（R020）（edits.golden.test.ts）
- 與 v40 不同：缺口排班的顯示名依 lineBound 加上（未綁定）（R010, R021）（edits.golden.test.ts）
- 與 v40 不同：未綁 LINE 但留有 lineDisplayName 的員工會加上（未綁定）（R010, R014）（edits.golden.test.ts）
- 與 v40 不同：保留已存的需教練數，也不寫入報名格（R057, R227）（enrollment-failure.test.ts）
- 與 v40 不同：發布的班次備註不寫未知的報名人數（R057, R108）（enrollment-failure.test.ts）
- 與 v40 不同：依實際需教練數驗證，不再顯示「報名 0 人」（R057, R081）（enrollment-failure.test.ts）
- 與 v40 不同：別週晚到的報名回應不會套到目前週（R062）（rules.test.ts）
- 與 v40 不同：本週沒有填報時清空列表，不留上一週的列（R129）（rules.test.ts）
- 與 v40 不同：多段平日時段一律分行解析，不受頁籤隱藏影響（R131）（rules.test.ts）
- 與 v40 不同：救生與櫃台的已排工作 chip 時間只出現一次（R134）（rules.test.ts）
- 與 v40 不同：費率只讀後端設定，本機舊值不再蓋回（R168）（rules.test.ts）
- 與 v40 不同：顯示名的 LINE 綁定只看 lineBound，不看 lineDisplayName 或 lineUserId（R010）（units.golden.test.ts）
- 與 v40 不同：日期範圍 %s 不因時區前移一天（R066）（units.golden.test.ts）
- 與 v40 不同：正規化保留手動課程的 employeeId / employeeName（R074）（units.golden.test.ts）
- 與 v40 不同：覆蓋總覽的已發布班次沒有 ✕，排班時段裁到營業時間（R190）（views.golden.test.ts）
- 與 v40 不同：姓名模糊篩選時 CSV 匯出畫面上那些列，不再是 0 筆（R163）（views.golden.test.ts）

## 逐條對照

| 規則 | 狀態 | 函式／理由 | 測試檔 |
|---|---|---|---|
| R001 | 已實作 | `WEEKS`、`weekByNo` | units.golden.test.ts |
| R002 | 已實作 | `weekOptions`、`weekPrefix` | rules.test.ts |
| R003 | 已實作 | `hourMinute` | rules.test.ts |
| R004 | 待後續批 B2 | 寫格與 dirty 屬儲存佇列；localStorage 鏡像依 S13 刪除 | |
| R005 | 已實作 | `unwrapApiPayload` | units.golden.test.ts |
| R006 | 已實作 | `extractApiItems` | units.golden.test.ts |
| R007 | 已實作 | `extractApiMeta` | units.golden.test.ts |
| R008 | 待後續批 B2 | 重繪安全判斷屬儲存佇列與輪詢 | |
| R009 | 已實作 | `normalizeEmployee` | units.golden.test.ts |
| R010 | 已實作 | `isLineBound`、`displayNameWithLineStatus` | edits.golden.test.ts、units.golden.test.ts |
| R011 | 已實作 | `displayNameWithLineStatus` | units.golden.test.ts |
| R012 | 已實作 | `cleanEmployeeDisplayName` | units.golden.test.ts |
| R013 | 已實作 | `splitCoachLineParts` | units.golden.test.ts |
| R014 | 已實作 | `normalizeCoachCellText`、`buildWeekModel` | edits.golden.test.ts、payload.golden.test.ts |
| R015 | 已實作 | `EMPLOYEE_MESSAGES` | edits.golden.test.ts |
| R016 | 待後續批 B3 | 由既有 AdminGuard 取代（合約 5.4） | |
| R017 | 已實作 | `employeeLabel`、`lineBadgeText` | units.golden.test.ts |
| R018 | 已實作 | `metaFor`、`findEmployeeForLine` | edits.golden.test.ts |
| R019 | 已實作 | `pickerList`、`sortBoundFirst` | edits.golden.test.ts |
| R020 | 已實作 | `applyPickedEmployee` | edits.golden.test.ts |
| R021 | 已實作 | `applyPickedEmployee` | edits.golden.test.ts |
| R022 | 已實作 | `applyTempCoach` | edits.golden.test.ts |
| R023 | 已實作 | `findEmployeeForLine` | rules.test.ts、validate.golden.test.ts |
| R024 | 刪除 | employeeVenue 在 v40 永遠是空字串，沒有任何輸出用到；改寫不帶這個欄位 | |
| R025 | 已實作 | `parseTimeRange` | units.golden.test.ts |
| R026 | 已實作 | `parseLooseTimeRange` | units.golden.test.ts |
| R027 | 已實作 | `compactTimeLabel` | units.golden.test.ts |
| R028 | 已實作 | `timesOverlap` | units.golden.test.ts |
| R029 | 已實作 | `normalizeName` | units.golden.test.ts |
| R030 | 已實作 | `activeDaysForPeriod`、`dayName`、`dutyPeriodForDay` | units.golden.test.ts |
| R031 | 已實作 | `datesInWeek` | units.golden.test.ts |
| R032 | 已實作 | `usefulLines` | units.golden.test.ts |
| R033 | 刪除 | parseShiftLines 只解析 v40 已不產生的 source 格（呼叫點的元素集合永遠是空的），沒有可觀察行為；S17 | |
| R034 | 已實作 | `roleMarkerFromLine` | units.golden.test.ts |
| R035 | 已實作 | `parseDutyGridLines`、`cleanDutyGridName` | units.golden.test.ts |
| R036 | 已實作 | `splitCoachNames` | units.golden.test.ts |
| R037 | 已實作 | `tokenizeCoachLine` | units.golden.test.ts |
| R038 | 已實作 | `coachRoleOf` | units.golden.test.ts |
| R039 | 已實作 | `parseAssignments`、`resolveAlias` | units.golden.test.ts |
| R040 | 已實作 | `parseAssignments` | units.golden.test.ts |
| R041 | 已實作 | `assignmentIdentity`、`duplicateNames`、`countAssignmentsByDay`、`countDistinctAssignees` | units.golden.test.ts |
| R042 | 已實作 | `dutyRowCount`、`gapAssignment` | edits.golden.test.ts |
| R043 | 已實作 | `slug`、`courseRowId` | course-rows.golden.test.ts、units.golden.test.ts |
| R044 | 已實作 | `venueIdByName` | units.golden.test.ts |
| R045 | 已實作 | `htmlToCellText`、`normalizeCellText` | units.golden.test.ts |
| R046 | 刪除 | S13：草稿只以伺服器水合的 draft 為準，不再退回 localStorage | |
| R047 | 已實作 | `VENUES` | units.golden.test.ts |
| R048 | 已實作 | `coachPlaceholder`、`enrollCellView` | course-rows.golden.test.ts |
| R049 | 已實作 | `normalizeCourseNameForEnrollment` | units.golden.test.ts |
| R050 | 已實作 | `enrollmentKey`、`enrollmentLookupKeys` | units.golden.test.ts |
| R051 | 已實作 | `normalizeEnrollmentItems`、`indexEnrollment` | units.golden.test.ts |
| R052 | 已實作 | `buildWeekModel`、`rowEnrollment` | course-rows.golden.test.ts |
| R053 | 已實作 | `buildWeekModel`、`enrollCellView` | course-rows.golden.test.ts、payload.golden.test.ts |
| R054 | 已實作 | `buildWeekModel`、`enrollCellView` | course-rows.golden.test.ts |
| R055 | 已實作 | `buildWeekModel`、`enrollCellView` | course-rows.golden.test.ts |
| R056 | 已實作 | `buildWeekModel` | course-rows.golden.test.ts、payload.golden.test.ts |
| R057 | 已實作 | `buildWeekModel` | enrollment-failure.test.ts |
| R058 | 已實作 | `buildWeekModel` | rules.test.ts |
| R059 | 已實作 | `enrollmentStatusText`、`formatUpdatedTime` | rules.test.ts、units.golden.test.ts |
| R060 | 已實作 | `externalCourses`、`EXTERNAL_EMPTY_TEXT` | rules.test.ts |
| R061 | 待後續批 B3 | 失敗時沿用上次資料屬查詢層（react-query） | |
| R062 | 已實作 | `buildWeekModel` | rules.test.ts |
| R063 | 已實作 | `isForceOpen`、`FORCE_OPEN_KEYWORDS` | course-rows.golden.test.ts |
| R064 | 已實作 | `buildWeekModel`、`coachPlaceholder` | course-rows.golden.test.ts、payload.golden.test.ts |
| R065 | 已實作 | `parseManualDates` | units.golden.test.ts |
| R066 | 已實作 | `parseManualDates`、`addDays` | units.golden.test.ts |
| R067 | 已實作 | `weekNoForDate`、`dayNoOf`、`formatManualDate` | units.golden.test.ts |
| R068 | 已實作 | `manualCoursesForVenue` | course-rows.golden.test.ts |
| R069 | 待後續批 B4 | 手動課程表單的固定文字與預設值屬畫面 | |
| R070 | 已實作 | `manualCellKey`、`buildWeekModel` | course-rows.golden.test.ts |
| R071 | 已實作 | `validateManualCourseForm` | rules.test.ts |
| R072 | 已實作 | `otherWeeksNotice`、`MANUAL_COURSE_MESSAGES` | rules.test.ts |
| R073 | 已實作 | `applyManualField` | rules.test.ts |
| R074 | 已實作 | `normalizeManualCourse`、`canPatchManualCourse` | rules.test.ts、units.golden.test.ts |
| R075 | 已實作 | `manualCoachSelection` | rules.test.ts |
| R076 | 待後續批 B4 | 刪除流程與確認框屬手動課程 CRUD | |
| R077 | 已實作 | `normalizeManualCourse`、`manualCourseSignature` | rules.test.ts、units.golden.test.ts |
| R078 | 已實作 | `dedupeManualCourses` | rules.test.ts |
| R079 | 待後續批 B3 | 首次顯示時機屬畫面；週模型每次由資料重算，B3 驗證 | |
| R080 | 已實作 | `neededNumber`、`enrollNumber` | validate.golden.test.ts |
| R081 | 已實作 | `validateWeek` | enrollment-failure.test.ts、validate.golden.test.ts |
| R082 | 已實作 | `validateWeek` | validate.golden.test.ts |
| R083 | 已實作 | `validateWeek` | validate.golden.test.ts |
| R084 | 已實作 | `venueRule`、`FRONTDESK_RULE` | units.golden.test.ts |
| R085 | 已實作 | `validateWeek`、`workEntries` | validate.golden.test.ts |
| R086 | 已實作 | `workTypeLabel`、`workLabel` | edits.golden.test.ts |
| R087 | 已實作 | `buildWeekModel`、`workEntries` | rules.test.ts |
| R088 | 已實作 | `validateWeek` | validate.golden.test.ts |
| R089 | 已實作 | `validateWeek`、`venueTextMatches` | edits.golden.test.ts、validate.golden.test.ts |
| R090 | 已實作 | `validateWeek` | course-rows.golden.test.ts、validate.golden.test.ts |
| R091 | 已實作 | `classifyIssue`、`ISSUE_GROUPS` | units.golden.test.ts、validate.golden.test.ts |
| R092 | 已實作 | `validateWeek`、`groupIssues` | validate.golden.test.ts |
| R093 | 刪除 | S03：LINE 推播檢查刪除 | |
| R094 | 已實作 | `validateWeek` | validate.golden.test.ts |
| R095 | 刪除 | S02：模式切換與「只看問題」刪除，遞迴不存在 | |
| R096 | 待後續批 B2 | 存檔流程 | |
| R097 | 已實作 | `blocksEmptySave` | rules.test.ts |
| R098 | 已實作 | `rawEntryHasScheduleValue` | units.golden.test.ts |
| R099 | 待後續批 B2 | 存檔成功處理 | |
| R100 | 待後續批 B2 | 失敗退避 | |
| R101 | 待後續批 B2 | 自動存檔 debounce | |
| R102 | 待後續批 B2 | 輪詢 | |
| R103 | 待後續批 B2 | 輸入綁定改由 React 受控元件處理 | |
| R104 | 已實作 | `rawEntriesFromDraft`、`buildSavePayload` | payload.golden.test.ts |
| R105 | 已實作 | `collectAssignments` | payload.golden.test.ts |
| R106 | 已實作 | `collectAssignments` | payload.golden.test.ts |
| R107 | 已實作 | `collectShiftRows` | payload.golden.test.ts |
| R108 | 已實作 | `notesForShift` | enrollment-failure.test.ts、payload.golden.test.ts、units.golden.test.ts |
| R109 | 已實作 | `isoDateForWeekDay` | payload.golden.test.ts、units.golden.test.ts |
| R110 | 待後續批 B2 | 發布前等佇列清空 | |
| R111 | 待後續批 B5 | 發布預檢與確認框屬頂列 | |
| R112 | 刪除 | S04：檢查 API 刪除 | |
| R113 | 已實作 | `draftFromRawEntries` | rules.test.ts |
| R114 | 刪除 | S13：本機遷移刪除 | |
| R115 | 刪除 | S14：清空按鈕刪除 | |
| R116 | 待後續批 B2 | 切週 | |
| R117 | 刪除 | S12：管理端問卷刪除 | |
| R118 | 刪除 | S12：管理端問卷刪除 | |
| R119 | 刪除 | S12：管理端問卷刪除 | |
| R120 | 刪除 | S12：管理端手動列刪除（原缺陷隨功能消失） | |
| R121 | 刪除 | S12：問卷員工下拉刪除 | |
| R122 | 刪除 | S12：問卷員工資訊框刪除 | |
| R123 | 刪除 | S12：問卷時間列刪除 | |
| R124 | 待後續批 B6 | 頁籤切換屬畫面 | |
| R125 | 待後續批 B6 | S12 後只剩 API 模式，顯示切換屬畫面 | |
| R126 | 已實作 | `availabilityRowsFromApi` | views.golden.test.ts |
| R127 | 已實作 | `availabilityRowsFromApi` | views.golden.test.ts |
| R128 | 已實作 | `availabilityRowsFromApi` | views.golden.test.ts |
| R129 | 已實作 | `availabilityRowsFromApi` | rules.test.ts |
| R130 | 刪除 | S12：手動列刪除 | |
| R131 | 已實作 | `availabilityIntervals` | rules.test.ts |
| R132 | 已實作 | `availabilityIntervals` | views.golden.test.ts |
| R133 | 已實作 | `subtractIntervals`、`availabilityReport` | edits.golden.test.ts、views.golden.test.ts |
| R134 | 已實作 | `availabilityReport`、`busyLabel` | rules.test.ts、views.golden.test.ts |
| R135 | 已實作 | `busyLabel` | views.golden.test.ts |
| R136 | 已實作 | `priceRows`、`rateFor` | views.golden.test.ts |
| R137 | 已實作 | `priceRows`、`hourlyRates` | views.golden.test.ts |
| R138 | 已實作 | `withCoachRate`、`withMultipliers` | rules.test.ts |
| R139 | 已實作 | `multiplier` | rules.test.ts |
| R140 | 已實作 | `hoursOf` | edits.golden.test.ts |
| R141 | 已實作 | `priceRows` | views.golden.test.ts |
| R142 | 已實作 | `courseTypes` | edits.golden.test.ts |
| R143 | 已實作 | `classifyCourseType` | edits.golden.test.ts |
| R144 | 已實作 | `cramSchools`、`parseCramSchools`、`isCramCourse` | edits.golden.test.ts、rules.test.ts、views.golden.test.ts |
| R145 | 已實作 | `courseDurationHours` | edits.golden.test.ts |
| R146 | 已實作 | `roleBadge` | rules.test.ts |
| R147 | 已實作 | `typeBadgeClass` | rules.test.ts |
| R148 | 已實作 | `blockOf` | views.golden.test.ts |
| R149 | 已實作 | `employeeKey` | edits.golden.test.ts |
| R150 | 已實作 | `expandPayrollRows` | views.golden.test.ts |
| R151 | 已實作 | `durationHours` | edits.golden.test.ts、views.golden.test.ts |
| R152 | 已實作 | `roleTypeLabel`、`roleTypeClass` | edits.golden.test.ts、views.golden.test.ts |
| R153 | 已實作 | `moneyText` | edits.golden.test.ts |
| R154 | 已實作 | `nameAudit`、`withNameAlias` | rules.test.ts、views.golden.test.ts |
| R155 | 待後續批 B7 | 名冊 datalist 屬畫面，直接由名冊算 | |
| R156 | 已實作 | `courseTypeMap`、`withTypeOverride` | rules.test.ts、views.golden.test.ts |
| R157 | 已實作 | `kpis`、`staffStats` | views.golden.test.ts |
| R158 | 已實作 | `typeSummary`、`typeSummaryCells` | views.golden.test.ts |
| R159 | 已實作 | `staffTable`、`roleMemo`、`sortStaff` | views.golden.test.ts |
| R160 | 已實作 | `coachDetail`、`slotBadge` | views.golden.test.ts |
| R161 | 已實作 | `weekDetail` | views.golden.test.ts |
| R162 | 已實作 | `coachFilter`、`matchesCoach`、`filterHint` | views.golden.test.ts |
| R163 | 已實作 | `payrollCsv` | views.golden.test.ts |
| R164 | 已實作 | `checklistProgress`、`PAYROLL_CHECKLIST` | rules.test.ts |
| R165 | 刪除 | S13：本機費率不再讀取，舊格式遷移不需要 | |
| R166 | 待後續批 B7 | 費率矩陣重建屬畫面 | |
| R167 | 已實作 | `salaryRateTarget`、`hourlyRates` | edits.golden.test.ts、rules.test.ts |
| R168 | 已實作 | `rateFor`、`parsePayrollConfig` | rules.test.ts |
| R169 | 刪除 | S10：課程薪資規則表刪除 | |
| R170 | 已實作 | `axisPct` | rules.test.ts、views.golden.test.ts |
| R171 | 已實作 | `fmtMinutes`、`fmtHours` | rules.test.ts、views.golden.test.ts |
| R172 | 已實作 | `rulerTicks` | rules.test.ts、views.golden.test.ts |
| R173 | 已實作 | `selectedDayNo` | edits.golden.test.ts |
| R174 | 已實作 | `selectedDayLabel` | edits.golden.test.ts |
| R175 | 已實作 | `stageShifts` | views.golden.test.ts |
| R176 | 已實作 | `onDutyAt` | views.golden.test.ts |
| R177 | 已實作 | `segCoverage` | views.golden.test.ts |
| R178 | 已實作 | `coverageState`、`STATE_LABEL` | views.golden.test.ts |
| R179 | 已實作 | `roleGapCount`、`venueGapCount` | views.golden.test.ts |
| R180 | 已實作 | `roleLane` | views.golden.test.ts |
| R181 | 已實作 | `roleLane` | views.golden.test.ts |
| R182 | 已實作 | `roleLane` | views.golden.test.ts |
| R183 | 已實作 | `timelineHeader` | views.golden.test.ts |
| R184 | 已實作 | `stageCourses` | views.golden.test.ts |
| R185 | 已實作 | `courseState` | views.golden.test.ts |
| R186 | 已實作 | `courseSummary`、`courseSummaryText` | views.golden.test.ts |
| R187 | 已實作 | `courseLane` | views.golden.test.ts |
| R188 | 已實作 | `coverageMatrix`、`segMembers` | views.golden.test.ts |
| R189 | 已實作 | `coverageMatrix` | views.golden.test.ts |
| R190 | 已實作 | `coverageMatrix` | views.golden.test.ts |
| R191 | 已實作 | `coursesView`、`coursePill` | views.golden.test.ts |
| R192 | 已實作 | `stageControls` | views.golden.test.ts |
| R193 | 已實作 | `stageView`、`stageVenue` | rules.test.ts |
| R194 | 已實作 | `gapAssignment` | edits.golden.test.ts、units.golden.test.ts |
| R195 | 已實作 | `removeDutyLine` | edits.golden.test.ts |
| R196 | 已實作 | `removeCoach` | edits.golden.test.ts |
| R197 | 待後續批 B3 | 編輯按鈕文字屬畫面 | |
| R198 | 待後續批 B3 | 改用 ui/tooltip（合約 5.2） | |
| R199 | 已實作 | `mobileSummary` | views.golden.test.ts |
| R200 | 已實作 | `mobileIssueGroups` | views.golden.test.ts |
| R201 | 已實作 | `mobileDays` | views.golden.test.ts |
| R202 | 已實作 | `mobileEmployees` | views.golden.test.ts |
| R203 | 已實作 | `mobilePill` | views.golden.test.ts |
| R204 | 待後續批 B3 | 視覺 | |
| R205 | 待後續批 B3 | 視覺 | |
| R206 | 待後續批 B3 | 視覺 | |
| R207 | 待後續批 B3 | 視覺 | |
| R208 | 待後續批 B3 | 視覺 | |
| R209 | 待後續批 B3 | 視覺 | |
| R210 | 待後續批 B3 | 視覺 | |
| R211 | 待後續批 B3 | 視覺 | |
| R212 | 待後續批 B3 | 視覺 | |
| R213 | 待後續批 B3 | 視覺：資料層改 ui/collapsible | |
| R214 | 待後續批 S15 | 列印重新設計，這批不做 | |
| R215 | 待後續批 B3 | 視覺 | |
| R216 | 待後續批 B3 | 視覺 | |
| R217 | 待後續批 B3 | CSS 缺陷在畫面批修正（S23） | |
| R218 | 待後續批 B3 | 隱藏區塊依 S01-S05 處理 | |
| R219 | 待後續批 B2 | 焦點判斷屬輪詢 | |
| R220 | 已實作 | `weekOptions` | units.golden.test.ts |
| R221 | 已實作 | `courseCellKey`、`manualCellKey`、`dutyGridCellKey`、`dutyGridRowsKey`、`availabilityKey`、`overrideKey`、`renderedCellKeys` | course-rows.golden.test.ts |
| R222 | 已實作 | `buildWeekModel` | course-rows.golden.test.ts、rules.test.ts |
| R223 | 已實作 | `stripFollowMark`、`hasFollowMark` | rules.test.ts |
| R224 | 已實作 | `gapAssignment` | edits.golden.test.ts |
| R225 | 刪除 | S05：值班文字輸入表刪除，日期欄沿用 datesInWeek | |
| R226 | 刪除 | S13：本機手動課程清單刪除 | |
| R227 | 已實作 | `buildWeekModel`、`applyDerivedCells` | enrollment-failure.test.ts、payload.golden.test.ts |
| R228 | 已實作 | `workEntries` | validate.golden.test.ts |
| R229 | 已實作 | `ISSUE_GROUPS` | units.golden.test.ts |
| R230 | 已實作 | `isIsoDate`、`addDays`、`dayNoOf` | rules.test.ts |
| R231 | 已實作 | `hasShiftRows`、`hasWorkRows`、`hasScheduleValue` | units.golden.test.ts |
| R232 | 刪除 | S12：問卷勾選刪除 | |
| R233 | 已實作 | `minutesToTime` | units.golden.test.ts |
| R234 | 刪除 | S10：課程薪資規則刪除 | |
| R235 | 刪除 | S09／S13：時薪與備註搬進 summer-payroll-config-v1，不再存本機 | |
| R236 | 待後續批 B7 | 輸入框 id 屬畫面 | |
| R237 | 刪除 | S13 與 R168：本機費率不再讀取 | |
| R238 | 待後續批 B7 | 設定儲存狀態文字屬畫面 | |
| R239 | 已實作 | `parsePayrollConfig` | rules.test.ts |
| R240 | 待後續批 B7 | 繪製入口屬畫面 | |
| R241 | 已實作 | `coachOptionNames` | rules.test.ts |
| R242 | 刪除 | v40 算了主要館別卻沒有顯示（mv 沒有呼叫者），沒有可觀察行為 | |
