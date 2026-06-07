import { storage } from "../../storage";
import { isValidLineUserId } from "../line/lineSignature";

function err(status: number, message: string, code?: string): Error {
  const e: any = new Error(message);
  e.status = status;
  if (code) e.code = code;
  return e;
}

const isDevMode = process.env.NODE_ENV !== "production";

const empRoleMap: Record<string, string> = {
  lifeguard: "救生", counter: "櫃檯", cleaning: "清潔", manager: "管理",
  救生: "救生", 守望: "守望",
  櫃台: "櫃檯", 櫃檯: "櫃檯", 櫃臺: "櫃檯",
  清潔: "清潔", 主管職: "管理", 教練: "教練", 無職: "無職",
  行政: "行政", 指導員: "教練", 機電: "機電", 行政專員: "行政", 資訊工程師: "資訊",
  資訊班: "資訊", 在校實習: "無職",
};

// A shift row whose role is one of these means the person is OFF (leave), not
// working. The leave type must be surfaced verbatim, never replaced by a working
// role or a venue slot role.
const LEAVE_ROLES = new Set<string>([
  "休假", "特休", "病假", "事假", "喪假", "公假", "生理假", "國定假", "育嬰", "留職停薪", "補休",
]);

// Operationally 守望 (watch) and 救生 (lifeguard) are NOT distinguished — the
// cloud DB may register 守望, but the EMPLOYEE-facing portal shows both as 救生.
// This collapse is intentional and applies ONLY to the portal display; the admin
// grid and the CMS export keep the registered 守望 (the data layer is unchanged).
function toPortalDisplayRole<T extends string | null | undefined>(role: T): T {
  return (role === "守望" ? "救生" : role) as T;
}

/** Canonical display role for a regular shift in the employee portal: the shift's
 *  OWN working role, with 守望→救生 collapsed; leave types are returned verbatim. */
function resolveRegularRole(
  shiftRole: string | null | undefined,
  matchedSlotRole: string | null | undefined,
  employeeRole: string | null | undefined,
): string | null {
  const raw = (shiftRole || "").trim();
  if (raw && LEAVE_ROLES.has(raw)) return raw;
  const base = raw
    ? (empRoleMap[raw] || raw)
    : (matchedSlotRole || (employeeRole ? empRoleMap[employeeRole] : null) || null);
  return toPortalDisplayRole(base);
}

type WorkmateMyShift = {
  id: number; venueId: number | null; venueName: string | null; role: string;
  startTime: string; endTime: string; shiftBand: "early" | "late"; isDispatch: boolean;
};
type WorkmateCoworker = {
  employeeId: number; name: string; phone: string | null; role: string;
  startTime: string; endTime: string; shiftTime: string;
  venueName: string | null; isDispatch: boolean;
};
type WorkmatesResult = {
  date: string; timezone: "Asia/Taipei";
  myShift: WorkmateMyShift | null; coworkers: WorkmateCoworker[]; message?: string;
};

async function verifyPortalCallerInternal(
  requestedEmployeeId: number,
  lineUserId: string | undefined,
): Promise<{ ok: boolean; status: number; code?: string; message?: string }> {
  if (!lineUserId) return { ok: false, status: 401, code: "UNAUTHENTICATED", message: "需要 LINE 身份識別" };
  const me = await storage.getEmployeeByLineId(lineUserId);
  if (!me) return { ok: false, status: 401, code: "UNKNOWN_LINE_ID", message: "LINE 帳號未綁定員工" };
  if (me.id !== requestedEmployeeId) return { ok: false, status: 403, code: "IDENTITY_MISMATCH", message: "不可查詢他人資料" };
  return { ok: true, status: 200 };
}

async function computeWorkmatesInternal(employeeId: number, date: string): Promise<WorkmatesResult> {
  const isDayOff = (s: string, e: string) => s.slice(0, 5) === "00:00" && e.slice(0, 5) === "00:00";
  const isAllDay = (s: string, e: string) => s.slice(0, 5) === "00:00" && e.slice(0, 5) === "24:00";
  const shiftBand = (start: string): "early" | "late" => start.slice(0, 5) < "12:00" ? "early" : "late";
  const toInterval = (d: string, st: string, et: string): [number, number] => {
    const startStr = st.slice(0, 5);
    const endStr = et.slice(0, 5);
    const startAt = new Date(`${d}T${startStr}:00+08:00`).getTime();
    let endAt: number;
    if (endStr === "24:00" || endStr <= startStr) {
      const [Y, M, D] = d.split("-").map(Number);
      const nextUtc = new Date(Date.UTC(Y, M - 1, D + 1));
      const nd = `${nextUtc.getUTCFullYear()}-${String(nextUtc.getUTCMonth() + 1).padStart(2, "0")}-${String(nextUtc.getUTCDate()).padStart(2, "0")}`;
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

  const myRegularAll = await storage.getShiftsByEmployeeAndDateRange(employeeId, date, date);
  const myRegular = myRegularAll.filter(s => !isDayOff(s.startTime, s.endTime));
  const myDispatchAll = await storage.getDispatchShiftsByLinkedEmployee(employeeId, date, date);
  const myDispatch = myDispatchAll.filter(ds => !isDayOff(ds.startTime, ds.endTime));

  if (myRegular.length === 0 && myDispatch.length === 0) return baseEmpty;

  let myShift: WorkmateMyShift;
  let myVenueId: number | null;
  let myInterval: [number, number];
  if (myRegular.length > 0) {
    const s = myRegular[0];
    const venue = await storage.getVenue(s.venueId);
    myVenueId = s.venueId;
    myInterval = toInterval(date, s.startTime, s.endTime);
    myShift = {
      id: s.id, venueId: s.venueId, venueName: venue?.shortName ?? null,
      role: toPortalDisplayRole(empRoleMap[s.role] || s.role), startTime: s.startTime.slice(0, 5), endTime: s.endTime.slice(0, 5),
      shiftBand: shiftBand(s.startTime), isDispatch: false,
    };
  } else {
    const ds = myDispatch[0];
    const venue = ds.venueId ? await storage.getVenue(ds.venueId) : null;
    myVenueId = ds.venueId;
    myInterval = toInterval(date, ds.startTime, ds.endTime);
    myShift = {
      id: -ds.id, venueId: ds.venueId, venueName: venue?.shortName ?? null,
      role: toPortalDisplayRole(empRoleMap[ds.role] || ds.role), startTime: ds.startTime.slice(0, 5), endTime: ds.endTime.slice(0, 5),
      shiftBand: shiftBand(ds.startTime), isDispatch: true,
    };
  }
  const myBand = myShift.shiftBand;
  if (!myVenueId) return { ...baseEmpty, myShift, message: "無法判定場館" };

  const venueShifts = await storage.getShiftsByVenueAndDate(myVenueId, date);
  const myVenue = await storage.getVenue(myVenueId);
  const venueRegionId = myVenue?.regionId;
  const allDispatchAtRegion = venueRegionId
    ? await storage.getDispatchShifts(venueRegionId, date, date)
    : [];
  const dispatchAtMyVenue = allDispatchAtRegion.filter(ds => ds.venueId === myVenueId);

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
    if (!overlaps(toInterval(date, s.startTime, s.endTime), myInterval)) continue;
    const co = empById.get(s.employeeId);
    if (!co) continue;
    const cwStart = s.startTime.slice(0, 5);
    const cwEnd = s.endTime.slice(0, 5);
    coworkers.push({
      employeeId: co.id, name: co.name, phone: co.phone, role: toPortalDisplayRole(empRoleMap[s.role] || s.role),
      startTime: cwStart, endTime: cwEnd,
      shiftTime: isAllDay(s.startTime, s.endTime) ? "全天" : `${cwStart}-${cwEnd}`,
      venueName: myVenue?.shortName ?? null, isDispatch: false,
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
      employeeId: -ds.id, name: ds.dispatchName, phone: ds.dispatchPhone ?? null, role: toPortalDisplayRole(empRoleMap[ds.role] || ds.role),
      startTime: cwStart, endTime: cwEnd,
      shiftTime: isAllDay(ds.startTime, ds.endTime) ? "全天" : `${cwStart}-${cwEnd}`,
      venueName: myVenue?.shortName ?? null, isDispatch: true,
    });
  }
  return { date, timezone: "Asia/Taipei", myShift, coworkers };
}

export const portalService = {
  isDevMode,
  verifyCaller: verifyPortalCallerInternal,
  computeWorkmates: computeWorkmatesInternal,

  async devListEmployees() {
    const regionIds = [1, 2, 3];
    const allEmployees: any[] = [];
    for (const rid of regionIds) {
      const emps = await storage.getEmployeesByRegion(rid);
      for (const e of emps) {
        if (e.status === "active") allEmployees.push({ id: e.id, name: e.name, employeeCode: e.employeeCode, role: e.role });
      }
    }
    return allEmployees;
  },

  async devLogin(employeeId: number) {
    if (!employeeId) throw err(400, "缺少員工 ID");
    const regionIds = [1, 2, 3];
    let found: any = null;
    for (const rid of regionIds) {
      const emps = await storage.getEmployeesByRegion(rid);
      found = emps.find((e) => e.id === employeeId);
      if (found) break;
    }
    if (!found) throw err(404, "找不到員工");
    if (found.status !== "active") throw err(403, "此帳號已停用");
    return { id: found.id, name: found.name, employeeCode: found.employeeCode, role: found.role, employmentType: found.employmentType, regionId: found.regionId };
  },

  async lineCallback(code: string, redirectUri: string) {
    if (!code) throw err(400, "缺少授權碼");
    const channelId = process.env.LINE_CHANNEL_ID;
    const channelSecret = process.env.LINE_LOGIN_CHANNEL_SECRET || process.env.LINE_CHANNEL_SECRET;
    if (!channelId || !channelSecret) throw err(500, "LINE Login 尚未設定");

    const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code", code,
        redirect_uri: redirectUri, client_id: channelId, client_secret: channelSecret,
      }),
    });
    if (!tokenRes.ok) {
      console.error("LINE token error:", await tokenRes.text());
      throw err(401, "LINE 授權失敗");
    }
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    const profileRes = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profileRes.ok) throw err(401, "無法取得 LINE 個人資料");

    const profile = await profileRes.json();
    const lineUserId = profile.userId;

    let employee = await storage.getEmployeeByLineId(lineUserId);
    if (!employee) {
      const allEmps = await storage.getAllEmployees();
      const matchByInvalidId = allEmps.find(e =>
        e.lineId && !isValidLineUserId(e.lineId) && e.lineId === lineUserId
      );
      if (matchByInvalidId) employee = matchByInvalidId;
    }
    if (!employee) {
      const e: any = err(404, "您的帳號尚未綁定。\n\n請回到 LINE 官方帳號，傳送您的「員工編號」即可自動綁定。\n綁定完成後再重新登入此頁面。");
      e.payload = { lineUserId, displayName: profile.displayName, notBound: true };
      throw e;
    }
    if (employee.status !== "active") throw err(403, "此帳號已停用");
    if (!employee.lineId || !isValidLineUserId(employee.lineId)) {
      await storage.updateEmployee(employee.id, { lineId: lineUserId });
      console.log(`[Portal] 自動回寫 LINE ID: ${employee.name}(${employee.employeeCode}) → ${lineUserId}`);
    }
    return {
      id: employee.id, name: employee.name, employeeCode: employee.employeeCode, role: employee.role,
      employmentType: employee.employmentType, regionId: employee.regionId, lineDisplayName: profile.displayName, lineUserId,
    };
  },

  async verify(lineId: string) {
    if (!lineId) throw err(400, "缺少 LINE ID");
    const employee = await storage.getEmployeeByLineId(lineId);
    if (!employee) throw err(404, "找不到此 LINE 帳號對應的員工資料");
    if (employee.status !== "active") throw err(403, "此帳號已停用");
    return {
      id: employee.id, name: employee.name, employeeCode: employee.employeeCode,
      role: employee.role, employmentType: employee.employmentType, regionId: employee.regionId, lineUserId: lineId,
    };
  },

  async getMyShifts(employeeId: number, startDate: string, endDate: string) {
    const [myShifts, myDispatchShifts] = await Promise.all([
      storage.getShiftsByEmployeeAndDateRange(employeeId, startDate, endDate),
      storage.getDispatchShiftsByLinkedEmployee(employeeId, startDate, endDate),
    ]);
    const emp = await storage.getEmployee(employeeId);

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
      if (!slotsCache[key]) slotsCache[key] = await storage.getScheduleSlotsByVenueAndDate(venueId, date);
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
      const rawRole = (s.role || "").trim();
      const isLeave = LEAVE_ROLES.has(rawRole);
      // Show the role the admin actually assigned (shifts.role) first — so the
      // employee, the admin grid, and coworkers all agree on the same row, and a
      // leave day shows the real leave type instead of a working role.
      const assignedRole = resolveRegularRole(s.role, matchedSlot?.role, emp?.role);
      return {
        ...s,
        venue: venueMap[s.venueId] || null,
        assignedRole,
        isLeave,
        leaveType: isLeave ? rawRole : null,
        _isDispatchRecord: false,
      };
    }));

    const enrichedDispatch = myDispatchShifts.map((ds) => ({
      id: -(ds.id), employeeId, venueId: ds.venueId, shiftId: null, date: ds.date,
      startTime: ds.startTime, endTime: ds.endTime, role: ds.role, notes: ds.notes || null,
      isDispatch: true, certificateImageUrl: null,
      venue: ds.venueId ? (venueMap[ds.venueId] || null) : null,
      assignedRole: toPortalDisplayRole(empRoleMap[ds.role] || ds.role || null),
      isLeave: false,
      leaveType: null,
      _isDispatchRecord: true,
    }));

    return [...enrichedRegular, ...enrichedDispatch];
  },

  async updateShiftCertificate(shiftId: number, employeeId: number, certificateImageUrl: string | null, actor: string) {
    if (!employeeId || !shiftId) throw err(400, "缺少必要欄位");
    const shift = await storage.getShift(shiftId);
    if (!shift) throw err(404, "班次不存在");
    if (shift.employeeId !== employeeId) throw err(403, "無權限");
    return await storage.updateShift(shiftId, { certificateImageUrl: certificateImageUrl || null }, actor, true);
  },

  async getUpcomingCoworkers(employeeId: number) {
    const taiwanNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    const addDays = (base: Date, n: number) => {
      const d = new Date(Date.UTC(base.getFullYear(), base.getMonth(), base.getDate() + n));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    };
    const todayStr = addDays(taiwanNow, 0);
    const nowMs = new Date(`${todayStr}T00:00:00+08:00`).getTime();
    const cutoffMs = nowMs + 7 * 24 * 60 * 60 * 1000;

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
    const overlapsWindow = (startAt: number, endAt: number) => endAt > nowMs && startAt < cutoffMs;
    const dayLabels = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
    const out: Array<{ date: string; dayLabel: string; relativeLabel: string; myShift: WorkmateMyShift; coworkers: WorkmateCoworker[] }> = [];

    for (let i = 0; i < 7; i++) {
      const date = addDays(taiwanNow, i);
      const result = await computeWorkmatesInternal(employeeId, date);
      if (!result.myShift) continue;
      const [myStart, myEnd] = toIntervalMs(date, result.myShift.startTime, result.myShift.endTime);
      if (!overlapsWindow(myStart, myEnd)) continue;
      const filteredCoworkers = result.coworkers.filter((cw) => {
        const [cs, ce] = toIntervalMs(date, cw.startTime, cw.endTime);
        return overlapsWindow(cs, ce);
      });
      const [Y, M, D] = date.split("-").map(Number);
      const dow = new Date(Date.UTC(Y, M - 1, D)).getUTCDay();
      const relativeLabel = i === 0 ? "今天" : i === 1 ? "明天" : i === 2 ? "後天" : `${i} 天後`;
      out.push({ date, dayLabel: dayLabels[dow], relativeLabel, myShift: result.myShift, coworkers: filteredCoworkers });
    }
    return out;
  },

  async getWorkmates(employeeId: number, date: string) {
    if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw err(400, "employeeId 與 date (YYYY-MM-DD) 為必填");
    }
    const taiwanNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    const today = `${taiwanNow.getFullYear()}-${String(taiwanNow.getMonth() + 1).padStart(2, "0")}-${String(taiwanNow.getDate()).padStart(2, "0")}`;
    const dDate = new Date(date + "T00:00:00Z").getTime();
    const dToday = new Date(today + "T00:00:00Z").getTime();
    const diffDays = Math.round((dDate - dToday) / 86400000);
    if (diffDays < 0) throw err(403, "不可查詢過去日期", "PAST_FORBIDDEN");
    if (diffDays > 7) throw err(403, "僅可查詢今日起 7 天內", "OUT_OF_WINDOW");
    return await computeWorkmatesInternal(employeeId, date);
  },

  async getTodayCoworkers(employeeId: number) {
    if (!employeeId) return [];
    const taiwanNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    const today = `${taiwanNow.getFullYear()}-${String(taiwanNow.getMonth() + 1).padStart(2, "0")}-${String(taiwanNow.getDate()).padStart(2, "0")}`;
    const result = await computeWorkmatesInternal(employeeId, today);
    if (!result.myShift || result.coworkers.length === 0) return [];
    const venue = result.myShift.venueId ? await storage.getVenue(result.myShift.venueId) : null;
    const coworkers = result.coworkers.map((c) => ({
      id: c.employeeId, name: c.name, phone: c.phone, role: c.role,
      shiftRole: empRoleMap[c.role] || c.role,
      shiftTime: c.shiftTime, isDispatch: c.isDispatch,
    }));
    return [{ venue: venue ? { id: venue.id, shortName: venue.shortName } : null, coworkers }];
  },

  async guidelinesCheck(employeeId: number) {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const monthStart = `${yearMonth}-01`;
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const monthEnd = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;

    const myShifts = await storage.getShiftsByEmployeeAndDateRange(employeeId, monthStart, monthEnd);
    const myVenueIds = Array.from(new Set(myShifts.map((s) => s.venueId)));

    const allGuidelines = await storage.getGuidelines();
    const activeGuidelines = allGuidelines.filter((g) => g.isActive);
    const relevant = activeGuidelines.filter((g) => {
      if (g.category === "fixed") return g.venueId ? myVenueIds.includes(g.venueId) : true;
      if (g.category === "monthly") return g.yearMonth === yearMonth;
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
    return { items, allAcknowledged };
  },

  async getGuideline(id: number, employeeId: number) {
    if (!employeeId || isNaN(employeeId)) throw err(400, "employeeId 為必填");
    const item = await storage.getGuideline(id);
    if (!item || !item.isActive) throw err(404, "守則未找到");

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
    if (!isRelevant) throw err(403, "無權存取此守則");
    return item;
  },

  async acknowledgeAll(employeeId: number, guidelineIds: number[]) {
    if (!employeeId || !Array.isArray(guidelineIds)) throw err(400, "缺少必要參數");
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
    for (const gid of toAck) await storage.createGuidelineAck({ guidelineId: gid, employeeId });
    return { success: true, acknowledged: toAck.length };
  },

  async getMyAttendance(employeeId: number) {
    const employee = await storage.getEmployee(employeeId);
    if (!employee) throw err(404, "找不到員工");

    // 補打卡審核通過後，clockRecords 會寫入 amendedTime（補正後的真實時間）。出勤一律
    // 以「補正後時間」為準（時間壓上去算出勤）；未補正則沿用原打卡時間。amendmentId 或
    // amendedTime 任一存在即代表此筆經補打卡 → 用來在出勤紀錄標示「補打卡通過」。
    const effTime = (cr: { amendedTime?: Date | null; clockTime?: Date | null } | null | undefined): Date | null => {
      if (!cr) return null;
      const t = cr.amendedTime ?? cr.clockTime ?? null;
      return t ? new Date(t) : null;
    };
    const isAmended = (cr: { amendedTime?: Date | null; amendmentId?: number | null } | null | undefined): boolean =>
      !!(cr && (cr.amendedTime || cr.amendmentId));
    const fmtHM = (d: Date | null): string | null =>
      d ? d.toLocaleTimeString("en-US", { timeZone: "Asia/Taipei", hour12: false, hour: "2-digit", minute: "2-digit" }) : null;

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

    const gpsDateMap = new Map<string, typeof clockRecords>();
    for (const cr of clockRecords) {
      if (!cr.clockTime) continue;
      const d = new Date(new Date(cr.clockTime).toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!gpsDateMap.has(ds)) gpsDateMap.set(ds, []);
      gpsDateMap.get(ds)!.push(cr);
    }

    const xlsxDates = new Set(records.map((r) => r.date));
    const xlsxRows = records.map((r) => {
      const dateShifts = shifts.filter((s) => s.date === r.date);
      const shiftInfo = dateShifts.length > 0
        ? dateShifts.map((s) => `${s.startTime.substring(0, 5)}-${s.endTime.substring(0, 5)}`).join(", ")
        : r.scheduledStart && r.scheduledEnd
          ? `${r.scheduledStart}-${r.scheduledEnd}`
          : null;
      const dateClockRecords = (gpsDateMap.get(r.date) || [])
        .filter(Boolean)
        .sort((a, b) => new Date(a.clockTime ?? 0).getTime() - new Date(b.clockTime ?? 0).getTime());
      const clockInRecord = dateClockRecords.find((cr) => cr.clockType === "in");
      const clockOutRecord = [...dateClockRecords].reverse().find((cr) => cr.clockType === "out");
      // 補正後時間優先；GPS 紀錄缺時才退回匯入檔（XLSX）的打卡時間。
      const inHM = fmtHM(effTime(clockInRecord));
      const outHM = fmtHM(effTime(clockOutRecord));
      return {
        date: r.date,
        clockIn: inHM ?? r.clockIn ?? null,
        clockOut: outHM ?? r.clockOut ?? null,
        isLate: r.isLate, isEarlyLeave: r.isEarlyLeave, hasAnomaly: r.hasAnomaly,
        leaveType: r.leaveType, shiftInfo, shiftType: r.shiftType || null,
        clockInAmended: isAmended(clockInRecord),
        clockOutAmended: isAmended(clockOutRecord),
      };
    });

    const gpsRows: typeof xlsxRows = [];
    for (const [dateStr, dayClocks] of Array.from(gpsDateMap.entries())) {
      if (xlsxDates.has(dateStr)) continue;
      const validClocks = dayClocks
        .filter((cr) => cr.status === "success" || cr.status === "warning")
        .sort((a, b) => (effTime(a)?.getTime() ?? 0) - (effTime(b)?.getTime() ?? 0));
      const clockInRecord = validClocks.find((cr) => cr.clockType === "in");
      const clockOutRecord = [...validClocks].reverse().find((cr) => cr.clockType === "out");
      if (!clockInRecord) continue;
      const dateShifts = shifts.filter((s) => s.date === dateStr);
      const shiftInfo = dateShifts.length > 0
        ? dateShifts.map((s) => `${s.startTime.substring(0, 5)}-${s.endTime.substring(0, 5)}`).join(", ")
        : null;
      const gpsMissingOut = !clockOutRecord;
      // 以「補正後時間」算遲到/早退與顯示 → 補打卡通過後出勤即時反映正確時間。
      const clockInStr = fmtHM(effTime(clockInRecord))!;
      const clockOutStr = fmtHM(effTime(clockOutRecord));
      let gpsIsLate = false;
      let gpsIsEarlyLeave = false;
      let gpsHasAnomaly = gpsMissingOut && dateStr < todayStr;
      if (dateShifts.length > 0) {
        const sched = dateShifts[0];
        const schedStart = sched.startTime.slice(0, 5);
        const schedEnd = sched.endTime.slice(0, 5);
        const [sH, sM] = schedStart.split(":").map(Number);
        const [iH, iM] = clockInStr.split(":").map(Number);
        const lateMinutes = (iH * 60 + iM) - (sH * 60 + sM);
        if (lateMinutes > 10) gpsIsLate = true;
        if (clockOutStr) {
          const [eH, eM] = schedEnd.split(":").map(Number);
          const [oH, oM] = clockOutStr.split(":").map(Number);
          const earlyMinutes = (eH * 60 + eM) - (oH * 60 + oM);
          if (earlyMinutes > 10) gpsIsEarlyLeave = true;
          if (clockInStr === clockOutStr) gpsHasAnomaly = true;
        }
      }
      gpsRows.push({
        date: dateStr, clockIn: clockInStr, clockOut: clockOutStr,
        isLate: gpsIsLate, isEarlyLeave: gpsIsEarlyLeave, hasAnomaly: gpsHasAnomaly,
        leaveType: null, shiftInfo, shiftType: null,
        clockInAmended: isAmended(clockInRecord),
        clockOutAmended: isAmended(clockOutRecord),
      });
    }

    const allRows = [...xlsxRows, ...gpsRows].sort((a, b) => b.date.localeCompare(a.date));
    return {
      total: allRows.length,
      late: allRows.filter((r) => r.isLate).length,
      earlyLeave: allRows.filter((r) => r.isEarlyLeave).length,
      anomaly: allRows.filter((r) => r.hasAnomaly).length,
      leave: records.filter((r) => r.leaveHours && r.leaveHours.trim() !== "").length,
      todayLatestClock: latestClockToday
        ? { clockType: latestClockToday.clockType, clockTime: effTime(latestClockToday)!.toISOString() }
        : null,
      todayClockIn: todayClockInRecord ? { clockTime: effTime(todayClockInRecord)!.toISOString() } : null,
      todayClockOut: todayClockOutRecord ? { clockTime: effTime(todayClockOutRecord)!.toISOString() } : null,
      records: allRows,
    };
  },
};
