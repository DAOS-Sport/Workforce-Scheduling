import type { Request, Response, NextFunction } from "express";
import { pipelineForPath } from "../../core/health/flowRules";
import { withPipeline } from "./context";
import { recordLog } from "./collector";
import { runWithRequestId } from "../http/requestId";

/** Route/status metadata only: never capture body or query strings. */
export function logRequestPipeline(req: Request, res: Response, next: NextFunction): void {
  const pipeline = pipelineForPath(req.path) ?? "server.errors";
  if (pipeline === "portal.login" || pipeline === "admin.login") {
    res.on("finish", () => {
      if (res.statusCode >= 400 && res.statusCode < 500) {
        runWithRequestId(res.locals.requestId, () => recordLog("warn", `login refused HTTP ${res.statusCode}`, pipeline));
      } else if (res.statusCode < 400) {
        runWithRequestId(res.locals.requestId, () => recordLog("info", "login request succeeded", pipeline));
      }
    });
  }
  withPipeline(pipeline, next);
}
