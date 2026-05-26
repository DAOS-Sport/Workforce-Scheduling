import express, { type Express } from "express";
import { log } from "../shared/log";
import { installSession, ensureSessionTable } from "./session";
import { globalErrorHandler } from "../shared/http/errorHandler";

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

/**
 * Build a fully-configured Express application:
 *   - trust proxy for Replit's TLS terminator
 *   - session table + session middleware
 *   - JSON body parser (with rawBody captured for LINE signature verify)
 *   - urlencoded body parser
 *   - request logger that prints method/path/status/duration for every /api/*
 *
 * Returns the app. The caller is responsible for mounting routes and the
 * final error handler.
 */
export async function createApp(): Promise<Express> {
  const app = express();
  app.set("trust proxy", 1);

  // Session table must exist before the session middleware tries to read.
  try {
    await ensureSessionTable();
  } catch (err) {
    console.error("[session] 建立 session 表失敗:", err);
  }
  installSession(app);

  app.use(
    express.json({
      limit: "25mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: false }));

  // /api/* request logger
  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, any> | undefined;

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

  return app;
}

/**
 * Final JSON error handler. Mount AFTER all routes.
 * Delegates to the canonical globalErrorHandler in shared/http/errorHandler.ts.
 */
export function installErrorHandler(app: Express): void {
  app.use(globalErrorHandler);
}
