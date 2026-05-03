/**
 * server/shared/http/errorHandler.ts
 *
 * Global Express error-handler middleware.
 *
 * Mount AFTER all routes:
 *   import { globalErrorHandler } from "../shared/http/errorHandler";
 *   app.use(globalErrorHandler);
 *
 * Handles:
 *  - AppError subclasses (statusCode from the error instance)
 *  - Generic Error objects (500)
 *  - Already-sent responses (passes through to avoid double-send)
 */
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors";

export function globalErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      message: err.message,
      ...(err.code ? { code: err.code } : {}),
    });
    return;
  }

  const status =
    typeof err === "object" &&
    err !== null &&
    ("status" in err || "statusCode" in err)
      ? ((err as { status?: number; statusCode?: number }).status ??
        (err as { statusCode?: number }).statusCode ??
        500)
      : 500;

  const message =
    err instanceof Error ? err.message : "Internal Server Error";

  console.error("[errorHandler]", err);
  res.status(status).json({ message });
}
