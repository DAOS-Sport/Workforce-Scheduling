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
    if (!apiUrl || !apiKey) {
      console.warn("[summer] ENROLLMENT_API_URL 或 ENROLLMENT_API_KEY 未設定，回傳空資料");
      return { items: [], lastUpdated: new Date().toISOString(), source: "unconfigured" };
    }
    const url = `${apiUrl}?weekNo=${weekNo}&includeZero=true`;
    const res = await fetch(url, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw err(502, `報名系統 API 回傳 ${res.status}：${body.slice(0, 200)}`);
    }
    const raw = await res.json();
    const items = Array.isArray(raw) ? raw : (Array.isArray(raw.items) ? raw.items : []);
    return {
      items,
      lastUpdated: raw.lastUpdated || new Date().toISOString(),
      filters: raw.filters || {},
      source: "api",
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
