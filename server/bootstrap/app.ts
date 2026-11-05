import express, { type Express } from "express";
import type { Server } from "http";
import { log } from "../shared/log";
import { installSession, ensureSessionTable } from "./session";
import { globalErrorHandler, requestContext } from "../shared/http/errorHandler";
import { runWithRequestId } from "../shared/http/requestId";
import { buildHttpServer } from "./http";
import { registerRoutes } from "../routes";
import { IS_PRODUCTION } from "../config/env";
import { featureFlags } from "../config/featureFlags";
import { ragicCatchUp } from "../modules/ragic/ragicCatchUp";
import { runRagicSync } from "../modules/ragic/ragic.service";
import { readJobState } from "../shared/health/healthState";

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

/**
 * Build a fully-configured Express application:
 *   - trust proxy for Replit's TLS terminator
 *   - request id on every request and the one gate every error answer leaves through
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
  app.use(requestContext);

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

  // /api/* request logger. Response bodies are not logged: they carry names,
  // phone numbers and LINE IDs (GitHub #5).
  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;

    res.on("finish", () => {
      if (path.startsWith("/api")) {
        runWithRequestId(res.locals.requestId, () => log(`${req.method} ${path} ${res.statusCode} in ${Date.now() - start}ms`));
      }
    });

    next();
  });

  // The 03:00 cron does not always run on Autoscale: the first request after a missed run starts it in the background.
  app.use(
    ragicCatchUp({
      enabled: IS_PRODUCTION && featureFlags.ragicSync,
      readState: () => readJobState("ragic.sync"),
      run: () => runRagicSync("startup"),
    }),
  );

  return app;
}

/**
 * Final JSON error handler. Mount AFTER all routes.
 * Delegates to the canonical globalErrorHandler in shared/http/errorHandler.ts.
 */
export function installErrorHandler(app: Express): void {
  app.use(globalErrorHandler);
}

/**
 * The app as the process serves it, minus the migrations, seed and client assets that
 * bootstrap() adds around it. Integration tests build this same app.
 */
export async function buildApp(): Promise<{ app: Express; httpServer: Server }> {
  const app = await createApp();
  const httpServer = buildHttpServer(app);
  await registerRoutes(httpServer, app);
  installErrorHandler(app);
  return { app, httpServer };
}
