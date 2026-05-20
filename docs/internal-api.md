# 駿斯排班系統 — Internal API 文件

> 供第三方程式對接使用。所有端點均需通過 Token 認證。
> Base URL：`https://<your-domain>`

---

## 認證

每個請求都必須帶上 `INTERNAL_API_TOKEN`，支援以下四種方式（任選其一）：

| 方式 | 範例 |
|------|------|
| `Authorization` header | `Authorization: Bearer <token>` |
| `X-Internal-Token` header | `X-Internal-Token: <token>` |
| `X-API-Key` header | `X-API-Key: <token>` |
| Query 參數 | `?token=<token>` |

**認證失敗回應：**

| 狀況 | HTTP | code |
|------|------|------|
| 未帶 token | 401 | `MISSING_INTERNAL_TOKEN` |
| Token 錯誤 | 403 | `INVALID_INTERNAL_TOKEN` |
| 伺服器未設定 token | 503 | `INTERNAL_API_DISABLED` |

---

## 共用欄位說明

### facilityKey（館區代碼）

| 值 | 對應區域 |
|----|---------|
| `A` | 三蘆戰區 |
| `B` | 松山國小 |
| `C` | 新竹區 |
| `D` | 內勤 |

### period（班別）

| 值 | 說明 |
|----|------|
| `early` | 早班（開始時間 < 12:00） |
| `mid` | 中班（開始時間 12:00–16:59） |
| `late` | 晚班（開始時間 ≥ 17:00 或跨午夜） |
| `custom` | 自訂（時間資料不完整） |

### 分頁（Cursor Pagination）

支援分頁的端點回傳 `pageInfo`：

```json
{
  "pageInfo": {
    "limit": 5000,
    "total": 12345,
    "hasMore": true,
    "nextCursor": "base64EncodedOffset"
  }
}
```

取下一頁：加上 `?cursor=<nextCursor>`。
預設每頁 **5000** 筆，最大 **20000** 筆（`?limit=N`）。

---

## 端點清單

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/internal/admin/overview` | 系統總覽 |
| GET | `/api/internal/schedules/today` | 今日班表 |
| GET | `/api/internal/export/schedules` | 班表匯出（分頁） |
| GET | `/api/internal/export/employees` | 員工清單匯出（分頁） |
| GET | `/api/internal/export/venues` | 館別清單 |
| GET | `/api/internal/export/shifts` | 班別範本清單 |
| GET | `/api/internal/export/changes` | 排班異動紀錄（分頁） |
| GET | `/api/internal/export/snapshot` | 完整快照（班表 + 員工 + 異動） |
| POST | `/api/internal/trigger-weekly-schedule` | 手動觸發每週排班同步 |

---

## 詳細說明

---

### GET `/api/internal/admin/overview`

系統整體狀態快覽，包含今日班次數量與待審件數。

**Query 參數：** 無

**回應範例：**

```json
{
  "generatedAt": "2026-05-20T08:00:00.000Z",
  "date": "2026-05-20",
  "timezone": "Asia/Taipei",
  "employees": {
    "totalActive": 85,
    "totalAll": 92,
    "byRegion": { "A": 30, "B": 20, "C": 25, "D": 10 }
  },
  "shiftsToday": {
    "regular": 42,
    "dispatch": 8,
    "total": 50
  },
  "pendingReviews": {
    "clockAmendments": 3,
    "leaveRequests": 1,
    "overtimeRequests": 2,
    "anomalyReports": 5
  }
}
```

---

### GET `/api/internal/schedules/today`

回傳特定館區**今天（台北時間）**的全部班次，含正職與派遣。

**Query 參數：**

| 參數 | 必填 | 說明 |
|------|------|------|
| `facilityKey` | ✅ | 館區代碼（A / B / C / D） |

**回應範例：**

```json
{
  "date": "2026-05-20",
  "timezone": "Asia/Taipei",
  "facilityKey": "A",
  "region": { "id": 1, "code": "A", "name": "三蘆戰區" },
  "counts": { "regular": 10, "dispatch": 2, "total": 12 },
  "shifts": [
    {
      "kind": "regular",
      "shiftId": 1001,
      "date": "2026-05-20",
      "startTime": "09:00",
      "endTime": "17:00",
      "role": "PT教練",
      "period": "early",
      "employee": {
        "id": 5,
        "name": "王小明",
        "employeeCode": "PT001",
        "phone": "0912345678"
      },
      "venue": { "id": 2, "name": "三重商工館", "shortName": "三重商工" },
      "isDispatch": false,
      "dispatch": null,
      "notes": ""
    },
    {
      "kind": "dispatch",
      "shiftId": 201,
      "date": "2026-05-20",
      "startTime": "14:00",
      "endTime": "22:00",
      "role": "替代教練",
      "period": "mid",
      "dispatch": { "name": "李替補", "company": "派遣公司A", "phone": "0922000000" },
      "linkedEmployeeId": null,
      "venue": { "id": 2, "name": "三重商工館", "shortName": "三重商工" },
      "notes": ""
    }
  ]
}
```

---

### GET `/api/internal/export/schedules`

依日期範圍匯出班表，支援分頁與多種篩選條件。

**Query 參數：**

| 參數 | 必填 | 預設 | 說明 |
|------|------|------|------|
| `from` | ✅ | — | 起始日期 `YYYY-MM-DD` |
| `to` | ✅ | — | 結束日期 `YYYY-MM-DD`（≥ from） |
| `facilityKey` | ❌ | 全部 | 館區代碼，不帶則回傳所有館區 |
| `employeeNumber` | ❌ | — | 員工編號，指定則只回傳該員工 |
| `includeDeleted` | ❌ | `false` | `true` 可包含已取消班次 |
| `includeDispatch` | ❌ | `true` | `false` 可排除派遣班次 |
| `limit` | ❌ | `5000` | 每頁筆數（最大 20000） |
| `cursor` | ❌ | — | 分頁游標（上頁回傳的 `nextCursor`） |

**回應 item 欄位：**

```json
{
  "rawId": "shift_1001",
  "sourceTable": "shifts",
  "sourceRowId": 1001,
  "date": "2026-05-20",
  "role": "PT教練",
  "period": "early",
  "venueName": "三重商工館",
  "venueShortName": "三重商工",
  "region": { "id": 1, "code": "A", "name": "三蘆戰區" },
  "venue": {
    "id": 2,
    "key": "三重商工_2",
    "name": "三重商工館",
    "shortName": "三重商工",
    "aliases": ["三重商工", "三重商工館"]
  },
  "shift": {
    "id": "shift_1001",
    "startTime": "09:00:00",
    "endTime": "17:00:00",
    "startAt": "2026-05-20T09:00:00+08:00",
    "endAt": "2026-05-20T17:00:00+08:00",
    "period": "early"
  },
  "employee": {
    "id": 5,
    "employeeNumber": "PT001",
    "name": "王小明",
    "title": "PT教練",
    "department": "教練部",
    "status": "active"
  },
  "assignment": {
    "kind": "regular",
    "status": "scheduled",
    "isDispatch": false,
    "isSubstitute": false,
    "note": ""
  },
  "audit": {
    "createdAt": null,
    "updatedAt": null,
    "deletedAt": null,
    "updatedBy": ""
  }
}
```

> 派遣班次的 `sourceTable` 為 `"dispatch_shifts"`，`rawId` 前綴為 `"dispatch_"`。

---

### GET `/api/internal/export/employees`

匯出員工清單，支援狀態與館區篩選。

**Query 參數：**

| 參數 | 必填 | 預設 | 說明 |
|------|------|------|------|
| `status` | ❌ | `active` | `active` / `inactive` / `all` |
| `facilityKey` | ❌ | 全部 | 館區代碼 |
| `limit` | ❌ | `5000` | 每頁筆數 |
| `cursor` | ❌ | — | 分頁游標 |

**回應 item 欄位：**

```json
{
  "id": 5,
  "employeeNumber": "PT001",
  "name": "王小明",
  "title": "PT教練",
  "department": "教練部",
  "regionCode": "A",
  "regionName": "三蘆戰區",
  "venueKeys": ["三重商工_2"],
  "phone": "0912345678",
  "email": "wang@example.com",
  "lineId": "Uxxxxxxxx",
  "employmentType": "full_time",
  "isAdmin": false,
  "status": "active"
}
```

---

### GET `/api/internal/export/venues`

回傳所有館別的完整資訊（不分頁）。

**Query 參數：** 無

**回應 item 欄位：**

```json
{
  "id": 2,
  "key": "三重商工_2",
  "name": "三重商工館",
  "shortName": "三重商工",
  "regionCode": "A",
  "regionName": "三蘆戰區",
  "aliases": ["三重商工", "三重商工館"],
  "address": "新北市三重區…",
  "latitude": 25.07,
  "longitude": 121.49,
  "radius": 200,
  "taxId": null,
  "isInternal": true,
  "operationType": "self",
  "isActive": true
}
```

---

### GET `/api/internal/export/shifts`

回傳所有班別範本（不分頁），相同時間 + 班種的範本會合併為一筆。

**Query 參數：** 無

**回應 item 欄位：**

```json
{
  "id": "tpl_早班|09:00:00|17:00:00|PT教練|weekday",
  "code": "早班_early",
  "name": "早班",
  "label": "早班",
  "role": "PT教練",
  "dayType": "weekday",
  "startTime": "09:00:00",
  "endTime": "17:00:00",
  "period": "early",
  "requiredCount": 2,
  "sortOrder": 1
}
```

---

### GET `/api/internal/export/changes`

回傳指定日期範圍內的排班異動稽核紀錄（建立、修改、取消等）。

**Query 參數：**

| 參數 | 必填 | 預設 | 說明 |
|------|------|------|------|
| `from` | ✅ | — | 起始日期 `YYYY-MM-DD` |
| `to` | ✅ | — | 結束日期 `YYYY-MM-DD` |
| `facilityKey` | ❌ | 全部 | 館區代碼 |
| `limit` | ❌ | `5000` | 每頁筆數 |
| `cursor` | ❌ | — | 分頁游標 |

**回應 item 欄位：**

```json
{
  "id": 300,
  "scheduleRawId": "shift_1001",
  "shiftId": 1001,
  "date": "2026-05-20",
  "changeType": "cancel",
  "before": { "status": "active" },
  "after": { "status": "cancelled" },
  "reason": "請假",
  "changedBy": "admin",
  "changedAt": "2026-05-19T10:30:00.000Z"
}
```

---

### GET `/api/internal/export/snapshot`

一次回傳指定日期範圍的**完整快照**：館別、班別範本、員工、班表、異動紀錄，適合初始同步或定期全量拉取。

**Query 參數：**

| 參數 | 必填 | 預設 | 說明 |
|------|------|------|------|
| `from` | ❌ | 今天（台北） | 起始日期 `YYYY-MM-DD` |
| `to` | ❌ | 同 `from` | 結束日期 `YYYY-MM-DD` |
| `facilityKey` | ❌ | 全部 | 館區代碼 |

**回應結構：**

```json
{
  "range": { "from": "2026-05-01", "to": "2026-05-31" },
  "facilityKey": "A",
  "region": { "id": 1, "code": "A", "name": "三蘆戰區" },
  "venues": [ /* 同 export/venues item 格式 */ ],
  "shifts": [ /* 同 export/shifts item 格式（班別範本）*/ ],
  "employees": [ /* 員工清單（僅 active）*/ ],
  "schedules": [ /* 同 export/schedules item 格式 */ ],
  "changes": [ /* 同 export/changes item 格式 */ ],
  "counts": {
    "venues": 3,
    "shifts": 6,
    "employees": 30,
    "schedules": 250,
    "changes": 12
  },
  "generatedAt": "2026-05-20T08:00:00.000Z"
}
```

> **注意**：`schedules` 陣列每筆記錄頂層直接有 `role`、`period`、`venueName`、`venueShortName` 欄位，不需要解析巢狀物件。

---

### POST `/api/internal/trigger-weekly-schedule`

手動觸發每週排班同步作業（通常由排程自動執行，此端點供外部強制觸發）。

**Request body：** 無

**回應範例：**

```json
{
  "ok": true,
  "message": "週班已同步",
  "affectedCount": 42
}
```

---

## 錯誤格式

所有錯誤回應均為 JSON，格式如下：

```json
{
  "code": "INVALID_DATE_RANGE",
  "message": "from and to must be YYYY-MM-DD"
}
```

常見錯誤碼：

| code | HTTP | 說明 |
|------|------|------|
| `MISSING_FACILITY_KEY` | 400 | `facilityKey` 必填但未帶 |
| `INVALID_FACILITY_KEY` | 400 | `facilityKey` 值不在允許清單中 |
| `INVALID_DATE_RANGE` | 400 | `from` / `to` 格式錯誤或 from > to |
| `REGION_NOT_FOUND` | 404 | 找不到對應館區 |
| `INTERNAL_ROUTE_NOT_FOUND` | 404 | 路徑不存在 |
| `MISSING_INTERNAL_TOKEN` | 401 | 未帶 token |
| `INVALID_INTERNAL_TOKEN` | 403 | Token 錯誤 |
| `INTERNAL_API_DISABLED` | 503 | 伺服器未設定 `INTERNAL_API_TOKEN` |
