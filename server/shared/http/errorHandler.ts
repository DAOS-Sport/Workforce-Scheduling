/**
 * server/shared/http/errorHandler.ts
 *
 * The one place that decides what a failed request looks like.
 *
 * `requestContext` runs first on every request. It gives the request an id (the caller's
 * X-Request-Id when it is a plain token, otherwise a new one), puts it in the response header,
 * and wraps res.json so that every answer with status 400 or above leaves through one gate:
 *   - 4xx: the body is kept and gains `requestId`.
 *   - 5xx: the real message and stack are written to app_errors and the log; the client gets a
 *     generic message and the request id. This holds for errors that reach `globalErrorHandler`
 *     and for the many route catch blocks that answer fail(res, 500, err.message) themselves.
 *
 * `globalErrorHandler` is mounted after all routes. An HttpError keeps its status and message
 * (4xx) and a malformed request body stays a 400. Anything else is an unexpected failure: 500.
 */
import type { NextFunction, Request, Response } from "express";
import { recordServerError } from "../../modules/errors/errors.service";
import { HttpError } from "../errors";
import { log } from "../log";
import { REQUEST_ID_HEADER, resolveRequestId, runInRequestContext, runWithRequestId, type RequestContext } from "./requestId";

export const GENERIC_ERROR_MESSAGE = "伺服器發生錯誤，請稍後再試";

export function genericErrorMessage(requestId: string): string {
  return `${GENERIC_ERROR_MESSAGE}（錯誤代碼 ${requestId}）`;
}

interface Failure {
  message: string;
  stack?: string;
}

const isBody = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function pathOf(req: Request): string {
  return (req.originalUrl ?? req.url ?? "").split("?")[0];
}

/**
 * The record ids in the matched route's path (`:id`, `:employeeId`, `:shiftId` …). Read from `req.route` and the URL, not
 * `req.params`: the router empties `req.params` before an error thrown by the route reaches the error handler.
 */
function idParams(req: Request): Record<string, string> {
  const pattern = typeof req.route?.path === "string" ? req.route.path.split("/") : [];
  const actual = pathOf(req).split("/");
  if (pattern.length !== actual.length) return {};
  const ids: Record<string, string> = {};
  pattern.forEach((segment: string, i: number) => {
    const name = segment.startsWith(":") ? segment.slice(1) : "";
    if (/^id$|Id$/.test(name) && actual[i].length > 0 && actual[i].length <= 64) ids[name] = actual[i];
  });
  return ids;
}

/** The error text of a body: `message`, or a JSON-RPC style `error.message`. */
function textOf(body: Record<string, unknown>): string | undefined {
  if (typeof body.message === "string" && body.message) return body.message;
  const nested = body.error;
  if (typeof nested === "string") return nested;
  return isBody(nested) && typeof nested.message === "string" ? nested.message : undefined;
}

function shapeErrorBody(req: Request, res: Response, body: unknown): unknown {
  const status = res.statusCode;
  if (status < 400 || !isBody(body)) return body;
  const requestId = res.locals.requestId as string;
  if (status < 500) return body;

  const failure = res.locals.serverError as Failure | undefined;
  const message = failure?.message ?? textOf(body) ?? "(no message)";
  runWithRequestId(requestId, () => log(`${req.method} ${pathOf(req)} ${status} ${message}${failure?.stack ? `\n${failure.stack}` : ""}`, "error"));
  const subject = { ...idParams(req), ...(res.locals.requestContext as RequestContext | undefined)?.subject };
  try {
    recordServerError({ requestId, method: req.method, path: pathOf(req), status, message, stack: failure?.stack, subject });
  } catch (err) {
    console.error("[errors] could not start the error record:", err);
  }
  if (typeof body.message !== "string") return body;
  return { ...(typeof body.code === "string" ? { code: body.code } : {}), message: genericErrorMessage(requestId), requestId };
}

/** Idempotent: gives the response its id, header and error gate. Returns the id. */
function attach(req: Request, res: Response): string {
  if (typeof res.locals.requestId === "string") return res.locals.requestId;
  const requestId = resolveRequestId(req.get(REQUEST_ID_HEADER));
  res.locals.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  const json = res.json.bind(res);
  res.json = (body?: unknown) => json(shapeErrorBody(req, res, body));
  return requestId;
}

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  // Kept on the response too: the error gate can run after the async context that served the request is gone.
  const context: RequestContext = { requestId: attach(req, res), subject: {} };
  res.locals.requestContext = context;
  runInRequestContext(context, next);
}

/** A 4xx a library raised on purpose, such as body-parser rejecting malformed JSON. */
function isClientError(err: unknown): err is Error & { status: number } {
  const e = err as { status?: unknown; expose?: unknown } | null;
  return err instanceof Error && typeof e?.status === "number" && e.status >= 400 && e.status < 500 && e.expose === true;
}

export function globalErrorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  attach(req, res);

  if (err instanceof HttpError && err.status < 500) {
    res.status(err.status).json({ message: err.message, ...err.extra });
    return;
  }
  if (isClientError(err)) {
    res.status(err.status).json({ message: err.message });
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  res.locals.serverError = { message, stack: err instanceof Error ? err.stack : undefined } satisfies Failure;
  res.status(err instanceof HttpError ? err.status : 500).json({ message });
}
