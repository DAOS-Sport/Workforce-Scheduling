/**
 * Internal API HTTP route layer (Task #72 重構 C).
 *
 * Auth: INTERNAL_API_TOKEN, accepted via three header forms:
 *   * Authorization: Bearer <token>
 *   * X-Internal-Token: <token>
 *   * X-API-Key: <token>
 *
 * All responses are JSON; we never fall through to HTML login pages.
 * All data assembly is delegated to internal.service.ts. This file is
 * deliberately kept thin — only auth wiring, query-param parsing,
 * validation, service invocation, and JSON serialization.
 */
import type { Express, Request, Response, NextFunction } from "express";
import {
  internalService,
  isValidDate,
  decodeCursor,
  parseLimit,
  todayInTaipei,
  isValidFacilityKey,
  VALID_FACILITY_KEYS,
} from "./internal.service";

// ---------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------

function extractToken(req: Request): string | undefined {
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

function requireInternalToken(req: Request, res: Response, next: NextFunction) {
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

// ---------------------------------------------------------------------
// Shared query parsers / response helpers
// ---------------------------------------------------------------------

function parseFacilityKey(req: Request, res: Response, required: boolean): string | undefined | false {
  const raw = req.query.facilityKey ? String(req.query.facilityKey).trim().toUpperCase() : "";
  if (!raw) {
    if (required) {
      res.status(400).json({ code: "MISSING_FACILITY_KEY", message: "facilityKey query parameter is required (A/B/C/D)" });
      return false;
    }
    return "";
  }
  if (!isValidFacilityKey(raw)) {
    res.status(400).json({
      code: "INVALID_FACILITY_KEY",
      message: `facilityKey must be one of ${VALID_FACILITY_KEYS.join(", ")}`,
      received: raw,
    });
    return false;
  }
  return raw;
}

function sendServiceError(res: Response, defaultCode: string, err: any) {
  const status = err?.status ?? 500;
  const code = err?.code ?? defaultCode;
  res.status(status).json({ code, message: err?.message || String(err) });
}

// ---------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------

export function registerInternalApi(app: Express) {
  // Auth gate for everything under /api/internal.
  app.use("/api/internal", requireInternalToken);

  app.get("/api/internal/admin/overview", async (_req, res) => {
    try {
      res.json(await internalService.getAdminOverview());
    } catch (err: any) {
      sendServiceError(res, "OVERVIEW_FAILED", err);
    }
  });

  app.get("/api/internal/schedules/today", async (req, res) => {
    const facilityKey = parseFacilityKey(req, res, true);
    if (facilityKey === false) return;
    try {
      res.json(await internalService.getTodaySchedules(facilityKey as string));
    } catch (err: any) {
      sendServiceError(res, "TODAY_SCHEDULE_FAILED", err);
    }
  });

  app.get("/api/internal/export/schedules", async (req, res) => {
    const from = String(req.query.from ?? "");
    const to = String(req.query.to ?? "");
    if (!isValidDate(from) || !isValidDate(to)) {
      return res.status(400).json({ code: "INVALID_DATE_RANGE", message: "from and to must be YYYY-MM-DD" });
    }
    if (from > to) {
      return res.status(400).json({ code: "INVALID_DATE_RANGE", message: "from must be <= to" });
    }
    const facilityKey = parseFacilityKey(req, res, false);
    if (facilityKey === false) return;
    const employeeNumber = req.query.employeeNumber ? String(req.query.employeeNumber).trim() : "";
    const includeDeleted = String(req.query.includeDeleted ?? "false").toLowerCase() === "true";
    const includeDispatch = String(req.query.includeDispatch ?? "true").toLowerCase() !== "false";
    const limit = parseLimit(req.query.limit);
    const offset = decodeCursor(typeof req.query.cursor === "string" ? req.query.cursor : undefined);

    try {
      res.json(await internalService.exportSchedules({
        from, to, facilityKey: facilityKey as string, employeeNumber, includeDeleted, includeDispatch, limit, offset,
      }));
    } catch (err: any) {
      sendServiceError(res, "EXPORT_SCHEDULES_FAILED", err);
    }
  });

  app.get("/api/internal/export/employees", async (req, res) => {
    const status = String(req.query.status ?? "active").toLowerCase();
    const facilityKey = parseFacilityKey(req, res, false);
    if (facilityKey === false) return;
    const limit = parseLimit(req.query.limit);
    const offset = decodeCursor(typeof req.query.cursor === "string" ? req.query.cursor : undefined);

    try {
      res.json(await internalService.exportEmployees({ status, facilityKey: facilityKey as string, limit, offset }));
    } catch (err: any) {
      sendServiceError(res, "EXPORT_EMPLOYEES_FAILED", err);
    }
  });

  app.get("/api/internal/export/venues", async (_req, res) => {
    try {
      res.json(await internalService.exportVenues());
    } catch (err: any) {
      sendServiceError(res, "EXPORT_VENUES_FAILED", err);
    }
  });

  app.get("/api/internal/export/shifts", async (_req, res) => {
    try {
      res.json(await internalService.exportShiftTemplates());
    } catch (err: any) {
      sendServiceError(res, "EXPORT_SHIFTS_FAILED", err);
    }
  });

  app.get("/api/internal/export/changes", async (req, res) => {
    const from = String(req.query.from ?? "");
    const to = String(req.query.to ?? "");
    if (!isValidDate(from) || !isValidDate(to)) {
      return res.status(400).json({ code: "INVALID_DATE_RANGE", message: "from and to must be YYYY-MM-DD" });
    }
    if (from > to) {
      return res.status(400).json({ code: "INVALID_DATE_RANGE", message: "from must be <= to" });
    }
    const facilityKey = parseFacilityKey(req, res, false);
    if (facilityKey === false) return;
    const limit = parseLimit(req.query.limit);
    const offset = decodeCursor(typeof req.query.cursor === "string" ? req.query.cursor : undefined);

    try {
      res.json(await internalService.exportChanges({ from, to, facilityKey: facilityKey as string, limit, offset }));
    } catch (err: any) {
      sendServiceError(res, "EXPORT_CHANGES_FAILED", err);
    }
  });

  app.get("/api/internal/export/snapshot", async (req, res) => {
    const from = String(req.query.from ?? todayInTaipei());
    const to = String(req.query.to ?? from);
    if (!isValidDate(from) || !isValidDate(to)) {
      return res.status(400).json({ code: "INVALID_DATE_RANGE", message: "from and to must be YYYY-MM-DD" });
    }
    if (from > to) {
      return res.status(400).json({ code: "INVALID_DATE_RANGE", message: "from must be <= to" });
    }
    const facilityKey = parseFacilityKey(req, res, false);
    if (facilityKey === false) return;

    try {
      res.json(await internalService.exportSnapshot({ from, to, facilityKey: facilityKey as string }));
    } catch (err: any) {
      sendServiceError(res, "EXPORT_SNAPSHOT_FAILED", err);
    }
  });

  // JSON 404 fallback for any unknown /api/internal/* path.
  app.use("/api/internal", (_req, res) => {
    res.status(404).json({ code: "INTERNAL_ROUTE_NOT_FOUND", message: "Not found" });
  });
}
