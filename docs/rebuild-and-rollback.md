# 重建與回退

在新目錄取回某個部署版本、建好資料庫、啟動並確認可用；以及新增資料表與回退的做法。

## 取回指定版本

每次正式部署的 commit 都打 tag `deploy-YYYYMMDD-HHMM`（台北時間），例如 `deploy-20261104-1424`。

```bash
git clone https://github.com/DAOS-Sport/Workforce-Scheduling.git
cd Workforce-Scheduling
git checkout deploy-20261104-1424
```

## 需要的環境

- Node 20（正式站 20.20.0）、PostgreSQL 16 以上。
- 環境變數（值放在 Replit Secrets，不進 repo）：
  - 必填：`DATABASE_URL`、`SESSION_SECRET`
  - 後台登入：`ADMIN_PASSWORD`；健康檢查：`HEALTH_TOKEN`
  - LINE：`LINE_CHANNEL_ACCESS_TOKEN`、`LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ID`、`LINE_LOGIN_CHANNEL_SECRET`、`VITE_LIFF_ID`
  - Ragic：`RAGIC_API_KEY`、`RAGIC_WEBHOOK_SECRET`
  - 其他：`INTERNAL_API_TOKEN`、`MCP_TOKEN`、`GMAIL_USER`、`GMAIL_APP_PASSWORD`、`ENROLLMENT_API_URL`、`ENROLLMENT_API_KEY`
- 沒有設 `REPLIT_DEPLOYMENT=1` 時，排程（推播、Ragic 同步）一律不跑，所以本機重建不會發 LINE 給員工。

## 步驟

1. **修正 lock 檔裡的 Replit 內部網址**。`package-lock.json` 是在 Replit 上產生的，有些套件的下載網址是 `http://package-firewall.replit.local/npm/...`，離開 Replit 解析不到：

   ```bash
   sed -i 's#http://package-firewall.replit.local/npm/#https://registry.npmjs.org/#g' package-lock.json
   ```

2. **安裝套件：用 `npm install`，不要用 `npm ci`**。lock 檔缺 `@tailwindcss/oxide-*` 其他平台的選用套件，`npm ci` 會因為「lock 與 package.json 不同步」拒絕安裝。

   ```bash
   npm install
   ```

3. **在空資料庫建表**（只用在空庫）：

   ```bash
   DATABASE_URL=postgres://... npx drizzle-kit push --force
   ```

   既有資料庫不要跑 `db:push`。正式庫和開發庫裡有 4 張表不在 `shared/schema.ts`：`session`（開機時自動建）、`audit_logs`、`app_logs`、`user_error_events`（舊版本留下的）。push 會把它們當成要刪的表。

4. **建置**：`npm run build`

5. **啟動**：

   ```bash
   NODE_ENV=production PORT=5000 node dist/index.cjs
   ```

   要在 Linux 上啟動（Replit、一般 Linux 主機或 WSL）。程式監聽時用了 `reusePort`，Windows 原生不支援，會出現 `listen ENOTSUP`。安裝、建表、建置在 Windows 上可以做。

6. **檢查**：
   - `GET /` 回 200（前端頁面）。
   - `GET /api/health/pipelines` 帶 `Authorization: Bearer <HEALTH_TOKEN>` 回 200，token 錯回 401。
   - 未登入 `GET /api/employees` 回 401。
   - 啟動 log 沒有 `Seed error`（有的話通常是第 3 步沒建表）。

2026-11-04 演練紀錄：從 GitHub 全新 clone `deploy-20261104-1424`，照本文件在 Linux（Node 20.20.0、PostgreSQL 16.10）上跑完；空庫建出 32 張表、開機補 `session` 共 33 張，以上檢查全部符合。安裝步驟另在 Windows 全新目錄驗過（`npm ci` 失敗、改 `npm install` 成功）。

## 新增資料表（開發區 → 正式站）

1. 在 `shared/schema.ts` 只新增表，不改既有表。
2. 產出建表 SQL（不需要連資料庫）：`npx drizzle-kit generate`，從產出的 SQL 挑出新表的 `CREATE TABLE`／`CREATE INDEX`。
3. 在開發庫用單一交易執行這些 SQL。
4. 比對開發庫和正式庫的表與欄位，差異只能是新表。
5. Publish 時遷移提示只能有 CREATE；出現 DROP 或 ALTER 就停下來。

`scripts/post-merge.sh` 只裝套件，不會自動推資料庫結構。

## 回退

- **程式**：在 Replit 部署頁回到前一個部署，或 checkout 前一個 `deploy-*` tag，再 Publish。
- **資料**：正式庫有平台 7 天時間點還原。新表都是只新增，回退程式不必刪表。
