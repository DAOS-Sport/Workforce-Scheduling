import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import cron from "node-cron";
import { syncFromRagic } from "./ragic";
import { sendShiftReminders } from "./line-webhook";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";

const app = express();
app.set("trust proxy", 1);
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

const PgStore = connectPgSimple(session);
app.use(
  session({
    store: new PgStore({ conString: process.env.DATABASE_URL, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || "fallback-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: false,
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
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
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
    },
  );
})();
