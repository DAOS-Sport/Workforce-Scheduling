import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import cron from "node-cron";
import { syncFromRagic } from "./ragic";
import { sendShiftReminders, checkMissingClockIn, resetMissingClockInTracker, sendWeeklySchedulePush, sendWeeklyLateReport } from "./line-webhook";
import { ensureWeeklyPushTable } from "./storage";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "./db";

const app = express();
app.set("trust proxy", 1);

if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  console.warn("[WARN] SESSION_SECRET is not set. Using insecure fallback secret in production!");
}
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

declare module "express-session" {
  interface SessionData {
    adminId: number;
    adminName: string;
    adminLineId: string;
  }
}

async function ensureSessionTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "session" (
      "sid" varchar NOT NULL COLLATE "default",
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL,
      CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
    ) WITH (OIDS=FALSE)
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")`);
}
ensureSessionTable().catch((err) => console.error("[session] 建立 session 表失敗:", err));

const PgStore = connectPgSimple(session);
app.use(
  session({
    store: new PgStore({ conString: process.env.DATABASE_URL }),
    secret: process.env.SESSION_SECRET || "fallback-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    },
  })
);

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        const body = JSON.stringify(capturedJsonResponse);
        logLine += ` :: ${body.length > 200 ? body.slice(0, 200) + "…" : body}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const { seedDatabase } = await import("./seed");
  try {
    await seedDatabase();
  } catch (err) {
    console.error("Seed error:", err);
  }

  // Ensure weekly push notification dedup table exists (idempotent, safe to run every startup)
  try {
    await ensureWeeklyPushTable();
    log("weekly_push_notifications 表格確認完成", "db");
  } catch (err: any) {
    log(`weekly_push_notifications 表格建立失敗: ${err.message}`, "db");
  }

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);

      cron.schedule("0 3 * * *", async () => {
        log("開始執行每日 Ragic 員工同步...", "cron");
        try {
          const syncResult = await syncFromRagic();
          log(
            `Ragic 同步完成: 新增 ${syncResult.created}, 更新 ${syncResult.updated}, 停用 ${syncResult.deactivated}, 跳過 ${syncResult.skipped}, 錯誤 ${syncResult.errors.length}`,
            "cron"
          );
          if (syncResult.errors.length > 0) {
            log(`同步錯誤: ${syncResult.errors.slice(0, 10).join("; ")}`, "cron");
          }
        } catch (err: any) {
          log(`Ragic 同步失敗: ${err.message}`, "cron");
        }
      }, { timezone: "Asia/Taipei" });
      log("已排程每日凌晨 3:00 (台灣時間) 自動執行 Ragic 同步", "cron");

      cron.schedule("0 19 * * *", async () => {
        log("開始執行明日班表推撥通知...", "cron");
        try {
          const result = await sendShiftReminders();
          log(`班表推撥完成: 發送 ${result.sent}, 跳過 ${result.skipped}, 無LINE ${result.noLineId}`, "cron");
        } catch (err: any) {
          log(`班表推撥失敗: ${err.message}`, "cron");
        }
      }, { timezone: "Asia/Taipei" });
      log("已排程每日 19:00 (台灣時間) 自動推撥明日班表", "cron");

      cron.schedule("*/30 6-21 * * *", async () => {
        log("開始檢查未打卡員工...", "cron");
        try {
          const result = await checkMissingClockIn();
          log(`未打卡檢查完成: 通知 ${result.notified}, 跳過 ${result.skipped}`, "cron");
        } catch (err: any) {
          log(`未打卡檢查失敗: ${err.message}`, "cron");
        }
      }, { timezone: "Asia/Taipei" });
      log("已排程每 30 分鐘（06:00-21:30）檢查未打卡員工", "cron");

      cron.schedule("0 0 * * *", () => {
        resetMissingClockInTracker();
      }, { timezone: "Asia/Taipei" });
      log("已排程每日午夜重置未打卡追蹤記錄", "cron");

      cron.schedule("0 19 * * 0", async () => {
        log("開始執行每週下週班表推播...", "cron");
        try {
          const result = await sendWeeklySchedulePush();
          log(`週班表推播完成: 發送 ${result.sent}, 跳過 ${result.skipped}, 無LINE ${result.noLineId}`, "cron");
        } catch (err: any) {
          log(`週班表推播失敗: ${err.message}`, "cron");
        }
      }, { timezone: "Asia/Taipei" });
      log("已排程每週日 19:00 (台灣時間) 自動推播下週班表", "cron");

      cron.schedule("0 9 * * 1", async () => {
        log("開始執行上週遲到報告推播...", "cron");
        try {
          const result = await sendWeeklyLateReport();
          log(`週遲到報告推播完成: 發送 ${result.sent}, 跳過 ${result.skipped}, 無LINE ${result.noLineId}`, "cron");
        } catch (err: any) {
          log(`週遲到報告推播失敗: ${err.message}`, "cron");
        }
      }, { timezone: "Asia/Taipei" });
      log("已排程每週一 09:00 (台灣時間) 自動推播上週遲到報告", "cron");
    },
  );
})();
