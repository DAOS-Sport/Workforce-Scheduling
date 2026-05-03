/**
 * Internal API authentication helpers (Task #75).
 *
 * Extracted from internal.routes.ts so the middleware can be tested
 * and imported independently of the route layer.
 */
import type { Request, Response, NextFunction } from "express";

export function extractToken(req: Request): string | undefined {
  const auth = req.header("authorization") ?? req.header("Authorization");
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1].trim();
  }
  const xInternal = req.header("x-internal-token") ?? req.header("X-Internal-Token");
  if (xInternal) return xInternal.trim();
  const xApiKey = req.header("x-api-key") ?? req.header("X-API-Key");
  if (xApiKey) return xApiKey.trim();
  if (typeof req.query.token === "string" && req.query.token) return req.query.token;
  return undefined;
}

export function requireInternalToken(req: Request, res: Response, next: NextFunction) {
  res.type("application/json");
  const expected = process.env.INTERNAL_API_TOKEN;
  if (!expected) {
    return res.status(503).json({
      code: "INTERNAL_API_DISABLED",
      message: "INTERNAL_API_TOKEN is not configured on the server",
    });
  }
  const provided = extractToken(req);
  if (!provided) {
    return res.status(401).json({
      code: "MISSING_INTERNAL_TOKEN",
      message: "Missing token. Provide one of: Authorization: Bearer, X-Internal-Token, X-API-Key.",
    });
  }
  if (provided !== expected) {
    return res.status(403).json({ code: "INVALID_INTERNAL_TOKEN", message: "Invalid token" });
  }
  next();
}
