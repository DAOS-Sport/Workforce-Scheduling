import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { db } from "./db";
import {
  REGIONS_DATA,
  dispatchShifts as dispatchShiftsTable,
  shiftAuditLog as shiftAuditLogTable,
  type Employee,
  type Shift,
  type DispatchShift,
  type Venue,
  type Region,
  type VenueShiftTemplate,
  type ShiftAuditLog,
} from "@shared/schema";
import { and, gte, lte, inArray, asc } from "drizzle-orm";

// =====================================================================
// Server-to-server internal API.
// Auth: INTERNAL_API_TOKEN, accepted via three header forms:
//   * Authorization: Bearer <token>
//   * X-Internal-Token: <token>
//   * X-API-Key: <token>
// All responses are JSON; we never fall through to HTML login pages.
// =====================================================================

const VALID_REGION_CODES = REGIONS_DATA.map((r) => r.code) as readonly string[];
const TPE_OFFSET = "+08:00";
const DEFAULT_LIMIT = 5000;

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function todayInTaipei(): string {
  const taipei = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const Y = taipei.getFullYear();
  const M = String(taipei.getMonth() + 1).padStart(2, "0");
  const D = String(taipei.getDate()).padStart(2, "0");
  return `${Y}-${M}-${D}`;
}

function nowInTaipeiIso(): string {
  // ISO-8601 with explicit +08:00 offset.
  const taipei = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${taipei.getFullYear()}-${pad(taipei.getMonth() + 1)}-${pad(taipei.getDate())}` +
    `T${pad(taipei.getHours())}:${pad(taipei.getMinutes())}:${pad(taipei.getSeconds())}` +
    TPE_OFFSET
  );
}

function isValidDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function normTime(t: string | null | undefined): string {
  if (!t) return "";
  // Accept "HH:mm" or "HH:mm:ss" — always return "HH:mm:ss".
  const parts = t.split(":");
  const hh = (parts[0] ?? "00").padStart(2, "0");
  const mm = (parts[1] ?? "00").padStart(2, "0");
  const ss = (parts[2] ?? "00").padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function nextDateStr(date: string): string {
  const [Y, M, D] = date.split("-").map(Number);
  const d = new Date(Date.UTC(Y, M - 1, D + 1));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function buildStartEndAt(date: string, startTime: string, endTime: string): { startAt: string; endAt: string } {
  const sNorm = normTime(startTime);
  let eNorm = normTime(endTime);
  let endDate = date;
  // Cross-day: end <= start, OR end is "24:00:00".
  if (eNorm === "24:00:00") {
    eNorm = "00:00:00";
    endDate = nextDateStr(date);
  } else if (eNorm <= sNorm) {
    endDate = nextDateStr(date);
  }
  return {
    startAt: `${date}T${sNorm}${TPE_OFFSET}`,
    endAt: `${endDate}T${eNorm}${TPE_OFFSET}`,
  };
}

function periodFromTimes(startTime: string, endTime: string): "early" | "mid" | "late" | "custom" {
  const s = normTime(startTime);
  const e = normTime(endTime);
  if (!s || !e) return "custom";
  const sH = parseInt(s.slice(0, 2), 10);
  const eH = parseInt(e.slice(0, 2), 10);
  // Cross-day or ending at/after 22:00 → late.
  if (e === "24:00:00" || e <= s || (eH >= 22 && sH >= 14)) return "late";
  if (sH < 12) return "early";
  if (sH < 17) return "mid";
  return "late";
}

function venueKey(v: Pick<Venue, "id" | "shortName" | "name">): string {
  // Stable, machine-friendly key. shortName is Chinese; we keep it as-is
  // (URL-encoded if necessary) and append id for uniqueness/portability.
  const base = (v.shortName || v.name || "venue").trim().replace(/\s+/g, "_");
  return `${base}_${v.id}`;
}

function venueAliases(v: Pick<Venue, "shortName" | "name">): string[] {
  const out = new Set<string>();
  if (v.shortName) out.add(v.shortName);
  if (v.name) {
    out.add(v.name);
    // strip trailing 館/場館/中心 for an extra alias.
    const stripped = v.name.replace(/(館|中心)$/u, "");
    if (stripped && stripped !== v.name) out.add(stripped);
  }
  return Array.from(out);
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const n = parseInt(Buffer.from(cursor, "base64").toString("utf8"), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64");
}

function paginate<T>(items: T[], limit: number, offset: number): { slice: T[]; nextCursor: string | null; hasMore: boolean } {
  const slice = items.slice(offset, offset + limit);
  const newOffset = offset + slice.length;
  const hasMore = newOffset < items.length;
  return { slice, nextCursor: hasMore ? encodeCursor(newOffset) : null, hasMore };
}

function parseLimit(raw: unknown, fallback = DEFAULT_LIMIT, max = 20000): number {
  const n = parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

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
// Enrichment helpers used across endpoints
// ---------------------------------------------------------------------

interface EnrichmentBundle {
  regions: Region[];
  regionById: Map<number, Region>;
  regionByCode: Map<string, Region>;
  venues: Venue[];
  venueById: Map<number, Venue>;
  employees: Employee[];
  employeeById: Map<number, Employee>;
}

async function loadEnrichment(): Promise<EnrichmentBundle> {
  const [regions, venues, employees] = await Promise.all([
    storage.getRegions(),
    storage.getAllVenues(),
    storage.getAllEmployees(),
  ]);
  return {
    regions,
    regionById: new Map(regions.map((r) => [r.id, r])),
    regionByCode: new Map(regions.map((r) => [r.code, r])),
    venues,
    venueById: new Map(venues.map((v) => [v.id, v])),
    employees,
    employeeById: new Map(employees.map((e) => [e.id, e])),
  };
}

function regionDtoFromVenue(venue: Venue | undefined, b: EnrichmentBundle) {
  if (!venue) return null;
  const r = b.regionById.get(venue.regionId);
  return r ? { id: r.id, code: r.code, name: r.name } : null;
}

function venueDto(v: Venue | undefined) {
  if (!v) return null;
  return {
    id: v.id,
    key: venueKey(v),
    name: v.name,
    shortName: v.shortName,
    aliases: venueAliases(v),
  };
}

function employeeDto(e: Employee | undefined) {
  if (!e) return null;
  return {
    id: e.id,
    employeeNumber: e.employeeCode,
    name: e.name,
    title: e.role,
    department: e.department,
    status: e.status,
  };
}

// ---------------------------------------------------------------------
// Shift mappers (regular + dispatch)
// ---------------------------------------------------------------------

function mapRegularShift(s: Shift, b: EnrichmentBundle) {
  const venue = b.venueById.get(s.venueId);
  const employee = b.employeeById.get(s.employeeId);
  const region = regionDtoFromVenue(venue, b)
    ?? (employee ? (() => {
      const r = b.regionById.get(employee.regionId);
      return r ? { id: r.id, code: r.code, name: r.name } : null;
    })() : null);
  const startTime = normTime(s.startTime);
  const endTime = normTime(s.endTime);
  const { startAt, endAt } = buildStartEndAt(s.date, startTime, endTime);
  const period = periodFromTimes(startTime, endTime);

  return {
    rawId: `shift_${s.id}`,
    sourceTable: "shifts",
    sourceRowId: s.id,
    date: s.date,
    region,
    venue: venueDto(venue),
    shift: {
      id: `shift_${s.id}`,
      code: null,
      name: null,
      label: null,
      startTime,
      endTime,
      startAt,
      endAt,
      period,
      rawPeriod: null,
    },
    employee: employeeDto(employee),
    assignment: {
      kind: s.isDispatch ? "dispatch" : "regular",
      status: s.status === "cancelled" ? "cancelled" : "scheduled",
      isDispatch: !!s.isDispatch,
      isSubstitute: false,
      dispatchFromVenue: null,
      dispatchToVenue: null,
      note: s.notes ?? "",
    },
    audit: {
      createdAt: null,
      updatedAt: null,
      deletedAt: s.cancelledAt ? (s.cancelledAt as unknown as Date)?.toISOString?.() ?? String(s.cancelledAt) : null,
      updatedBy: s.cancelledBy ?? "",
    },
    raw: s,
  };
}

function mapDispatchShift(d: DispatchShift, b: EnrichmentBundle) {
  const venue = d.venueId != null ? b.venueById.get(d.venueId) : undefined;
  const region = b.regionById.get(d.regionId);
  const linkedEmployee = d.linkedEmployeeId != null ? b.employeeById.get(d.linkedEmployeeId) : undefined;
  const startTime = normTime(d.startTime);
  const endTime = normTime(d.endTime);
  const { startAt, endAt } = buildStartEndAt(d.date, startTime, endTime);
  const period = periodFromTimes(startTime, endTime);

  return {
    rawId: `dispatch_${d.id}`,
    sourceTable: "dispatch_shifts",
    sourceRowId: d.id,
    date: d.date,
    region: region ? { id: region.id, code: region.code, name: region.name } : null,
    venue: venueDto(venue),
    shift: {
      id: `dispatch_${d.id}`,
      code: null,
      name: null,
      label: null,
      startTime,
      endTime,
      startAt,
      endAt,
      period,
      rawPeriod: null,
    },
    employee: linkedEmployee
      ? employeeDto(linkedEmployee)
      : {
          id: null,
          employeeNumber: null,
          name: d.dispatchName,
          title: d.role,
          department: d.dispatchCompany,
          status: "dispatch",
        },
    assignment: {
      kind: "dispatch",
      status: "scheduled",
      isDispatch: true,
      isSubstitute: false,
      dispatchFromVenue: d.dispatchCompany ?? null,
      dispatchToVenue: venue ? venueDto(venue) : null,
      note: d.notes ?? "",
    },
    audit: {
      createdAt: null,
      updatedAt: null,
      deletedAt: null,
      updatedBy: "",
    },
    raw: d,
  };
}

// ---------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------

export function registerInternalApi(app: Express) {
  // Auth gate for everything under /api/internal.
  app.use("/api/internal", requireInternalToken);

  // -------------------------------------------------------------------
  // GET /api/internal/admin/overview  (existing)
  // -------------------------------------------------------------------
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
      const pendingAnomalyReports = anomalies.filter((a) => !a.resolution || a.resolution === "pending").length;
      const activeRegular = shiftsToday.filter((s: Shift) => s.status === "active").length;

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
          regular: activeRegular,
          dispatch: dispatchToday.length,
          total: activeRegular + dispatchToday.length,
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

  // -------------------------------------------------------------------
  // GET /api/internal/schedules/today  (existing)
  // -------------------------------------------------------------------
  app.get("/api/internal/schedules/today", async (req, res) => {
    try {
      const facilityKey = String(req.query.facilityKey || "").trim().toUpperCase();
      if (!facilityKey) {
        return res.status(400).json({ code: "MISSING_FACILITY_KEY", message: "facilityKey query parameter is required (A/B/C/D)" });
      }
      if (!VALID_REGION_CODES.includes(facilityKey)) {
        return res.status(400).json({
          code: "INVALID_FACILITY_KEY",
          message: `facilityKey must be one of ${VALID_REGION_CODES.join(", ")}`,
          received: facilityKey,
        });
      }
      const region = await storage.getRegionByCode(facilityKey);
      if (!region) return res.status(404).json({ code: "REGION_NOT_FOUND", message: `Region ${facilityKey} not found` });

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
            employee: emp ? { id: emp.id, name: emp.name, employeeCode: emp.employeeCode, phone: emp.phone } : null,
            venue: v ? { id: v.id, name: v.name, shortName: v.shortName } : { id: s.venueId, name: null, shortName: null },
            isDispatch: !!s.isDispatch,
            dispatch: s.isDispatch
              ? { company: s.dispatchCompany, name: s.dispatchName, phone: s.dispatchPhone }
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
            dispatch: { name: d.dispatchName, company: d.dispatchCompany, phone: d.dispatchPhone },
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
        counts: { regular: regularOut.length, dispatch: dispatchOut.length, total: regularOut.length + dispatchOut.length },
        shifts: [...regularOut, ...dispatchOut],
      });
    } catch (err: any) {
      res.status(500).json({ code: "TODAY_SCHEDULE_FAILED", message: err?.message || String(err) });
    }
  });

  // -------------------------------------------------------------------
  // GET /api/internal/export/schedules
  // -------------------------------------------------------------------
  app.get("/api/internal/export/schedules", async (req, res) => {
    try {
      const from = String(req.query.from ?? "");
      const to = String(req.query.to ?? "");
      if (!isValidDate(from) || !isValidDate(to)) {
        return res.status(400).json({ code: "INVALID_DATE_RANGE", message: "from and to must be YYYY-MM-DD" });
      }
      if (from > to) {
        return res.status(400).json({ code: "INVALID_DATE_RANGE", message: "from must be <= to" });
      }
      const facilityKey = req.query.facilityKey ? String(req.query.facilityKey).trim().toUpperCase() : "";
      const employeeNumber = req.query.employeeNumber ? String(req.query.employeeNumber).trim() : "";
      const includeDeleted = String(req.query.includeDeleted ?? "false").toLowerCase() === "true";
      const includeDispatch = String(req.query.includeDispatch ?? "true").toLowerCase() !== "false";
      const limit = parseLimit(req.query.limit);
      const offset = decodeCursor(typeof req.query.cursor === "string" ? req.query.cursor : undefined);

      const bundle = await loadEnrichment();

      let regionFilter: Region | undefined;
      if (facilityKey) {
        if (!VALID_REGION_CODES.includes(facilityKey)) {
          return res.status(400).json({
            code: "INVALID_FACILITY_KEY",
            message: `facilityKey must be one of ${VALID_REGION_CODES.join(", ")}`,
            received: facilityKey,
          });
        }
        regionFilter = bundle.regionByCode.get(facilityKey);
      }

      const shifts = await storage.getAllShiftsByDateRange(from, to);
      let dispatchRows: DispatchShift[] = [];
      if (includeDispatch) {
        dispatchRows = await db.select().from(dispatchShiftsTable)
          .where(and(gte(dispatchShiftsTable.date, from), lte(dispatchShiftsTable.date, to)));
      }

      let regularItems = shifts;
      if (!includeDeleted) regularItems = regularItems.filter((s) => s.status === "active");
      if (regionFilter) {
        const venueIdsInRegion = new Set(bundle.venues.filter((v) => v.regionId === regionFilter!.id).map((v) => v.id));
        regularItems = regularItems.filter((s) => {
          if (venueIdsInRegion.has(s.venueId)) return true;
          const emp = bundle.employeeById.get(s.employeeId);
          return !!emp && emp.regionId === regionFilter!.id;
        });
      }
      if (employeeNumber) {
        const emp = bundle.employees.find((e) => e.employeeCode === employeeNumber);
        if (!emp) {
          regularItems = [];
          dispatchRows = [];
        } else {
          regularItems = regularItems.filter((s) => s.employeeId === emp.id);
          dispatchRows = dispatchRows.filter((d) => d.linkedEmployeeId === emp.id);
        }
      }
      if (regionFilter) {
        dispatchRows = dispatchRows.filter((d) => d.regionId === regionFilter!.id);
      }

      const merged = [
        ...regularItems.map((s) => mapRegularShift(s, bundle)),
        ...dispatchRows.map((d) => mapDispatchShift(d, bundle)),
      ].sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        const aS = a.shift.startTime, bS = b.shift.startTime;
        if (aS !== bS) return aS < bS ? -1 : 1;
        return a.sourceRowId - b.sourceRowId;
      });

      const { slice, nextCursor, hasMore } = paginate(merged, limit, offset);

      res.json({
        items: slice,
        pageInfo: { limit, nextCursor, hasMore, total: merged.length },
        filters: { from, to, facilityKey: facilityKey || null, employeeNumber: employeeNumber || null, includeDeleted, includeDispatch },
        generatedAt: nowInTaipeiIso(),
      });
    } catch (err: any) {
      res.status(500).json({ code: "EXPORT_SCHEDULES_FAILED", message: err?.message || String(err) });
    }
  });

  // -------------------------------------------------------------------
  // GET /api/internal/export/employees
  // -------------------------------------------------------------------
  app.get("/api/internal/export/employees", async (req, res) => {
    try {
      const status = String(req.query.status ?? "active").toLowerCase();
      const facilityKey = req.query.facilityKey ? String(req.query.facilityKey).trim().toUpperCase() : "";
      const limit = parseLimit(req.query.limit);
      const offset = decodeCursor(typeof req.query.cursor === "string" ? req.query.cursor : undefined);

      const bundle = await loadEnrichment();
      let regionFilterId: number | null = null;
      if (facilityKey) {
        if (!VALID_REGION_CODES.includes(facilityKey)) {
          return res.status(400).json({
            code: "INVALID_FACILITY_KEY",
            message: `facilityKey must be one of ${VALID_REGION_CODES.join(", ")}`,
            received: facilityKey,
          });
        }
        const r = bundle.regionByCode.get(facilityKey);
        if (!r) return res.status(404).json({ code: "REGION_NOT_FOUND", message: `Region ${facilityKey} not found` });
        regionFilterId = r.id;
      }

      let list = bundle.employees;
      if (status !== "all") list = list.filter((e) => e.status === status);
      if (regionFilterId != null) list = list.filter((e) => e.regionId === regionFilterId);

      const items = list.map((e) => {
        const r = bundle.regionById.get(e.regionId);
        const homeVenues = bundle.venues.filter((v) => v.regionId === e.regionId);
        return {
          id: e.id,
          employeeNumber: e.employeeCode,
          name: e.name,
          title: e.role,
          department: e.department,
          regionCode: r?.code ?? null,
          regionName: r?.name ?? null,
          venueKeys: homeVenues.map(venueKey),
          phone: e.phone,
          email: e.email,
          lineId: e.lineId,
          employmentType: e.employmentType,
          isAdmin: !!e.isAdmin,
          status: e.status,
          raw: e,
        };
      }).sort((a, b) => (a.employeeNumber || "").localeCompare(b.employeeNumber || ""));

      const { slice, nextCursor, hasMore } = paginate(items, limit, offset);

      res.json({
        items: slice,
        pageInfo: { limit, nextCursor, hasMore, total: items.length },
        filters: { status, facilityKey: facilityKey || null },
        generatedAt: nowInTaipeiIso(),
      });
    } catch (err: any) {
      res.status(500).json({ code: "EXPORT_EMPLOYEES_FAILED", message: err?.message || String(err) });
    }
  });

  // -------------------------------------------------------------------
  // GET /api/internal/export/venues
  // -------------------------------------------------------------------
  app.get("/api/internal/export/venues", async (_req, res) => {
    try {
      const bundle = await loadEnrichment();
      const items = bundle.venues
        .map((v) => {
          const r = bundle.regionById.get(v.regionId);
          return {
            id: v.id,
            key: venueKey(v),
            name: v.name,
            shortName: v.shortName,
            regionCode: r?.code ?? null,
            regionName: r?.name ?? null,
            aliases: venueAliases(v),
            address: v.address,
            latitude: v.latitude,
            longitude: v.longitude,
            radius: v.radius,
            taxId: v.taxId,
            isInternal: !!v.isInternal,
            operationType: v.operationType,
            lineGroupId: null,
            isActive: true,
            raw: v,
          };
        })
        .sort((a, b) => (a.regionCode || "").localeCompare(b.regionCode || "") || a.id - b.id);

      res.json({ items, generatedAt: nowInTaipeiIso() });
    } catch (err: any) {
      res.status(500).json({ code: "EXPORT_VENUES_FAILED", message: err?.message || String(err) });
    }
  });

  // -------------------------------------------------------------------
  // GET /api/internal/export/shifts (shift template definitions)
  // -------------------------------------------------------------------
  app.get("/api/internal/export/shifts", async (_req, res) => {
    try {
      const bundle = await loadEnrichment();
      const allTemplates: Array<VenueShiftTemplate & { venueId: number }> = [];
      for (const v of bundle.venues) {
        const ts = await storage.getVenueShiftTemplates(v.id);
        for (const t of ts) allTemplates.push(t);
      }

      // Deduplicate by (startTime, endTime, role, dayType, shiftLabel) so the
      // workstation gets canonical shift definitions, but keep the raw rows
      // so it can drill down per venue when needed.
      const seen = new Map<string, any>();
      let order = 0;
      for (const t of allTemplates) {
        const startTime = normTime(t.startTime);
        const endTime = normTime(t.endTime);
        const period = periodFromTimes(startTime, endTime);
        const key = `${t.shiftLabel}|${startTime}|${endTime}|${t.role}|${t.dayType}`;
        if (seen.has(key)) {
          seen.get(key).rawRows.push(t);
          continue;
        }
        seen.set(key, {
          id: `tpl_${key}`,
          code: `${t.shiftLabel}_${period}`,
          name: t.shiftLabel,
          label: t.shiftLabel,
          role: t.role,
          dayType: t.dayType,
          startTime,
          endTime,
          period,
          rawPeriod: t.shiftLabel,
          requiredCount: t.requiredCount,
          sortOrder: ++order,
          rawRows: [t],
        });
      }

      const items = Array.from(seen.values()).map((it) => ({ ...it, raw: it.rawRows[0] }));
      res.json({ items, generatedAt: nowInTaipeiIso() });
    } catch (err: any) {
      res.status(500).json({ code: "EXPORT_SHIFTS_FAILED", message: err?.message || String(err) });
    }
  });

  // -------------------------------------------------------------------
  // GET /api/internal/export/changes  (shift audit log)
  // -------------------------------------------------------------------
  app.get("/api/internal/export/changes", async (req, res) => {
    try {
      const from = String(req.query.from ?? "");
      const to = String(req.query.to ?? "");
      if (!isValidDate(from) || !isValidDate(to)) {
        return res.status(400).json({ code: "INVALID_DATE_RANGE", message: "from and to must be YYYY-MM-DD" });
      }
      if (from > to) {
        return res.status(400).json({ code: "INVALID_DATE_RANGE", message: "from must be <= to" });
      }
      const facilityKey = req.query.facilityKey ? String(req.query.facilityKey).trim().toUpperCase() : "";
      const limit = parseLimit(req.query.limit);
      const offset = decodeCursor(typeof req.query.cursor === "string" ? req.query.cursor : undefined);

      const bundle = await loadEnrichment();
      let regionId: number | null = null;
      if (facilityKey) {
        if (!VALID_REGION_CODES.includes(facilityKey)) {
          return res.status(400).json({
            code: "INVALID_FACILITY_KEY",
            message: `facilityKey must be one of ${VALID_REGION_CODES.join(", ")}`,
            received: facilityKey,
          });
        }
        const r = bundle.regionByCode.get(facilityKey);
        if (!r) return res.status(404).json({ code: "REGION_NOT_FOUND", message: `Region ${facilityKey} not found` });
        regionId = r.id;
      }

      // Find shifts whose date is in range; these scope which audit log
      // rows we return.
      const shifts = await storage.getAllShiftsByDateRange(from, to);
      let inRangeShifts = shifts;
      if (regionId != null) {
        const venueIdsInRegion = new Set(bundle.venues.filter((v) => v.regionId === regionId).map((v) => v.id));
        inRangeShifts = inRangeShifts.filter((s) => {
          if (venueIdsInRegion.has(s.venueId)) return true;
          const emp = bundle.employeeById.get(s.employeeId);
          return !!emp && emp.regionId === regionId;
        });
      }
      const shiftById = new Map(inRangeShifts.map((s) => [s.id, s]));
      const ids = Array.from(shiftById.keys());

      let auditRows: ShiftAuditLog[] = [];
      if (ids.length > 0) {
        // Chunk inArray to avoid pathological parameter explosion.
        const CHUNK = 1000;
        for (let i = 0; i < ids.length; i += CHUNK) {
          const slice = ids.slice(i, i + CHUNK);
          const rows = await db.select().from(shiftAuditLogTable)
            .where(inArray(shiftAuditLogTable.shiftId, slice))
            .orderBy(asc(shiftAuditLogTable.createdAt));
          auditRows.push(...rows);
        }
      }

      const items = auditRows.map((row) => {
        const shift = shiftById.get(row.shiftId);
        const payload = (row.payload as any) ?? {};
        const before = (payload && typeof payload === "object" && payload.before) || null;
        const after = (payload && typeof payload === "object" && payload.after) || null;
        const reason = (payload && typeof payload === "object" && (payload.reason ?? payload.cancelReason)) || "";
        return {
          id: row.id,
          scheduleRawId: `shift_${row.shiftId}`,
          shiftId: row.shiftId,
          date: shift?.date ?? null,
          changeType: row.action,
          before,
          after,
          reason,
          changedBy: row.actor,
          changedAt: row.createdAt ? (row.createdAt as Date).toISOString() : null,
          raw: row,
        };
      }).sort((a, b) => {
        const aT = a.changedAt ?? "";
        const bT = b.changedAt ?? "";
        if (aT !== bT) return aT < bT ? -1 : 1;
        return a.id - b.id;
      });

      const { slice, nextCursor, hasMore } = paginate(items, limit, offset);

      res.json({
        items: slice,
        pageInfo: { limit, nextCursor, hasMore, total: items.length },
        filters: { from, to, facilityKey: facilityKey || null },
        generatedAt: nowInTaipeiIso(),
      });
    } catch (err: any) {
      res.status(500).json({ code: "EXPORT_CHANGES_FAILED", message: err?.message || String(err) });
    }
  });

  // -------------------------------------------------------------------
  // GET /api/internal/export/snapshot
  // -------------------------------------------------------------------
  app.get("/api/internal/export/snapshot", async (req, res) => {
    try {
      const from = String(req.query.from ?? todayInTaipei());
      const to = String(req.query.to ?? from);
      if (!isValidDate(from) || !isValidDate(to)) {
        return res.status(400).json({ code: "INVALID_DATE_RANGE", message: "from and to must be YYYY-MM-DD" });
      }
      if (from > to) {
        return res.status(400).json({ code: "INVALID_DATE_RANGE", message: "from must be <= to" });
      }
      const facilityKey = req.query.facilityKey ? String(req.query.facilityKey).trim().toUpperCase() : "";

      const bundle = await loadEnrichment();
      let regionFilter: Region | undefined;
      if (facilityKey) {
        if (!VALID_REGION_CODES.includes(facilityKey)) {
          return res.status(400).json({
            code: "INVALID_FACILITY_KEY",
            message: `facilityKey must be one of ${VALID_REGION_CODES.join(", ")}`,
            received: facilityKey,
          });
        }
        regionFilter = bundle.regionByCode.get(facilityKey);
        if (!regionFilter) return res.status(404).json({ code: "REGION_NOT_FOUND", message: `Region ${facilityKey} not found` });
      }

      // Venues
      const venues = (regionFilter ? bundle.venues.filter((v) => v.regionId === regionFilter!.id) : bundle.venues)
        .map((v) => {
          const r = bundle.regionById.get(v.regionId);
          return {
            id: v.id,
            key: venueKey(v),
            name: v.name,
            shortName: v.shortName,
            regionCode: r?.code ?? null,
            regionName: r?.name ?? null,
            aliases: venueAliases(v),
            raw: v,
          };
        });

      // Employees (all regions if no filter, else just that region)
      const employees = (regionFilter ? bundle.employees.filter((e) => e.regionId === regionFilter!.id) : bundle.employees)
        .filter((e) => e.status === "active")
        .map((e) => {
          const r = bundle.regionById.get(e.regionId);
          return {
            id: e.id,
            employeeNumber: e.employeeCode,
            name: e.name,
            title: e.role,
            department: e.department,
            regionCode: r?.code ?? null,
            status: e.status,
            raw: e,
          };
        });

      // Shift templates (all venues considered)
      const templateVenues = regionFilter ? bundle.venues.filter((v) => v.regionId === regionFilter!.id) : bundle.venues;
      const allTemplates: VenueShiftTemplate[] = [];
      for (const v of templateVenues) {
        const ts = await storage.getVenueShiftTemplates(v.id);
        allTemplates.push(...ts);
      }
      const seen = new Map<string, any>();
      let order = 0;
      for (const t of allTemplates) {
        const startTime = normTime(t.startTime);
        const endTime = normTime(t.endTime);
        const period = periodFromTimes(startTime, endTime);
        const key = `${t.shiftLabel}|${startTime}|${endTime}|${t.role}|${t.dayType}`;
        if (seen.has(key)) continue;
        seen.set(key, {
          id: `tpl_${key}`,
          code: `${t.shiftLabel}_${period}`,
          name: t.shiftLabel,
          label: t.shiftLabel,
          role: t.role,
          dayType: t.dayType,
          startTime,
          endTime,
          period,
          rawPeriod: t.shiftLabel,
          sortOrder: ++order,
          raw: t,
        });
      }
      const shiftDefs = Array.from(seen.values());

      // Schedules within range
      const allRegular = await storage.getAllShiftsByDateRange(from, to);
      const allDispatch = await db.select().from(dispatchShiftsTable)
        .where(and(gte(dispatchShiftsTable.date, from), lte(dispatchShiftsTable.date, to)));

      let regularItems = allRegular.filter((s) => s.status === "active");
      let dispatchRows = allDispatch as DispatchShift[];
      if (regionFilter) {
        const venueIdsInRegion = new Set(venues.map((v) => v.id));
        regularItems = regularItems.filter((s) => {
          if (venueIdsInRegion.has(s.venueId)) return true;
          const emp = bundle.employeeById.get(s.employeeId);
          return !!emp && emp.regionId === regionFilter!.id;
        });
        dispatchRows = dispatchRows.filter((d) => d.regionId === regionFilter!.id);
      }

      const schedules = [
        ...regularItems.map((s) => mapRegularShift(s, bundle)),
        ...dispatchRows.map((d) => mapDispatchShift(d, bundle)),
      ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.shift.startTime < b.shift.startTime ? -1 : 1));

      // Changes within range
      const inRangeShiftIds = regularItems.map((s) => s.id);
      const shiftById = new Map(regularItems.map((s) => [s.id, s]));
      let auditRows: ShiftAuditLog[] = [];
      if (inRangeShiftIds.length > 0) {
        const CHUNK = 1000;
        for (let i = 0; i < inRangeShiftIds.length; i += CHUNK) {
          const sliceIds = inRangeShiftIds.slice(i, i + CHUNK);
          const rows = await db.select().from(shiftAuditLogTable)
            .where(inArray(shiftAuditLogTable.shiftId, sliceIds))
            .orderBy(asc(shiftAuditLogTable.createdAt));
          auditRows.push(...rows);
        }
      }
      const changes = auditRows.map((row) => {
        const shift = shiftById.get(row.shiftId);
        const payload = (row.payload as any) ?? {};
        return {
          id: row.id,
          scheduleRawId: `shift_${row.shiftId}`,
          shiftId: row.shiftId,
          date: shift?.date ?? null,
          changeType: row.action,
          before: payload?.before ?? null,
          after: payload?.after ?? null,
          reason: payload?.reason ?? payload?.cancelReason ?? "",
          changedBy: row.actor,
          changedAt: row.createdAt ? (row.createdAt as Date).toISOString() : null,
          raw: row,
        };
      });

      res.json({
        range: { from, to },
        facilityKey: facilityKey || null,
        region: regionFilter ? { id: regionFilter.id, code: regionFilter.code, name: regionFilter.name } : null,
        venues,
        shifts: shiftDefs,
        employees,
        schedules,
        changes,
        counts: {
          venues: venues.length,
          shifts: shiftDefs.length,
          employees: employees.length,
          schedules: schedules.length,
          changes: changes.length,
        },
        generatedAt: nowInTaipeiIso(),
      });
    } catch (err: any) {
      res.status(500).json({ code: "EXPORT_SNAPSHOT_FAILED", message: err?.message || String(err) });
    }
  });

  // -------------------------------------------------------------------
  // JSON 404 fallback for any unknown /api/internal/* path.
  // -------------------------------------------------------------------
  app.use("/api/internal", (_req, res) => {
    res.status(404).json({ code: "INTERNAL_ROUTE_NOT_FOUND", message: "Not found" });
  });
}
