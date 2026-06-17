import { storage } from "../../storage";
import { db } from "../../db";
import { eq, and, like, gte, lte } from "drizzle-orm";
import { shifts, summerScheduleAssignments, manualScheduleCourses, type InsertShift, type InsertSummerScheduleAssignment, type InsertManualScheduleCourse } from "@shared/schema";
import { isValidLineUserId } from "../line/lineSignature";

const SUMMER_WEEKS = [
  { no: 1, label: "第1週｜07/01（三）－07/05（日）", startDate: "2026-07-01", endDate: "2026-07-05" },
  { no: 2, label: "第2週｜07/06（一）－07/12（日）", startDate: "2026-07-06", endDate: "2026-07-12" },
  { no: 3, label: "第3週｜07/13（一）－07/19（日）", startDate: "2026-07-13", endDate: "2026-07-19" },
  { no: 4, label: "第4週｜07/20（一）－07/26（日）", startDate: "2026-07-20", endDate: "2026-07-26" },
  { no: 5, label: "第5週｜07/27（一）－08/02（日）", startDate: "2026-07-27", endDate: "2026-08-02" },
  { no: 6, label: "第6週｜08/03（一）－08/09（日）", startDate: "2026-08-03", endDate: "2026-08-09" },
  { no: 7, label: "第7週｜08/10（一）－08/16（日）", startDate: "2026-08-10", endDate: "2026-08-16" },
  { no: 8, label: "第8週｜08/17（一）－08/23（日）", startDate: "2026-08-17", endDate: "2026-08-23" },
  { no: 9, label: "第9週｜08/24（一）－08/30（日）", startDate: "2026-08-24", endDate: "2026-08-30" },
];

function err(status: number, message: string): Error {
  const e: any = new Error(message);
  e.status = status;
  return e;
}

// 外部報名系統回傳全部梯次資料，每筆有 termStartDate。
// 用日期範圍比對 SUMMER_WEEKS 來篩出正確週次，不傳 termId 給外部 API。

function normalizeText(value: any): string {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[\uFF08\uFF09()]/g, "")
    .trim();
}

function normalizeCourseName(value: any): string {
  const s = normalizeText(value);
  if (!s) return "";
  if (s.includes("\u4e00\u822c\u6cf3\u6cf3")) return "\u4e00\u822c\u6cf3\u6cf3";
  if (s.includes("\u5e7c\u5e7c")) return "\u5e7c\u5e7c\u73ed\u6cf3\u6cf3";
  if (s.includes("\u73a9\u6c34")) return "\u73a9\u6c34\u73ed";
  if (s.includes("\u7fbd\u7403")) return "\u5ba4\u5167\u7fbd\u7403\u8ab2";
  if (s.includes("\u7c43\u7403")) return "\u5ba4\u5916\u7c43\u7403\u8ab2";
  if (s.includes("\u684c\u7403")) return "\u5ba4\u5167\u684c\u7403\u8ab2";
  if (s.includes("\u68d2\u7403")) return "\u68d2\u7403\u8ab2";
  if (s.includes("\u9ad8\u968e")) return "\u9ad8\u968e\u6cf3\u6cf3\u73ed";
  if (s.includes("\u5047\u65e5")) return "\u6cf3\u6cf3\u5047\u65e5\u73ed";
  return s;
}

function normalizeSlotCode(value: any): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function normalizeVenueId(row: any): number | null {
  const id = Number(row.venueId ?? row.venue_id ?? row.locationId ?? row.location_id);
  if (Number.isFinite(id) && id > 0) return id;

  const name = normalizeText(row.venueName ?? row.venue ?? row.locationName ?? row.location);
  if (name.includes("\u65b0\u5317")) return 1;
  if (name.includes("\u4e09\u91cd")) return 2;
  if (name.includes("\u4e09\u6c11")) return 3;

  return null;
}

function normalizeRegisteredCount(row: any): number {
  const raw =
    row.registeredCount ??
    row.count ??
    row.total ??
    row.enrollmentCount ??
    row.enrolled ??
    row.students ??
    row.numberOfStudents ??
    0;

  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function normalizeEnrollmentRow(row: any, weekNo: number, termId: number) {
  const venueId = normalizeVenueId(row);
  const courseName = normalizeCourseName(
    row.courseName ??
    row.course ??
    row.className ??
    row.programName ??
    row.productName
  );

  const slotCode = normalizeSlotCode(
    row.slotCode ??
    row.timeCode ??
    row.periodCode ??
    row.sessionCode ??
    row.code
  );

  const registeredCount = normalizeRegisteredCount(row);

  if (!venueId || !courseName || !slotCode) {
    return null;
  }

  return {
    weekNo,
    termId,
    venueId,
    courseId: row.courseId ?? row.course_id ?? null,
    slotId: row.slotId ?? row.slot_id ?? null,
    courseName,
    slotCode,
    registeredCount,
  };
}

export const summerScheduleService = {
  async getEmployeesForSchedule() {
    const all = await storage.getAllEmployees();
    const active = all.filter((e) => e.status === "active");
    const venues = await storage.getAllVenues();
    const venueMap = new Map(venues.map((v) => [v.id, v]));
    const items = active.map((e) => {
      const venue = e.regionId ? venueMap.get(e.regionId) : undefined;
      return {
        id: e.id,
        name: e.name,
        role: e.role,
        venueId: venue?.id ?? null,
        venueName: venue?.shortName ?? null,
        lineBound: !!(e.lineId && isValidLineUserId(e.lineId)),
        lineDisplayName: null,
        lineBoundAt: null,
      };
    });
    items.sort((a, b) => (b.lineBound ? 1 : 0) - (a.lineBound ? 1 : 0));
    return { items };
  },

  async getEnrollmentCounts(weekNo: number) {
    const apiUrl = process.env.ENROLLMENT_API_URL;
    const apiKey = process.env.ENROLLMENT_API_KEY;

    const safeWeekNo = Number(weekNo);
    const week = SUMMER_WEEKS.find((w) => w.no === safeWeekNo);

    if (!week) {
      return {
        items: [],
        lastUpdated: new Date().toISOString(),
        source: "invalid_week",
        message: "週別錯誤",
      };
    }

    if (!apiUrl || !apiKey) {
      console.warn("[summer] ENROLLMENT_API_URL 或 ENROLLMENT_API_KEY 未設定，回傳空資料");
      return {
        items: [],
        lastUpdated: new Date().toISOString(),
        source: "unconfigured",
      };
    }

    // 外部 API 回傳全部梯次，不接受 termId 過濾。
    // 撈全部後，依 termStartDate 落在本週日期範圍內篩選。
    const url = new URL(apiUrl);
    url.searchParams.set("includeZero", "true");

    const res = await fetch(url.toString(), {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(10000),
    });

    const contentType = res.headers.get("content-type") || "";

    if (!res.ok || !contentType.includes("application/json")) {
      const body = await res.text().catch(() => "");
      const hint = contentType.includes("text/html")
        ? "報名系統回傳 HTML，API 網址可能不是 JSON 端點"
        : `HTTP ${res.status}`;
      console.warn(`[summer] 報名系統 API 無法使用：${hint} ${body.slice(0, 120)}`);
      return {
        items: [],
        lastUpdated: new Date().toISOString(),
        source: "unavailable",
        hint,
      };
    }

    let raw: any;
    try {
      raw = await res.json();
    } catch (e: any) {
      console.warn("[summer] 報名系統 API 回傳非 JSON：", e.message);
      return {
        items: [],
        lastUpdated: new Date().toISOString(),
        source: "parse_error",
      };
    }

    const allItems: any[] = Array.isArray(raw)
      ? raw
      : Array.isArray(raw.items)
        ? raw.items
        : Array.isArray(raw.data)
          ? raw.data
          : [];

    // 用 termStartDate 比對本週範圍（startDate ≤ termStartDate ≤ endDate）
    const weekStart = week.startDate; // "2026-07-01"
    const weekEnd   = week.endDate;   // "2026-07-05"

    const weekItems = allItems.filter((row) => {
      const d = String(row.termStartDate || "").slice(0, 10);
      return d >= weekStart && d <= weekEnd;
    });

    // 依「場館 + 課程 + 時段」彙整（同一格可能有多筆梯次累加）
    const map = new Map<string, any>();

    for (const row of weekItems) {
      const item = normalizeEnrollmentRow(row, safeWeekNo, row.termId ?? 0);
      if (!item) continue;

      const key = [item.weekNo, item.venueId, item.courseName, item.slotCode].join("|");
      const existing = map.get(key);

      if (!existing) {
        map.set(key, item);
      } else {
        existing.registeredCount += item.registeredCount;
      }
    }

    const items = Array.from(map.values());

    return {
      items,
      lastUpdated: raw.lastUpdated || new Date().toISOString(),
      filters: { weekNo: safeWeekNo, weekStart, weekEnd },
      source: "api",
      debug: {
        rawCount: allItems.length,
        weekFilteredCount: weekItems.length,
        normalizedCount: items.length,
      },
    };
  },

  async getScheduleAssignments(weekNo: number) {
    const [row] = await db.select().from(summerScheduleAssignments).where(
      and(eq(summerScheduleAssignments.version, "v40"), eq(summerScheduleAssignments.weekNo, weekNo))
    );
    if (!row) return null;
    return {
      version: row.version,
      weekNo: row.weekNo,
      rawEntries: row.rawEntries ?? [],
      assignments: row.assignments ?? [],
      shifts: row.shiftEntries ?? [],
    };
  },

  async saveScheduleAssignments(payload: any) {
    const { version = "v40", weekNo, rawEntries, assignments, shifts: shiftEntries } = payload;
    const [existing] = await db.select().from(summerScheduleAssignments).where(
      and(eq(summerScheduleAssignments.version, version), eq(summerScheduleAssignments.weekNo, weekNo))
    );
    const data: InsertSummerScheduleAssignment = {
      version,
      weekNo,
      rawEntries: rawEntries ?? [],
      assignments: assignments ?? [],
      shiftEntries: shiftEntries ?? [],
    };
    if (existing) {
      await db.update(summerScheduleAssignments).set({ ...data, updatedAt: new Date() }).where(eq(summerScheduleAssignments.id, existing.id));
    } else {
      await db.insert(summerScheduleAssignments).values(data);
    }
    return { success: true };
  },

  async getManualCourses(weekNo: number) {
    return db.select().from(manualScheduleCourses).where(
      and(eq(manualScheduleCourses.weekNo, weekNo), eq(manualScheduleCourses.status, "active"))
    );
  },

  async createManualCourse(data: InsertManualScheduleCourse) {
    const [row] = await db.insert(manualScheduleCourses).values(data).returning();
    return row;
  },

  async updateManualCourse(id: number, data: Partial<InsertManualScheduleCourse>) {
    const [row] = await db.update(manualScheduleCourses).set({ ...data, updatedAt: new Date() }).where(eq(manualScheduleCourses.id, id)).returning();
    return row;
  },

  async deleteManualCourse(id: number) {
    await db.update(manualScheduleCourses).set({ status: "deleted", updatedAt: new Date() }).where(eq(manualScheduleCourses.id, id));
    return { success: true };
  },

  async publishShifts(payload: any) {
    const { weekNo, shifts: incoming } = payload;
    if (!weekNo || !Array.isArray(incoming)) throw err(400, "weekNo 和 shifts 為必填");

    const week = SUMMER_WEEKS.find((w) => w.no === weekNo);
    if (!week) throw err(400, "weekNo 只允許 1-9");

    // 1. 找出這週已有的 summer-schedule-v40 班次（透過 notes 標記）
    const existing = await db.select().from(shifts).where(
      and(
        gte(shifts.date, week.startDate),
        lte(shifts.date, week.endDate),
        like(shifts.notes, "%暑假排班v40%"),
        eq(shifts.status, "active")
      )
    );

    // 2. 取消舊資料
    for (const s of existing) {
      await storage.deleteShift(s.id, "summer-schedule-publish", "重新發布暑假排班", true);
    }

    // 3. 寫入新 shifts
    let inserted = 0;
    for (const item of incoming) {
      const noteTag = `暑假排班v40｜weekNo=${weekNo}`;
      const notes = item.notes ? `${item.notes}｜${noteTag}` : noteTag;
      const shiftData: InsertShift = {
        employeeId: item.employeeId,
        venueId: item.venueId,
        date: item.date,
        startTime: item.startTime,
        endTime: item.endTime,
        role: item.role || "教練",
        notes,
      };
      await storage.createShift(shiftData, "summer-schedule-publish");
      inserted++;
    }

    return { success: true, message: "已發布到員工前台", inserted };
  },

  async getMySummerShifts(weekNo: number, lineId: string) {
    const week = SUMMER_WEEKS.find((w) => w.no === weekNo);
    if (!week) throw err(400, "weekNo 只允許 1-9");

    const employee = await storage.getEmployeeByLineId(lineId);
    if (!employee) throw err(404, "找不到此 LINE 帳號對應的員工資料");

    const empShifts = await storage.getShiftsByEmployeeAndDateRange(employee.id, week.startDate, week.endDate);
    const summerShifts = empShifts.filter((s) => s.notes?.includes("暑假排班v40") && s.status === "active");

    const venues = await storage.getAllVenues();
    const venueMap = new Map(venues.map((v) => [v.id, v]));

    return {
      employee: {
        id: employee.id,
        name: employee.name,
        employeeCode: employee.employeeCode,
      },
      week,
      shifts: summerShifts.map((s) => ({
        id: s.id,
        date: s.date,
        venueId: s.venueId,
        venueName: venueMap.get(s.venueId)?.shortName ?? "",
        startTime: s.startTime,
        endTime: s.endTime,
        role: s.role,
        notes: s.notes,
      })),
    };
  },
};
