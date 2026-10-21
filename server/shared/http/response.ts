/**
 * server/shared/http/response.ts
 *
 * Uniform JSON response helpers for route handlers.
 *
 * Usage:
 *   import { ok, fail, created } from "../../shared/http/response";
 *
 *   router.get("/", (req, res) => ok(res, data));
 *   router.post("/", (req, res) => created(res, newItem));
 *   router.delete("/:id", (req, res) => fail(res, 404, "Not found"));
 */
import type { Response } from "express";

/** 200 OK with a JSON body. */
export function ok<T>(res: Response, data: T, status = 200): void {
  res.status(status).json(data);
}

/** 201 Created with a JSON body. */
export function created<T>(res: Response, data: T): void {
  res.status(201).json(data);
}

/** 204 No Content. */
export function noContent(res: Response): void {
  res.status(204).end();
}

/** Thrown by services for a non-2xx outcome; the route's catch passes it to fail(). */
export function httpError(
  status: number,
  message: string,
  extra?: Record<string, unknown>,
): Error & { status: number; extra?: Record<string, unknown> } {
  return Object.assign(new Error(message), { status, extra });
}

/** Error response with a message string. */
export function fail(
  res: Response,
  status: number,
  message: string,
  extra?: Record<string, unknown>,
): void {
  res.status(status).json({ message, ...extra });
}

/** 400 Bad Request. */
export function badRequest(res: Response, message = "Bad Request"): void {
  fail(res, 400, message);
}

/** 401 Unauthorized. */
export function unauthorized(res: Response, message = "請先登入管理後台"): void {
  fail(res, 401, message);
}

/** 404 Not Found. */
export function notFound(res: Response, message = "Not Found"): void {
  fail(res, 404, message);
}
