/**
 * server/shared/middleware/cors.ts
 *
 * CORS middleware factory for endpoints that are consumed cross-origin
 * (e.g. the anomaly dashboard hosted on a different domain).
 *
 * Usage (in routes.ts):
 *   import { corsFor } from "../shared/middleware/cors";
 *   app.use("/api/anomaly-report", corsFor("GET, POST, OPTIONS"));
 */
import type { Request, Response, NextFunction } from "express";

/**
 * Returns an Express middleware that adds permissive CORS headers and
 * short-circuits OPTIONS preflight requests with 204.
 *
 * @param methods  Comma-separated list of allowed HTTP methods,
 *                 e.g. "GET, POST, OPTIONS"
 */
export function corsFor(methods: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", methods);
    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  };
}
