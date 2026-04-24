import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { REGIONS_DATA, type Employee, type Shift, type DispatchShift } from "@shared/schema";

// Server-to-server internal API. Auth via X-Internal-Token header
// (or `?token=` for limited situations) matched against INTERNAL_API_TOKEN.
// All responses are JSON; we never fall through to HTML login pages.

const VALID_REGION_CODES = REGIONS_DATA.map((r) => r.code) as readonly string[];

function todayInTaipei(): string {
  // YYYY-MM-DD in Asia/Taipei. Replit servers run UTC, so derive via locale.
  const taipei = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const Y = taipei.getFullYear();
  const M = String(taipei.getMonth() + 1).padStart(2, "0");
  const D = String(taipei.getDate()).padStart(2, "0");
  return `${Y}-${M}-${D}`;
}

function requireInternalToken(req: Request, res: Response, next: NextFunction) {
  // Always return JSON, never HTML.
  res.type("application/json");

  const expected = process.env.INTERNAL_API_TOKEN;
  if (!expected) {
    return res.status(503).json({
      code: "INTERNAL_API_DISABLED",
      message: "INTERNAL_API_TOKEN is not configured on the server",
    });
  }

  const headerToken =
    (req.header("x-internal-token") as string | undefined) ??
    (req.header("X-Internal-Token") as string | undefined);
  const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
  const provided = headerToken ?? queryToken;

  if (!provided) {
    return res.status(401).json({
      code: "MISSING_INTERNAL_TOKEN",
      message: "Missing X-Internal-Token header",
    });
  }
  if (provided !== expected) {
    return res.status(403).json({
      code: "INVALID_INTERNAL_TOKEN",
      message: "Invalid X-Internal-Token",
    });
  }
  next();
}

export function registerInternalApi(app: Express) {
  // Apply auth to every /api/internal/* route.
  app.use("/api/internal", requireInternalToken);

  // Catch-all 404 inside /api/internal so unknown paths still return JSON
  // (registered after real routes via Express ordering: real routes are
  // declared below, so they match first).

  // ---------------------------------------------------------------------
  // GET /api/internal/admin/overview
  // High-level dashboard summary for 駿斯工作台.
  // ---------------------------------------------------------------------
  app.get("/api/internal/admin/overview", async (_req, res) => {
    try {
      const today = todayInTaipei();
      const [allEmployees, regions, shiftsToday, dispatchToday, pendingAmend, pendingLeave, pendingOT, anomalies] =
        await Promise.all([
          storage.getAllEmployees(),
          storage.getRegions(),
          storage.getShiftsByDate(today),
          storage.getDispatchShiftsByDate(today),
          storage.getClockAmendments("pending"),
          storage.getLeaveRequests("pending"),
          storage.getOvertimeRequests("pending"),
          storage.getAnomalyReports(),
        ]);

      const regionById = new Map(regions.map((r) => [r.id, r]));
      const activeEmployees = allEmployees.filter((e) => e.status === "active");

      const employeesByRegion: Record<string, number> = {};
      for (const code of VALID_REGION_CODES) employeesByRegion[code] = 0;
      for (const e of activeEmployees) {
        const r = regionById.get(e.regionId);
        if (r && employeesByRegion[r.code] !== undefined) employeesByRegion[r.code] += 1;
      }

      const pendingAnomalyReports = anomalies.filter(
        (a) => !a.resolution || a.resolution === "pending",
      ).length;

      res.json({
        generatedAt: new Date().toISOString(),
        date: today,
        timezone: "Asia/Taipei",
        employees: {
          totalActive: activeEmployees.length,
          totalAll: allEmployees.length,
          byRegion: employeesByRegion,
        },
        shiftsToday: {
          regular: shiftsToday.filter((s: Shift) => s.status === "active").length,
          dispatch: dispatchToday.length,
          total: shiftsToday.filter((s: Shift) => s.status === "active").length + dispatchToday.length,
        },
        pendingReviews: {
          clockAmendments: pendingAmend.length,
          leaveRequests: pendingLeave.length,
          overtimeRequests: pendingOT.length,
          anomalyReports: pendingAnomalyReports,
        },
      });
    } catch (err: any) {
      res.status(500).json({ code: "OVERVIEW_FAILED", message: err?.message || String(err) });
    }
  });

  // ---------------------------------------------------------------------
  // GET /api/internal/schedules/today?facilityKey=A
  // Today's regular + dispatch shifts for a given region (A/B/C/D).
  // ---------------------------------------------------------------------
  app.get("/api/internal/schedules/today", async (req, res) => {
    try {
      const facilityKey = String(req.query.facilityKey || "").trim().toUpperCase();
      if (!facilityKey) {
        return res.status(400).json({
          code: "MISSING_FACILITY_KEY",
          message: "facilityKey query parameter is required (A/B/C/D)",
        });
      }
      if (!VALID_REGION_CODES.includes(facilityKey)) {
        return res.status(400).json({
          code: "INVALID_FACILITY_KEY",
          message: `facilityKey must be one of ${VALID_REGION_CODES.join(", ")}`,
          received: facilityKey,
        });
      }

      const region = await storage.getRegionByCode(facilityKey);
      if (!region) {
        return res.status(404).json({
          code: "REGION_NOT_FOUND",
          message: `Region ${facilityKey} not found in database`,
        });
      }

      const today = todayInTaipei();
      const [allEmployees, allVenues, shiftsToday, dispatchToday] = await Promise.all([
        storage.getAllEmployees(),
        storage.getVenuesByRegion(region.id),
        storage.getShiftsByDate(today),
        storage.getDispatchShiftsByDate(today),
      ]);

      const employeeById = new Map<number, Employee>(allEmployees.map((e) => [e.id, e]));
      const venueIdSet = new Set<number>(allVenues.map((v) => v.id));
      const venueById = new Map(allVenues.map((v) => [v.id, v]));

      // Regular shifts: keep those whose venue belongs to this region
      // (or whose employee belongs to this region — covers dispatch-linked
      // employees clocking in at venues from another region).
      const regularOut = shiftsToday
        .filter((s: Shift) => s.status === "active")
        .filter((s: Shift) => {
          if (venueIdSet.has(s.venueId)) return true;
          const emp = employeeById.get(s.employeeId);
          return !!emp && emp.regionId === region.id;
        })
        .map((s: Shift) => {
          const emp = employeeById.get(s.employeeId);
          const v = venueById.get(s.venueId);
          return {
            kind: "regular" as const,
            shiftId: s.id,
            date: s.date,
            startTime: s.startTime,
            endTime: s.endTime,
            role: s.role,
            employee: emp
              ? { id: emp.id, name: emp.name, employeeCode: emp.employeeCode, phone: emp.phone }
              : null,
            venue: v
              ? { id: v.id, name: v.name, shortName: v.shortName }
              : { id: s.venueId, name: null, shortName: null },
            isDispatch: !!s.isDispatch,
            dispatch: s.isDispatch
              ? {
                  company: s.dispatchCompany,
                  name: s.dispatchName,
                  phone: s.dispatchPhone,
                }
              : null,
            notes: s.notes,
          };
        });

      const dispatchOut = dispatchToday
        .filter((d: DispatchShift) => d.regionId === region.id)
        .map((d: DispatchShift) => {
          const v = d.venueId != null ? venueById.get(d.venueId) : undefined;
          return {
            kind: "dispatch" as const,
            shiftId: d.id,
            date: d.date,
            startTime: d.startTime,
            endTime: d.endTime,
            role: d.role,
            dispatch: {
              name: d.dispatchName,
              company: d.dispatchCompany,
              phone: d.dispatchPhone,
            },
            linkedEmployeeId: d.linkedEmployeeId,
            venue: v
              ? { id: v.id, name: v.name, shortName: v.shortName }
              : d.venueId != null
                ? { id: d.venueId, name: null, shortName: null }
                : null,
            notes: d.notes,
          };
        });

      res.json({
        date: today,
        timezone: "Asia/Taipei",
        facilityKey,
        region: { id: region.id, code: region.code, name: region.name },
        counts: {
          regular: regularOut.length,
          dispatch: dispatchOut.length,
          total: regularOut.length + dispatchOut.length,
        },
        shifts: [...regularOut, ...dispatchOut],
      });
    } catch (err: any) {
      res.status(500).json({ code: "TODAY_SCHEDULE_FAILED", message: err?.message || String(err) });
    }
  });

  // JSON 404 fallback for any unknown /api/internal/* path.
  app.use("/api/internal", (_req, res) => {
    res.status(404).json({ code: "INTERNAL_ROUTE_NOT_FOUND", message: "Not found" });
  });
}
