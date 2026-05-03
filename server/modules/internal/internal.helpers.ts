/**
 * Internal API shared query-param parsers and response helpers (Task #75).
 *
 * Extracted from internal.routes.ts so they can be reused and tested
 * independently of the route layer.
 */
import type { Request, Response } from "express";
import { isValidFacilityKey, VALID_FACILITY_KEYS } from "./internal.service";

export function parseFacilityKey(req: Request, res: Response, required: boolean): string | undefined | false {
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

export function sendServiceError(res: Response, defaultCode: string, err: any) {
  const status = err?.status ?? 500;
  const code = err?.code ?? defaultCode;
  res.status(status).json({ code, message: err?.message || String(err) });
}
