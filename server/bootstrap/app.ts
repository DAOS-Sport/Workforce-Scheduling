import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { log } from "../shared/log";
import { installSession, ensureSessionTable } from "./session";
import { globalErrorHandler } from "../shared/http/errorHandler";
import { metricsStore } from "../observability/metrics-store";

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

declare module "express-serve-static-core" {
  interface Locals {
    requestId: string;
    startTime: number;
  }
}

/**
 * Build a fully-configured Express application:
 *   - trust proxy for Replit's TLS terminator
 *   - session table + session middleware
 *   - request-ID middleware (x-request-id header)
 *   - JSON body parser (with rawBody captured for LINE signature verify)
 *   - urlencoded body parser
 *   - request logger + metrics collector for every /api/*
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

  // ── Request-ID middleware ──────────────────────────────────────────────
  app.use((req: Request, res: Response, next: NextFunction) => {
    const incoming = (req.headers["x-request-id"] as string | undefined)?.trim();
    const id = incoming && incoming.length > 0 && incoming.length <= 64
      ? incoming
      : `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    res.locals.requestId = id;
    res.locals.startTime = Date.now();
    res.setHeader("x-request-id", id);
    next();
  });

  app.use(
    express.json({
      limit: "25mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: false }));

  // /api/* request logger + metrics collector
  app.use((req: Request, res: Response, next: NextFunction) => {
    const path = req.path;
    let capturedJsonResponse: Record<string, any> | undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      const duration = Date.now() - (res.locals.startTime ?? Date.now());
      if (path.startsWith("/api")) {
        let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
        if (capturedJsonResponse) {
          const body = JSON.stringify(capturedJsonResponse);
          logLine += ` :: ${body.length > 200 ? body.slice(0, 200) + "…" : body}`;
        }
        log(logLine);

        const isInternal = path.startsWith("/api/internal");
        metricsStore.push({
          ts: Date.now(),
          method: req.method,
          route: path,
          statusCode: res.statusCode,
          durationMs: duration,
          requestId: res.locals.requestId ?? "",
          isError: res.statusCode >= 400,
          isInternal,
        });
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
