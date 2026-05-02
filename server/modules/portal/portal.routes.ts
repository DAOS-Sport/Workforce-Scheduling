import { type Express, type Response } from "express";
import { type Server } from "http";
import { storage } from "../../storage";
import { isValidLineUserId } from "../../line-webhook";
import { and } from "drizzle-orm";

export function mountPortalRoutes(httpServer: Server, app: Express): void {
const isDevMode = process.env.NODE_ENV !== "production";
  app.get("/api/portal/dev-employees", async (_req, res) => {
  if (!isDevMode) return res.status(404).json({ message: "Not found" });
  try {
    const regionIds = [1, 2, 3];
    const allEmployees: any[] = [];
    for (const rid of regionIds) {
      const emps = await storage.getEmployeesByRegion(rid);
      for (const e of emps) {
        if (e.status === "active") {
          allEmployees.push({ id: e.id, name: e.name, employeeCode: e.employeeCode, role: e.role });
        }
      }
    }
    res.json(allEmployees);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/portal/dev-login", async (req, res) => {
  if (!isDevMode) return res.status(404).json({ message: "Not found" });
  try {
    const { employeeId } = req.body;
    if (!employeeId) return res.status(400).json({ message: "缺少員工 ID" });
    const regionIds = [1, 2, 3];
    let found: any = null;
    for (const rid of regionIds) {
      const emps = await storage.getEmployeesByRegion(rid);
      found = emps.find((e) => e.id === employeeId);
      if (found) break;
    }
    if (!found) return res.status(404).json({ message: "找不到員工" });
    if (found.status !== "active") return res.status(403).json({ message: "此帳號已停用" });
    res.json({ id: found.id, name: found.name, employeeCode: found.employeeCode, role: found.role });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/portal/line-callback", async (req, res) => {
  try {
    const { code, redirectUri } = req.body;
    if (!code) return res.status(400).json({ message: "缺少授權碼" });

    const channelId = process.env.LINE_CHANNEL_ID;
    const channelSecret = process.env.LINE_LOGIN_CHANNEL_SECRET || process.env.LINE_CHANNEL_SECRET;
    if (!channelId || !channelSecret) {
      return res.status(500).json({ message: "LINE Login 尚未設定" });
    }

    const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: channelId,
        client_secret: channelSecret,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error("LINE token error:", errText);
      return res.status(401).json({ message: "LINE 授權失敗" });
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    const profileRes = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!profileRes.ok) {
      return res.status(401).json({ message: "無法取得 LINE 個人資料" });
    }

    const profile = await profileRes.json();
    const lineUserId = profile.userId;

    let employee = await storage.getEmployeeByLineId(lineUserId);

    if (!employee) {
      const allEmps = await storage.getAllEmployees();
      const matchByInvalidId = allEmps.find(e =>
        e.lineId && !isValidLineUserId(e.lineId) && e.lineId === lineUserId
      );
      if (matchByInvalidId) {
        employee = matchByInvalidId;
      }
    }

    if (!employee) {
      return res.status(404).json({
        message: "您的帳號尚未綁定。\n\n請回到 LINE 官方帳號，傳送您的「員工編號」即可自動綁定。\n綁定完成後再重新登入此頁面。",
        lineUserId,
        displayName: profile.displayName,
        notBound: true,
      });
    }

    if (employee.status !== "active") {
      return res.status(403).json({ message: "此帳號已停用" });
    }

    if (!employee.lineId || !isValidLineUserId(employee.lineId)) {
      await storage.updateEmployee(employee.id, { lineId: lineUserId });
      console.log(`[Portal] 自動回寫 LINE ID: ${employee.name}(${employee.employeeCode}) → ${lineUserId}`);
    }

    res.json({
      id: employee.id,
      name: employee.name,
      employeeCode: employee.employeeCode,
      role: employee.role,
      lineDisplayName: profile.displayName,
      lineUserId,
    });
  } catch (err: any) {
    console.error("LINE callback error:", err);
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/portal/verify", async (req, res) => {
  try {
    const { lineId } = req.body;
    if (!lineId) return res.status(400).json({ message: "缺少 LINE ID" });
    const employee = await storage.getEmployeeByLineId(lineId);
    if (!employee) return res.status(404).json({ message: "找不到此 LINE 帳號對應的員工資料" });
    if (employee.status !== "active") return res.status(403).json({ message: "此帳號已停用" });
    res.json({
      id: employee.id,
      name: employee.name,
      employeeCode: employee.employeeCode,
      role: employee.role,
      lineUserId: lineId,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/portal/my-shifts/:employeeId/:startDate/:endDate", async (req, res) => {
  try {
    const employeeId = parseInt(req.params.employeeId);
    const { startDate, endDate } = req.params;
    const [myShifts, myDispatchShifts] = await Promise.all([
      storage.getShiftsByEmployeeAndDateRange(employeeId, startDate, endDate),
      storage.getDispatchShiftsByLinkedEmployee(employeeId, startDate, endDate),
    ]);

    const emp = await storage.getEmployee(employeeId);
    const empRoleMap: Record<string, string> = {
      lifeguard: "救生", counter: "櫃檯", cleaning: "清潔", manager: "管理",
      救生: "救生", 守望: "守望",
      櫃台: "櫃檯", 櫃檯: "櫃檯", 櫃臺: "櫃檯",
      清潔: "清潔", 主管職: "管理", 教練: "教練", 無職: "無職",
      行政: "行政", 指導員: "教練", 機電: "機電", 行政專員: "行政", 資訊工程師: "資訊",
      資訊班: "資訊", 在校實習: "無職",
    };

    const allVenueIds = Array.from(new Set([
      ...myShifts.map((s) => s.venueId),
      ...myDispatchShifts.filter((ds) => ds.venueId != null).map((ds) => ds.venueId as number),
    ]));
    const venueMap: Record<number, any> = {};
    for (const vid of allVenueIds) {
      const v = await storage.getVenue(vid);
      if (v) venueMap[vid] = { id: v.id, name: v.name, shortName: v.shortName };
    }

    const slotsCache: Record<string, any[]> = {};
    const getSlotsForVenueDate = async (venueId: number, date: string) => {
      const key = `${venueId}-${date}`;
      if (!slotsCache[key]) {
        slotsCache[key] = await storage.getScheduleSlotsByVenueAndDate(venueId, date);
      }
      return slotsCache[key];
    };

    const enrichedRegular = await Promise.all(myShifts.map(async (s) => {
      const slots = await getSlotsForVenueDate(s.venueId, s.date);
      const shiftStart = s.startTime.slice(0, 5);
      const shiftEnd = s.endTime.slice(0, 5);
      const matchedSlot = slots.find((sl) =>
        sl.startTime.slice(0, 5) <= shiftStart && sl.endTime.slice(0, 5) >= shiftEnd
      ) || slots.find((sl) =>
        sl.startTime.slice(0, 5) <= shiftStart && shiftStart < sl.endTime.slice(0, 5)
      );
      const assignedRole = matchedSlot?.role || (emp ? empRoleMap[emp.role] : null) || null;
      return {
        ...s,
        venue: venueMap[s.venueId] || null,
        assignedRole,
        _isDispatchRecord: false,
      };
    }));

    const enrichedDispatch = myDispatchShifts.map((ds) => ({
      id: -(ds.id),
      employeeId,
      venueId: ds.venueId,
      shiftId: null,
      date: ds.date,
      startTime: ds.startTime,
      endTime: ds.endTime,
      role: ds.role,
      notes: ds.notes || null,
      isDispatch: true,
      certificateImageUrl: null,
      venue: ds.venueId ? (venueMap[ds.venueId] || null) : null,
      assignedRole: empRoleMap[ds.role] || ds.role || null,
      _isDispatchRecord: true,
    }));

    res.json([...enrichedRegular, ...enrichedDispatch]);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

app.patch("/api/portal/shifts/:shiftId/certificate", async (req, res) => {
  try {
    const shiftId = parseInt(req.params.shiftId);
    const { employeeId, certificateImageUrl } = req.body;
    if (!employeeId || !shiftId) return res.status(400).json({ message: "缺少必要欄位" });

    const shift = await storage.getShift(shiftId);
    if (!shift) return res.status(404).json({ message: "班次不存在" });
    if (shift.employeeId !== parseInt(employeeId)) return res.status(403).json({ message: "無權限" });

    const updated = await storage.updateShift(shiftId, { certificateImageUrl: certificateImageUrl || null }, req.session.adminName || "admin:certificate", true);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// Task #51: privacy-respecting workmates service.
// Rules: same date (Asia/Taipei), same venue, same shift band (early/late) AND
// overlapping intervals (cross-day handled), excludes self, excludes day-off markers,
// only status='active' shifts.
// Used by both new /api/portal/workmates and legacy /api/portal/today-coworkers.
type WorkmateMyShift = {
  id: number;
  venueId: number | null;
  venueName: string | null;
  role: string;
  startTime: string;
  endTime: string;
  shiftBand: "early" | "late";
  isDispatch: boolean;
};
type WorkmateCoworker = {
  employeeId: number;
  name: string;
  phone: string | null;
  role: string;
  startTime: string;
  endTime: string;
  shiftTime: string;
  venueName: string | null;
  isDispatch: boolean;
};
type WorkmatesResult = {
  date: string;
  timezone: "Asia/Taipei";
  myShift: WorkmateMyShift | null;
  coworkers: WorkmateCoworker[];
  message?: string;
};

// Resolve the calling employee's identity from `lineUserId` (LIFF) and verify
// it matches the requested `employeeId`. Returns `{ ok, status, code, message }`.
// Strict bind: the only supported caller proof today is the LIFF lineUserId.
async function verifyPortalCaller(
  requestedEmployeeId: number,
  lineUserId: string | undefined,
): Promise<{ ok: boolean; status: number; code?: string; message?: string }> {
  if (!lineUserId) {
    return { ok: false, status: 401, code: "UNAUTHENTICATED", message: "需要 LINE 身份識別" };
  }
  const me = await storage.getEmployeeByLineId(lineUserId);
  if (!me) {
    return { ok: false, status: 401, code: "UNKNOWN_LINE_ID", message: "LINE 帳號未綁定員工" };
  }
  if (me.id !== requestedEmployeeId) {
    return { ok: false, status: 403, code: "IDENTITY_MISMATCH", message: "不可查詢他人資料" };
  }
  return { ok: true, status: 200 };
}

async function computeWorkmates(employeeId: number, date: string): Promise<WorkmatesResult> {
  const isDayOff = (s: string, e: string) => s.slice(0, 5) === "00:00" && e.slice(0, 5) === "00:00";
  const isAllDay = (s: string, e: string) => s.slice(0, 5) === "00:00" && e.slice(0, 5) === "24:00";
  const shiftBand = (start: string): "early" | "late" => start.slice(0, 5) < "12:00" ? "early" : "late";
  // Convert (date, startTime, endTime) into [startAt, endAt] millisecond timestamps.
  // If endTime <= startTime → endAt rolls to date+1 (cross-day shift, e.g. 22:00-06:00).
  // 24:00 endTime is treated as next day 00:00.
  const toInterval = (d: string, st: string, et: string): [number, number] => {
    const startStr = st.slice(0, 5);
    const endStr = et.slice(0, 5);
    const startAt = new Date(`${d}T${startStr}:00+08:00`).getTime();
    let endAt: number;
    if (endStr === "24:00" || endStr <= startStr) {
      // Compute next calendar date from YYYY-MM-DD parts (TZ-safe). Date.UTC
      // handles month/year rollover. We then re-format as YYYY-MM-DD.
      const [Y, M, D] = d.split("-").map(Number);
      const nextUtc = new Date(Date.UTC(Y, M - 1, D + 1));
      const nd =
        `${nextUtc.getUTCFullYear()}-` +
        `${String(nextUtc.getUTCMonth() + 1).padStart(2, "0")}-` +
        `${String(nextUtc.getUTCDate()).padStart(2, "0")}`;
      endAt = new Date(`${nd}T${endStr === "24:00" ? "00:00" : endStr}:00+08:00`).getTime();
    } else {
      endAt = new Date(`${d}T${endStr}:00+08:00`).getTime();
    }
    return [startAt, endAt];
  };
  const overlaps = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];

  const baseEmpty: WorkmatesResult = { date, timezone: "Asia/Taipei", myShift: null, coworkers: [], message: "當日無排班" };

  const emp = await storage.getEmployee(employeeId);
  if (!emp) return baseEmpty;

  // Locate my real shift on `date` (regular preferred, otherwise dispatch).
  const myRegularAll = await storage.getShiftsByEmployeeAndDateRange(employeeId, date, date);
  const myRegular = myRegularAll.filter(s => !isDayOff(s.startTime, s.endTime));
  const myDispatchAll = await storage.getDispatchShiftsByLinkedEmployee(employeeId, date, date);
  const myDispatch = myDispatchAll.filter(ds => !isDayOff(ds.startTime, ds.endTime));

  if (myRegular.length === 0 && myDispatch.length === 0) return baseEmpty;

  // Spec: derive venue scope from the SELECTED myShift only — do not widen
  // to all of the employee's same-day shifts.
  let myShift: WorkmateMyShift;
  let myVenueId: number | null;
  let myInterval: [number, number];
  if (myRegular.length > 0) {
    const s = myRegular[0];
    const venue = await storage.getVenue(s.venueId);
    myVenueId = s.venueId;
    myInterval = toInterval(date, s.startTime, s.endTime);
    myShift = {
      id: s.id,
      venueId: s.venueId,
      venueName: venue?.shortName ?? null,
      role: s.role,
      startTime: s.startTime.slice(0, 5),
      endTime: s.endTime.slice(0, 5),
      shiftBand: shiftBand(s.startTime),
      isDispatch: false,
    };
  } else {
    const ds = myDispatch[0];
    const venue = ds.venueId ? await storage.getVenue(ds.venueId) : null;
    myVenueId = ds.venueId;
    myInterval = toInterval(date, ds.startTime, ds.endTime);
    myShift = {
      id: -ds.id,
      venueId: ds.venueId,
      venueName: venue?.shortName ?? null,
      role: ds.role,
      startTime: ds.startTime.slice(0, 5),
      endTime: ds.endTime.slice(0, 5),
      shiftBand: shiftBand(ds.startTime),
      isDispatch: true,
    };
  }
  const myBand = myShift.shiftBand;

  if (!myVenueId) return { ...baseEmpty, myShift, message: "無法判定場館" };

  // Pull shifts at MY venue only.
  const venueShifts = await storage.getShiftsByVenueAndDate(myVenueId, date);
  const myVenue = await storage.getVenue(myVenueId);
  // Pull dispatch shifts via my venue's region, filtered to my venue.
  const venueRegionId = myVenue?.regionId;
  const allDispatchAtRegion = venueRegionId
    ? await storage.getDispatchShifts(venueRegionId, date, date)
    : [];
  const dispatchAtMyVenue = allDispatchAtRegion.filter(ds => ds.venueId === myVenueId);

  // Pre-load coworker employee records.
  const coworkerEmpIds = Array.from(new Set(
    venueShifts
      .filter(s => s.employeeId !== employeeId && !isDayOff(s.startTime, s.endTime) && shiftBand(s.startTime) === myBand)
      .map(s => s.employeeId)
  ));
  const coworkerEmps = await Promise.all(coworkerEmpIds.map(id => storage.getEmployee(id)));
  const empById = new Map(coworkerEmps.filter(Boolean).map(e => [e!.id, e!]));

  const coworkers: WorkmateCoworker[] = [];
  for (const s of venueShifts) {
    if (s.employeeId === employeeId) continue;
    if (isDayOff(s.startTime, s.endTime)) continue;
    if (shiftBand(s.startTime) !== myBand) continue;
    // Cross-day-safe overlap check (also satisfies spec step 6).
    if (!overlaps(toInterval(date, s.startTime, s.endTime), myInterval)) continue;
    const co = empById.get(s.employeeId);
    if (!co) continue;
    const cwStart = s.startTime.slice(0, 5);
    const cwEnd = s.endTime.slice(0, 5);
    coworkers.push({
      employeeId: co.id,
      name: co.name,
      phone: co.phone,
      role: s.role,
      startTime: cwStart,
      endTime: cwEnd,
      shiftTime: isAllDay(s.startTime, s.endTime) ? "全天" : `${cwStart}-${cwEnd}`,
      venueName: myVenue?.shortName ?? null,
      isDispatch: false,
    });
  }
  for (const ds of dispatchAtMyVenue) {
    if (ds.linkedEmployeeId === employeeId) continue;
    if (isDayOff(ds.startTime, ds.endTime)) continue;
    if (shiftBand(ds.startTime) !== myBand) continue;
    if (!overlaps(toInterval(date, ds.startTime, ds.endTime), myInterval)) continue;
    const cwStart = ds.startTime.slice(0, 5);
    const cwEnd = ds.endTime.slice(0, 5);
    coworkers.push({
      employeeId: -ds.id,
      name: ds.dispatchName,
      phone: ds.dispatchPhone ?? null,
      role: ds.role,
      startTime: cwStart,
      endTime: cwEnd,
      shiftTime: isAllDay(ds.startTime, ds.endTime) ? "全天" : `${cwStart}-${cwEnd}`,
      venueName: myVenue?.shortName ?? null,
      isDispatch: true,
    });
  }

  return { date, timezone: "Asia/Taipei", myShift, coworkers };
}

// Returns coworkers for the strict rolling window [now, now + 7*24h) in
// Asia/Taipei. Days with no shift are omitted. For each day, both myShift
// and individual coworker shifts must overlap the rolling window
// (endAt > now AND startAt < cutoff). Iterates 8 calendar days to ensure
// partial coverage of the trailing day.
// Response shape: array of { date, dayLabel, relativeLabel, myShift, coworkers }.
app.get("/api/portal/upcoming-coworkers/:employeeId", async (req, res) => {
  try {
    const employeeId = parseInt(req.params.employeeId);
    if (!employeeId) return res.json([]);

    const lineUserId =
      (req.header("x-line-user-id") as string | undefined) ??
      (typeof req.query.lineUserId === "string" ? req.query.lineUserId : undefined);
    const auth = await verifyPortalCaller(employeeId, lineUserId);
    if (!auth.ok) return res.status(auth.status).json({ code: auth.code, message: auth.message });

    const taiwanNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));

    const addDays = (base: Date, n: number) => {
      const d = new Date(Date.UTC(base.getFullYear(), base.getMonth(), base.getDate() + n));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    };

    // Window covers 7 calendar days starting from Taipei "today 00:00"
    // (rather than "now"), so today's entries remain visible even after
    // the user's own shift has already ended.
    const todayStr = addDays(taiwanNow, 0);
    const nowMs = new Date(`${todayStr}T00:00:00+08:00`).getTime();
    const cutoffMs = nowMs + 7 * 24 * 60 * 60 * 1000;

    // Convert (date, "HH:mm" startTime, "HH:mm" endTime) → [startMs, endMs]
    // in Asia/Taipei, handling cross-day shifts and 24:00 endTimes.
    const toIntervalMs = (date: string, startTime: string, endTime: string): [number, number] => {
      const startStr = startTime.slice(0, 5);
      const endStr = endTime.slice(0, 5);
      const startAt = new Date(`${date}T${startStr}:00+08:00`).getTime();
      let endAt: number;
      if (endStr === "24:00" || endStr <= startStr) {
        const [Y, M, D] = date.split("-").map(Number);
        const nextUtc = new Date(Date.UTC(Y, M - 1, D + 1));
        const nd = `${nextUtc.getUTCFullYear()}-${String(nextUtc.getUTCMonth() + 1).padStart(2, "0")}-${String(nextUtc.getUTCDate()).padStart(2, "0")}`;
        endAt = new Date(`${nd}T${endStr === "24:00" ? "00:00" : endStr}:00+08:00`).getTime();
      } else {
        endAt = new Date(`${date}T${endStr}:00+08:00`).getTime();
      }
      return [startAt, endAt];
    };
    const overlapsWindow = (startAt: number, endAt: number) =>
      endAt > nowMs && startAt < cutoffMs;

    const dayLabels = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
    const out: Array<{
      date: string;
      dayLabel: string;
      relativeLabel: string;
      myShift: WorkmateMyShift;
      coworkers: WorkmateCoworker[];
    }> = [];

    // Iterate 7 calendar days (today..today+6).
    for (let i = 0; i < 7; i++) {
      const date = addDays(taiwanNow, i);
      const result = await computeWorkmates(employeeId, date);
      if (!result.myShift) continue;

      const [myStart, myEnd] = toIntervalMs(date, result.myShift.startTime, result.myShift.endTime);
      if (!overlapsWindow(myStart, myEnd)) continue;

      const filteredCoworkers = result.coworkers.filter((cw) => {
        const [cs, ce] = toIntervalMs(date, cw.startTime, cw.endTime);
        return overlapsWindow(cs, ce);
      });

      // Compute weekday from the calendar date directly (UTC) to avoid
      // server-local-TZ skew (Replit runs in UTC; using getDay() on a
      // +08:00-anchored Date returns the previous day's weekday).
      const [Y, M, D] = date.split("-").map(Number);
      const dow = new Date(Date.UTC(Y, M - 1, D)).getUTCDay();
      const relativeLabel = i === 0 ? "今天" : i === 1 ? "明天" : i === 2 ? "後天" : `${i} 天後`;

      out.push({
        date,
        dayLabel: dayLabels[dow],
        relativeLabel,
        myShift: result.myShift,
        coworkers: filteredCoworkers,
      });
    }

    res.json(out);
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知錯誤";
    res.status(500).json({ message });
  }
});

app.get("/api/portal/workmates", async (req, res) => {
  try {
    const employeeId = parseInt(String(req.query.employeeId || ""));
    const date = String(req.query.date || "");
    if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: "employeeId 與 date (YYYY-MM-DD) 為必填" });
    }

    // Identity binding: caller must prove they are `employeeId` via LIFF lineUserId.
    const lineUserId =
      (req.header("x-line-user-id") as string | undefined) ??
      (typeof req.query.lineUserId === "string" ? req.query.lineUserId : undefined);
    const auth = await verifyPortalCaller(employeeId, lineUserId);
    if (!auth.ok) return res.status(auth.status).json({ code: auth.code, message: auth.message });

    const taiwanNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    const today = `${taiwanNow.getFullYear()}-${String(taiwanNow.getMonth() + 1).padStart(2, "0")}-${String(taiwanNow.getDate()).padStart(2, "0")}`;
    const dDate = new Date(date + "T00:00:00Z").getTime();
    const dToday = new Date(today + "T00:00:00Z").getTime();
    const diffDays = Math.round((dDate - dToday) / 86400000);
    if (diffDays < 0) return res.status(403).json({ code: "PAST_FORBIDDEN", message: "不可查詢過去日期" });
    if (diffDays > 7) return res.status(403).json({ code: "OUT_OF_WINDOW", message: "僅可查詢今日起 7 天內" });

    const result = await computeWorkmates(employeeId, date);
    return res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知錯誤";
    res.status(500).json({ message });
  }
});

// Legacy endpoint: now routed through computeWorkmates so it follows the new
// privacy rules (same venue + same band + cross-day overlap). Response shape
// preserved for backward compatibility with existing portal UI.
// Deprecation header points clients to /api/portal/workmates (Task #57 will remove).
app.get("/api/portal/today-coworkers/:employeeId", async (req, res) => {
  res.setHeader("Deprecation", "true");
  res.setHeader("Link", '</api/portal/workmates>; rel="successor-version"');
  try {
    const employeeId = parseInt(req.params.employeeId);
    if (!employeeId) return res.json([]);

    // Identity binding: caller must prove they are `employeeId` via LIFF lineUserId.
    const lineUserId =
      (req.header("x-line-user-id") as string | undefined) ??
      (typeof req.query.lineUserId === "string" ? req.query.lineUserId : undefined);
    const auth = await verifyPortalCaller(employeeId, lineUserId);
    if (!auth.ok) return res.status(auth.status).json({ code: auth.code, message: auth.message });

    const taiwanNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    const today = `${taiwanNow.getFullYear()}-${String(taiwanNow.getMonth() + 1).padStart(2, "0")}-${String(taiwanNow.getDate()).padStart(2, "0")}`;

    const empRoleMap: Record<string, string> = {
      lifeguard: "救生", counter: "櫃檯", cleaning: "清潔", manager: "管理",
      救生: "救生", 守望: "守望",
      櫃台: "櫃檯", 櫃檯: "櫃檯", 櫃臺: "櫃檯",
      清潔: "清潔", 主管職: "管理", 教練: "教練", 無職: "無職",
      行政: "行政", 指導員: "教練", 機電: "機電", 行政專員: "行政", 資訊工程師: "資訊",
      資訊班: "資訊", 在校實習: "無職",
    };

    const result = await computeWorkmates(employeeId, today);
    if (!result.myShift || result.coworkers.length === 0) return res.json([]);

    // Re-shape to legacy: [{ venue: { id, shortName }, coworkers: [...] }]
    // The new logic only returns one venue (= myShift.venueId), so produce one group.
    const venue = result.myShift.venueId
      ? await storage.getVenue(result.myShift.venueId)
      : null;
    const coworkers = result.coworkers.map((c) => ({
      id: c.employeeId,
      name: c.name,
      phone: c.phone,
      role: c.role,
      shiftRole: empRoleMap[c.role] || c.role,
      shiftTime: c.shiftTime,
      isDispatch: c.isDispatch,
    }));
    res.json([{
      venue: venue ? { id: venue.id, shortName: venue.shortName } : null,
      coworkers,
    }]);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/portal/guidelines-check/:employeeId", async (req, res) => {
  try {
    const employeeId = parseInt(req.params.employeeId);
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    const myShifts = await storage.getShiftsByEmployeeAndDateRange(employeeId, monthStart, monthEnd);
    const myVenueIds = Array.from(new Set(myShifts.map((s) => s.venueId)));

    const allGuidelines = await storage.getGuidelines();
    const activeGuidelines = allGuidelines.filter((g) => g.isActive);

    const relevant = activeGuidelines.filter((g) => {
      if (g.category === "fixed") {
        if (g.venueId) return myVenueIds.includes(g.venueId);
        return true;
      }
      if (g.category === "monthly") {
        return g.yearMonth === yearMonth;
      }
      if (g.category === "confidentiality") return true;
      return false;
    });

    const acks = await storage.getGuidelineAcksByEmployee(employeeId);

    const guidelineMap = new Map(relevant.map((g) => [g.id, g]));
    const currentMonthAckedIds = new Set(
      acks.filter((a) => {
        if (!a.acknowledgedAt) return false;
        const ackDate = new Date(a.acknowledgedAt);
        if (ackDate.getFullYear() !== now.getFullYear() || ackDate.getMonth() !== now.getMonth()) return false;
        const g = guidelineMap.get(a.guidelineId);
        if (g?.updatedAt && new Date(g.updatedAt) > ackDate) return false;
        return true;
      }).map((a) => a.guidelineId)
    );

    const venueMap: Record<number, string> = {};
    for (const vid of myVenueIds) {
      const v = await storage.getVenue(vid);
      if (v) venueMap[vid] = v.shortName;
    }

    const items = relevant.map(({ imageUrl, imageUrls, ...g }) => ({
      ...g,
      venueName: g.venueId ? venueMap[g.venueId] || null : null,
      acknowledged: currentMonthAckedIds.has(g.id),
    }));

    const allAcknowledged = items.every((i) => i.acknowledged);

    res.json({ items, allAcknowledged });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/portal/guidelines/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const employeeId = parseInt(req.query.employeeId as string);
    if (!employeeId || isNaN(employeeId)) {
      return res.status(400).json({ message: "employeeId 為必填" });
    }

    const item = await storage.getGuideline(id);
    if (!item || !item.isActive) return res.status(404).json({ message: "守則未找到" });

    // Validate that this guideline is in the employee's relevant set
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const monthStart = `${yearMonth}-01`;
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const monthEnd = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;

    const myShifts = await storage.getShiftsByEmployeeAndDateRange(employeeId, monthStart, monthEnd);
    const myVenueIds = Array.from(new Set(myShifts.map((s) => s.venueId)));

    const isRelevant =
      (item.category === "fixed" && (!item.venueId || myVenueIds.includes(item.venueId))) ||
      (item.category === "monthly" && item.yearMonth === yearMonth) ||
      item.category === "confidentiality";

    if (!isRelevant) return res.status(403).json({ message: "無權存取此守則" });

    res.json(item);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/portal/acknowledge-all", async (req, res) => {
  try {
    const { employeeId, guidelineIds } = req.body;
    if (!employeeId || !Array.isArray(guidelineIds)) {
      return res.status(400).json({ message: "缺少必要參數" });
    }

    const existingAcks = await storage.getGuidelineAcksByEmployee(employeeId);
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    const allGuidelines = await storage.getGuidelines();
    const guidelineMapAck = new Map(allGuidelines.map((g) => [g.id, g]));

    const existingThisMonth = existingAcks.filter((a) => {
      if (!a.acknowledgedAt) return false;
      const d = new Date(new Date(a.acknowledgedAt).toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
      if (d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth()) return false;
      const g = guidelineMapAck.get(a.guidelineId);
      if (g?.updatedAt && new Date(g.updatedAt) > d) return false;
      return true;
    });
    const alreadyAckedIds = new Set(existingThisMonth.map((a) => a.guidelineId));

    const toAck = guidelineIds.filter((id: number) => !alreadyAckedIds.has(id));
    for (const gid of toAck) {
      await storage.createGuidelineAck({ guidelineId: gid, employeeId });
    }

    res.json({ success: true, acknowledged: toAck.length });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/portal/my-attendance/:employeeId", async (req, res) => {
  try {
    const employeeId = parseInt(req.params.employeeId);
    const employee = await storage.getEmployee(employeeId);
    if (!employee) return res.status(404).json({ message: "找不到員工" });

    const taiwanNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    const monthStart = `${taiwanNow.getFullYear()}-${String(taiwanNow.getMonth() + 1).padStart(2, "0")}-01`;
    const lastDay = new Date(taiwanNow.getFullYear(), taiwanNow.getMonth() + 1, 0).getDate();
    const monthEnd = `${taiwanNow.getFullYear()}-${String(taiwanNow.getMonth() + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    const records = await storage.getAttendanceRecordsByDateRange(monthStart, monthEnd, [employee.employeeCode]);

    const clockRecords = await storage.getClockRecordsByEmployee(employeeId, monthStart, monthEnd);

    const shifts = await storage.getShiftsByEmployeeAndDateRange(employeeId, monthStart, monthEnd);

    const todayStr = `${taiwanNow.getFullYear()}-${String(taiwanNow.getMonth() + 1).padStart(2, "0")}-${String(taiwanNow.getDate()).padStart(2, "0")}`;
    const todayClocks = clockRecords
      .filter((cr) => {
        if (!cr.clockTime) return false;
        const d = new Date(new Date(cr.clockTime).toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
        const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        return ds === todayStr;
      })
      .sort((a, b) => new Date(b.clockTime!).getTime() - new Date(a.clockTime!).getTime());
    const latestClockToday = todayClocks[0] ?? null;
    const todayClockInRecord = todayClocks.find(cr => cr.clockType === "in" && (cr.status === "success" || cr.status === "warning")) ?? null;
    const todayClockOutRecord = [...todayClocks].find(cr => cr.clockType === "out" && (cr.status === "success" || cr.status === "warning")) ?? null;

    // Build a map of GPS clock records grouped by Taiwan date for easy lookup
    const gpsDateMap = new Map<string, typeof clockRecords>();
    for (const cr of clockRecords) {
      if (!cr.clockTime) continue;
      const d = new Date(new Date(cr.clockTime).toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!gpsDateMap.has(ds)) gpsDateMap.set(ds, []);
      gpsDateMap.get(ds)!.push(cr);
    }

    // Map xlsx records (priority source)
    const xlsxDates = new Set(records.map((r) => r.date));
    const xlsxRows = records.map((r) => {
      const dateShifts = shifts.filter((s) => s.date === r.date);
      const shiftInfo = dateShifts.length > 0
        ? dateShifts.map((s) => `${s.startTime.substring(0, 5)}-${s.endTime.substring(0, 5)}`).join(", ")
        : r.scheduledStart && r.scheduledEnd
          ? `${r.scheduledStart}-${r.scheduledEnd}`
          : null;

      // Sort by clockTime ascending so earliest clock-in and latest clock-out are
      // correctly identified even if an employee accidentally tapped multiple times.
      const dateClockRecords = (gpsDateMap.get(r.date) || [])
        .filter(Boolean)
        .sort((a, b) => new Date(a.clockTime ?? 0).getTime() - new Date(b.clockTime ?? 0).getTime());
      const clockInRecord = dateClockRecords.find((cr) => cr.clockType === "in");   // earliest in
      const clockOutRecord = [...dateClockRecords].reverse().find((cr) => cr.clockType === "out"); // latest out

      return {
        date: r.date,
        clockIn: clockInRecord && clockInRecord.clockTime
          ? new Date(clockInRecord.clockTime).toLocaleTimeString("en-US", { timeZone: "Asia/Taipei", hour12: false, hour: "2-digit", minute: "2-digit" })
          : r.clockIn || null,
        clockOut: clockOutRecord && clockOutRecord.clockTime
          ? new Date(clockOutRecord.clockTime).toLocaleTimeString("en-US", { timeZone: "Asia/Taipei", hour12: false, hour: "2-digit", minute: "2-digit" })
          : r.clockOut || null,
        isLate: r.isLate,
        isEarlyLeave: r.isEarlyLeave,
        hasAnomaly: r.hasAnomaly,
        leaveType: r.leaveType,
        shiftInfo,
        shiftType: r.shiftType || null,
      };
    });

    // Synthesize rows from GPS records for dates not covered by xlsx
    const gpsRows: typeof xlsxRows = [];
    for (const [dateStr, dayClocks] of Array.from(gpsDateMap.entries())) {
      if (xlsxDates.has(dateStr)) continue;
      // Sort ascending by clockTime so we always pick earliest clock-in and latest
      // clock-out — this handles accidental double-taps during the shift gracefully.
      const validClocks = dayClocks
        .filter((cr) => cr.status === "success" || cr.status === "warning")
        .sort((a, b) => new Date(a.clockTime ?? 0).getTime() - new Date(b.clockTime ?? 0).getTime());
      const clockInRecord = validClocks.find((cr) => cr.clockType === "in");   // earliest in
      const clockOutRecord = [...validClocks].reverse().find((cr) => cr.clockType === "out"); // latest out
      if (!clockInRecord) continue; // no valid clock-in, skip this date

      const dateShifts = shifts.filter((s) => s.date === dateStr);
      const shiftInfo = dateShifts.length > 0
        ? dateShifts.map((s) => `${s.startTime.substring(0, 5)}-${s.endTime.substring(0, 5)}`).join(", ")
        : null;

      const gpsMissingOut = !clockOutRecord;

      const clockInStr = new Date(clockInRecord.clockTime!).toLocaleTimeString("en-US", { timeZone: "Asia/Taipei", hour12: false, hour: "2-digit", minute: "2-digit" });
      const clockOutStr = clockOutRecord?.clockTime
        ? new Date(clockOutRecord.clockTime).toLocaleTimeString("en-US", { timeZone: "Asia/Taipei", hour12: false, hour: "2-digit", minute: "2-digit" })
        : null;

      // Compare against scheduled shift time (first shift of the day)
      let gpsIsLate = false;
      let gpsIsEarlyLeave = false;
      let gpsHasAnomaly = gpsMissingOut && dateStr < todayStr; // missing clock-out on past date

      if (dateShifts.length > 0) {
        const sched = dateShifts[0];
        const schedStart = sched.startTime.slice(0, 5); // "HH:MM"
        const schedEnd = sched.endTime.slice(0, 5);

        // Late: clocked in more than 10 minutes after scheduled start
        const [sH, sM] = schedStart.split(":").map(Number);
        const [iH, iM] = clockInStr.split(":").map(Number);
        const lateMinutes = (iH * 60 + iM) - (sH * 60 + sM);
        if (lateMinutes > 10) gpsIsLate = true;

        if (clockOutStr) {
          const [eH, eM] = schedEnd.split(":").map(Number);
          const [oH, oM] = clockOutStr.split(":").map(Number);
          const earlyMinutes = (eH * 60 + eM) - (oH * 60 + oM);
          // Early leave: clocked out more than 10 minutes before scheduled end
          if (earlyMinutes > 10) gpsIsEarlyLeave = true;
          // Anomaly: clock-in and clock-out at exact same time (0-duration punch)
          if (clockInStr === clockOutStr) gpsHasAnomaly = true;
        }
      }

      gpsRows.push({
        date: dateStr,
        clockIn: clockInStr,
        clockOut: clockOutStr,
        isLate: gpsIsLate,
        isEarlyLeave: gpsIsEarlyLeave,
        hasAnomaly: gpsHasAnomaly,
        leaveType: null,
        shiftInfo,
        shiftType: null,
      });
    }

    const allRows = [...xlsxRows, ...gpsRows].sort((a, b) => b.date.localeCompare(a.date));

    const summary = {
      total: allRows.length,
      late: allRows.filter((r) => r.isLate).length,
      earlyLeave: allRows.filter((r) => r.isEarlyLeave).length,
      anomaly: allRows.filter((r) => r.hasAnomaly).length,
      leave: records.filter((r) => r.leaveHours && r.leaveHours.trim() !== "").length,
      todayLatestClock: latestClockToday
        ? { clockType: latestClockToday.clockType, clockTime: latestClockToday.clockTime!.toISOString() }
        : null,
      todayClockIn: todayClockInRecord
        ? { clockTime: todayClockInRecord.clockTime!.toISOString() }
        : null,
      todayClockOut: todayClockOutRecord
        ? { clockTime: todayClockOutRecord.clockTime!.toISOString() }
        : null,
      records: allRows,
    };

    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});
}

