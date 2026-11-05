import { fetchEnrollmentCounts } from "../../adapters/enrollment";
import { db } from "../../infra/db";
import { eq, and, gte, lte, ne } from "drizzle-orm";
import { shifts, dispatchShifts, type InsertManualScheduleCourse, type ManualScheduleCourse } from "@shared/schema";
import { isValidLineUserId } from "../line/lineSignature";
import { describeProblems, diffSummerWeek, planSummerPublish, type PublishRefs } from "../../core/schedule/summerPublish";
import { oncePerRequestKey, requestKeyOf } from "../../infra/db/idempotency";
import { LOCK_NS, lockXact, withTx, type Tx } from "../../infra/db/tx";
import { httpError } from "../../shared/http/response";
import { employeeService } from "../employee/employee.service";
import { venueService } from "../venue/venue.service";
import { shiftService } from "../shift/shift.service";
import { systemService } from "../system/system.service";
import { DRAFT_VERSION, summerScheduleRepository } from "./summerSchedule.repository";

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

function normalizeWeekNo(value: any): number {
  const weekNo = Number(value);
  if (!Number.isInteger(weekNo) || weekNo < 1 || weekNo > 9) {
    throw httpError(400, "weekNo 只允許 1-9");
  }
  return weekNo;
}

function rawEntryHasScheduleValue(entry: any): boolean {
  const key = String(entry?.key ?? "");
  const value = String(entry?.value ?? "").trim();
  const hasEmployees = Array.isArray(entry?.employees) && entry.employees.length > 0;
  if (!value && !hasEmployees) return false;
  if (key.includes("-availability-")) return false;
  if (key.includes("-dutygrid-rows")) return false;
  if (/-course-.*-enroll$/.test(key)) return false;
  return true;
}

function hasMeaningfulScheduleData(data: {
  rawEntries?: any[] | null;
  assignments?: any[] | null;
  shiftEntries?: any[] | null;
  shifts?: any[] | null;
}): boolean {
  if (Array.isArray(data.assignments) && data.assignments.length > 0) return true;
  if (Array.isArray(data.shiftEntries) && data.shiftEntries.length > 0) return true;
  if (Array.isArray(data.shifts) && data.shifts.length > 0) return true;
  return Array.isArray(data.rawEntries) && data.rawEntries.some(rawEntryHasScheduleValue);
}

function hasWorkRows(data: {
  assignments?: any[] | null;
  shiftEntries?: any[] | null;
  shifts?: any[] | null;
}): boolean {
  return (
    (Array.isArray(data.assignments) && data.assignments.length > 0) ||
    (Array.isArray(data.shiftEntries) && data.shiftEntries.length > 0) ||
    (Array.isArray(data.shifts) && data.shifts.length > 0)
  );
}

function hasShiftRows(data: {
  shiftEntries?: any[] | null;
  shifts?: any[] | null;
}): boolean {
  return (
    (Array.isArray(data.shiftEntries) && data.shiftEntries.length > 0) ||
    (Array.isArray(data.shifts) && data.shifts.length > 0)
  );
}

function normalizeOptionalText(value: any): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function normalizeRequiredText(value: any, message: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw httpError(400, message);
  return text;
}

function normalizeNonNegativeInt(value: any): number {
  const n = Number.parseInt(String(value ?? "0"), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function normalizeOptionalInt(value: any): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function normalizeDate(value: any): string {
  const date = normalizeRequiredText(value, "date 為必填");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw httpError(400, "date 格式須為 YYYY-MM-DD");
  }
  return date;
}

function normalizeTime(value: any, fieldName: string): string {
  const time = normalizeRequiredText(value, `${fieldName} 為必填`);
  if (!/^\d{2}:\d{2}$/.test(time)) {
    throw httpError(400, `${fieldName} 格式須為 HH:MM`);
  }
  return time;
}

function normalizeManualCourseVenueId(value: any): number {
  const venueId = Number(value);
  if (!Number.isInteger(venueId) || venueId <= 0) {
    throw httpError(400, "venueId 為必填");
  }
  return venueId;
}

export function normalizeManualCourseCreateInput(item: any): InsertManualScheduleCourse {
  const startTime = normalizeTime(item.startTime, "startTime");
  const endTime = normalizeTime(item.endTime, "endTime");
  if (startTime >= endTime) {
    throw httpError(400, "endTime 必須晚於 startTime");
  }

  return {
    weekNo: normalizeWeekNo(item.weekNo),
    date: normalizeDate(item.date),
    venueId: normalizeManualCourseVenueId(item.venueId),
    venueName: normalizeOptionalText(item.venueName ?? item.venue),
    courseName: normalizeRequiredText(item.courseName, "courseName 為必填"),
    startTime,
    endTime,
    registeredCount: normalizeNonNegativeInt(item.registeredCount),
    requiredCoaches: normalizeNonNegativeInt(item.requiredCoaches ?? 1),
    employeeId: normalizeOptionalInt(item.employeeId),
    employeeName: normalizeOptionalText(item.employeeName),
    note: normalizeOptionalText(item.note),
    status: item.status === "deleted" ? "deleted" : "active",
  };
}

export function normalizeManualCoursePatchInput(item: any): Partial<InsertManualScheduleCourse> {
  const patch: Partial<InsertManualScheduleCourse> = {};

  if (item.weekNo !== undefined) patch.weekNo = normalizeWeekNo(item.weekNo);
  if (item.date !== undefined) patch.date = normalizeDate(item.date);
  if (item.venueId !== undefined) patch.venueId = normalizeManualCourseVenueId(item.venueId);
  if (item.venueName !== undefined || item.venue !== undefined) patch.venueName = normalizeOptionalText(item.venueName ?? item.venue);
  if (item.courseName !== undefined) patch.courseName = normalizeRequiredText(item.courseName, "courseName 為必填");
  if (item.startTime !== undefined) patch.startTime = normalizeTime(item.startTime, "startTime");
  if (item.endTime !== undefined) patch.endTime = normalizeTime(item.endTime, "endTime");
  if (item.registeredCount !== undefined) patch.registeredCount = normalizeNonNegativeInt(item.registeredCount);
  if (item.requiredCoaches !== undefined) patch.requiredCoaches = normalizeNonNegativeInt(item.requiredCoaches);
  if (item.employeeId !== undefined) patch.employeeId = normalizeOptionalInt(item.employeeId);
  if (item.employeeName !== undefined) patch.employeeName = normalizeOptionalText(item.employeeName);
  if (item.note !== undefined) patch.note = normalizeOptionalText(item.note);
  if (item.status !== undefined) patch.status = item.status === "deleted" ? "deleted" : "active";

  const startTime = patch.startTime ?? item.startTime;
  const endTime = patch.endTime ?? item.endTime;
  if (startTime !== undefined && endTime !== undefined && String(startTime) >= String(endTime)) {
    throw httpError(400, "endTime 必須晚於 startTime");
  }

  return patch;
}

function manualCourseEmployeeEntries(course: any, rawEntries: any[]): any[] {
  const courseId = String(course?.id ?? "");
  if (!courseId) return [];

  const rawMatches = rawEntries.filter((entry) => {
    const key = String(entry?.key ?? "");
    return key.endsWith(`-manual-${courseId}-coach`) && Array.isArray(entry?.employees);
  });

  const employees = rawMatches.flatMap((entry) => entry.employees ?? []);
  if (employees.length) return employees;

  if (course.employeeId) {
    return [{ employeeId: course.employeeId, employeeName: course.employeeName ?? "" }];
  }

  return [];
}

export function buildManualCourseShiftEntries(manualCourses: any[], rawEntries: any[], weekNo: number): any[] {
  const rows: any[] = [];

  for (const course of Array.isArray(manualCourses) ? manualCourses : []) {
    if (!course || course.status === "deleted") continue;
    if (Number(course.weekNo) !== Number(weekNo)) continue;
    if (!course.id || !course.venueId || !course.date || !course.startTime || !course.endTime) continue;

    for (const employee of manualCourseEmployeeEntries(course, Array.isArray(rawEntries) ? rawEntries : [])) {
      const employeeId = Number(employee?.employeeId ?? employee?.id);
      if (!Number.isInteger(employeeId) || employeeId <= 0) continue;

      const notes = [
        "手動課程",
        course.courseName,
        course.registeredCount !== undefined && course.registeredCount !== null ? `報名 ${course.registeredCount} 人` : "",
        course.requiredCoaches !== undefined && course.requiredCoaches !== null ? `需求 ${course.requiredCoaches} 位` : "",
        `manualCourseId:${course.id}`,
      ].filter(Boolean).join("｜");

      rows.push({
        employeeId,
        venueId: Number(course.venueId),
        date: course.date,
        startTime: String(course.startTime).slice(0, 5),
        endTime: String(course.endTime).slice(0, 5),
        role: "教練",
        notes,
        status: "active",
        source: "summer-schedule-v40",
        weekNo,
        roleType: "course",
        courseName: course.courseName ?? "",
        slotCode: "MANUAL",
        manualCourseId: String(course.id),
      });
    }
  }

  return rows;
}

export function mergeShiftEntries(primary: any[], supplemental: any[]): any[] {
  const merged: any[] = [];
  const seen = new Set<string>();

  for (const item of [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(supplemental) ? supplemental : [])]) {
    const key = [
      item?.employeeId,
      item?.venueId,
      item?.date,
      item?.startTime,
      item?.endTime,
      item?.role || "教練",
      item?.manualCourseId || "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  return merged;
}

/**
 * The version a draft save says it started from: undefined when the page did not say (older pages,
 * saved as before), null for "no draft yet", otherwise the `updatedAt` it last read or saved.
 */
function expectedDraftVersion(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const at = new Date(typeof value === "number" ? value : String(value));
  if (Number.isNaN(at.getTime())) throw httpError(400, "expectedUpdatedAt 格式錯誤");
  return at;
}

const draftConflict = (current: Date | null | undefined) =>
  httpError(409, "這週的班表已被其他人或其他分頁更新，請重新載入後再修改", {
    errorCode: "SUMMER_DRAFT_CONFLICT",
    updatedAt: current ? current.toISOString() : null,
  });

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

// DB venues 表 id：三重商工=1, 新北高中=2, 三民高中=3
// 外部報名系統 venueId（2026-07-22 重新實測確認，外部系統無 id=4）：
// 1=新北高中, 3=三重商工, 5=三民高中。
// 故需將外部 venueId 對應到正確的 DB id。
// 修正記錄：三民高中舊映射鍵誤寫為 4（外部系統從未存在過此 id），
// 導致外部傳回的 venueId=5 未命中映射、原樣放行，
// 而本系統 DB id=5 是另一個不相關場館（新竹科學園區），
// 造成三民高中報名人數永遠顯示 0、且誤植到新竹科學園區名下。
const EXTERNAL_VENUE_ID_MAP: Record<number, number> = {
  1: 2,  // 外部 1（新北高中）→ DB 2（新北高中）
  3: 1,  // 外部 3（三重商工）→ DB 1（三重商工）
  5: 3,  // 外部 5（三民高中）→ DB 3（三民高中）
};

function normalizeVenueId(row: any): number | null {
  const rawId = Number(row.venueId ?? row.venue_id ?? row.locationId ?? row.location_id);
  if (Number.isFinite(rawId) && rawId > 0) {
    return EXTERNAL_VENUE_ID_MAP[rawId] ?? rawId;
  }

  const name = normalizeText(row.venueName ?? row.venue ?? row.locationName ?? row.location);
  if (name.includes("\u4e09\u91cd")) return 1; // 三重 → DB id 1
  if (name.includes("\u65b0\u5317")) return 2; // 新北 → DB id 2
  if (name.includes("\u4e09\u6c11")) return 3; // 三民 → DB id 3

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
    isClosed: row.isClosed === true,
    closureReason: (row.closureReason ?? null) as string | null,
  };
}

export function enrollmentRowOverlapsWeek(row: any, week: { startDate: string; endDate: string }): boolean {
  const termStart = String(row.termStartDate || "").slice(0, 10);
  const termEnd = String(row.termEndDate || row.termStartDate || "").slice(0, 10);

  if (!termStart) return false;

  return termStart <= week.endDate && termEnd >= week.startDate;
}

const PUBLISH_ACTOR = "summer-schedule-publish";

/**
 * Publish one week inside the caller's transaction, which holds the week's lock. The whole batch is
 * checked first; then only the difference is written: shifts that match the plan exactly stay (same
 * id), the rest of the week's published shifts are cancelled, and the missing ones are added. A
 * failure anywhere rolls all of it back, so employees keep the week they had (GitHub #8).
 */
async function applyPublish(tx: Tx, week: { startDate: string; endDate: string }, weekNo: number, incoming: any[], refs: PublishRefs) {
  // 空的發布不動舊班，也不回成功：把員工該週已發布班表整週清空的事不能靜默發生。
  if (!Array.isArray(incoming) || incoming.length === 0) {
    throw httpError(422, "此週無可發布班次，已取消發布以保留員工現有班表", {
      errorCode: "SUMMER_PUBLISH_EMPTY",
      success: false,
      inserted: 0,
    });
  }
  const plan = planSummerPublish(incoming, week, weekNo, refs);
  if (!plan.ok) {
    throw httpError(
      422,
      `第 ${weekNo} 週有 ${plan.problems.length} 筆班次資料有誤（${describeProblems(plan.problems)}），已取消發布，員工現有班表沒有變動`,
      { errorCode: "SUMMER_PUBLISH_INVALID_ROWS", problems: plan.problems },
    );
  }

  // 這週已發布的暑假班（notes 帶「暑假排班v40」標記、仍有效）
  const published = (await shiftService.getAllShiftsByDateRange(week.startDate, week.endDate, tx)).filter((s) => s.notes?.includes("暑假排班v40"));
  const diff = diffSummerWeek(published, plan.shifts);
  for (const s of diff.cancel) {
    await shiftService.deleteShift(s.id, PUBLISH_ACTOR, "重新發布暑假排班", true, tx);
  }
  for (const shift of diff.create) {
    await shiftService.createShiftRecord(shift, PUBLISH_ACTOR, tx);
  }

  return {
    success: true,
    message: "已發布到員工前台",
    // `inserted` stays "shifts the week now has" because the page shows it as the published count.
    inserted: plan.shifts.length,
    created: diff.create.length,
    unchanged: diff.unchanged.length,
    cancelled: diff.cancel.length,
    skipped: 0,
  };
}

export const summerScheduleService = {
  async getEmployeesForSchedule() {
    const all = await employeeService.getAllEmployees();
    const active = all.filter((e) => e.status === "active");
    const venues = await venueService.findAll();
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

    // 外部 API 回傳全部梯次，撈全部後依梯次日期區間與本週是否重疊篩選。
    const res = await fetchEnrollmentCounts(apiUrl, apiKey);

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

    // 用梯次日期區間比對本週範圍。
    // 假日班 7 月梯次會是 07/04-07/26，必須同時出現在第 1-4 週。
    const weekStart = week.startDate; // "2026-07-01"
    const weekEnd   = week.endDate;   // "2026-07-05"

    const weekItems = allItems.filter((row) => enrollmentRowOverlapsWeek(row, week));

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
        // 任一梯次關班 → 整合計視為關班
        if (item.isClosed) {
          existing.isClosed = true;
          existing.closureReason = item.closureReason ?? existing.closureReason;
        }
      }
    }

    const items = Array.from(map.values());

    // 收集 raw venueId 樣本供映射確認（每個 raw venueId 取一筆代表）
    const rawVenueSampleMap = new Map<number, any>();
    for (const row of weekItems) {
      const rawId = Number(row.venueId ?? row.venue_id ?? row.locationId ?? row.location_id);
      if (!rawVenueSampleMap.has(rawId)) {
        rawVenueSampleMap.set(rawId, {
          rawVenueId: rawId,
          venueName: row.venueName ?? row.venue ?? row.locationName ?? null,
          mappedDbId: EXTERNAL_VENUE_ID_MAP[rawId] ?? rawId,
          sampleCourse: row.courseName ?? row.course ?? row.className ?? null,
        });
      }
    }
    const rawVenueSample = Array.from(rawVenueSampleMap.values()).sort((a, b) => a.rawVenueId - b.rawVenueId);
    console.log("[summer enrollment] raw venue sample:", JSON.stringify(rawVenueSample));

    return {
      items,
      lastUpdated: raw.lastUpdated || new Date().toISOString(),
      filters: { weekNo: safeWeekNo, weekStart, weekEnd },
      source: "api",
      debug: {
        rawCount: allItems.length,
        weekFilteredCount: weekItems.length,
        normalizedCount: items.length,
        rawVenueSample,
      },
    };
  },

  async getScheduleAssignments(weekNo: number) {
    const row = await summerScheduleRepository.getDraft(weekNo);
    if (!row) return null;
    return {
      version: row.version,
      weekNo: row.weekNo,
      updatedAt: row.updatedAt ?? null,
      rawEntries: row.rawEntries ?? [],
      assignments: row.assignments ?? [],
      shifts: row.shiftEntries ?? [],
    };
  },

  /**
   * Save the week's whole draft. Saves of one week run one at a time under the week's lock (the
   * same lock publish takes). A save that says which version it started from (`expectedUpdatedAt`)
   * is stored only if the draft is still that version, else 409 with the current version; a page
   * that does not say is saved as before. The stored version name is always v40, whatever the page sends.
   */
  async saveScheduleAssignments(payload: any) {
    const { rawEntries, assignments, shifts: shiftEntries } = payload;
    const weekNo = normalizeWeekNo(payload.weekNo);
    const expected = expectedDraftVersion(payload.expectedUpdatedAt);
    const content = {
      rawEntries: Array.isArray(rawEntries) ? rawEntries : [],
      assignments: Array.isArray(assignments) ? assignments : [],
      shiftEntries: Array.isArray(shiftEntries) ? shiftEntries : [],
    };
    const guardData = {
      rawEntries: content.rawEntries as any[],
      assignments: content.assignments as any[],
      shiftEntries: content.shiftEntries as any[],
    };
    const incomingHasShiftRows = hasShiftRows(guardData);
    const incomingHasWorkRows = hasWorkRows(guardData);
    const incomingHasScheduleData = hasMeaningfulScheduleData(guardData);

    return withTx(async (tx) => {
      await lockXact(tx, LOCK_NS.summerWeek, weekNo);
      const existing = await summerScheduleRepository.getDraft(weekNo, tx);
      if (existing && (!incomingHasShiftRows || !incomingHasWorkRows || !incomingHasScheduleData)) {
        const existingData = {
          rawEntries: existing.rawEntries as any[],
          assignments: existing.assignments as any[],
          shiftEntries: existing.shiftEntries as any[],
        };
        if (hasShiftRows(existingData) && !incomingHasShiftRows) {
          throw httpError(409, "保護：空白班表不覆蓋既有排班資料");
        }
        if (hasWorkRows(existingData) && !incomingHasWorkRows) {
          throw httpError(409, "保護：空白班表不覆蓋既有排班資料");
        }
        if (hasMeaningfulScheduleData(existingData) && !incomingHasScheduleData) {
          throw httpError(409, "保護：空白班表不覆蓋既有排班資料");
        }
      }

      // Always later than the stored version, so two saves within one millisecond still differ.
      const updatedAt = new Date(Math.max(Date.now(), (existing?.updatedAt?.getTime() ?? 0) + 1));
      if (expected === undefined) {
        await summerScheduleRepository.upsertDraft(weekNo, content, updatedAt, tx);
      } else if (expected === null) {
        if (!(await summerScheduleRepository.insertDraftIfAbsent(weekNo, content, updatedAt, tx))) throw draftConflict(existing?.updatedAt);
      } else if (!(await summerScheduleRepository.updateDraftIfUnchanged(weekNo, expected, content, updatedAt, tx))) {
        throw draftConflict(existing?.updatedAt);
      }
      return { success: true, version: DRAFT_VERSION, updatedAt: updatedAt.toISOString() };
    });
  },

  async getManualCourses(weekNo: number) {
    return summerScheduleRepository.getActiveManualCourses(weekNo);
  },

  /**
   * Add manual courses. With a request id, sending the same request again returns the courses
   * created the first time instead of adding copies (each copy would publish as its own coach shift).
   */
  async createManualCourses(items: any[], requestId?: unknown): Promise<ManualScheduleCourse[]> {
    if (!items.length) return [];
    const sanitized = items.map((item: any) => normalizeManualCourseCreateInput(item));
    return withTx(async (tx) => {
      const { value } = await oncePerRequestKey(tx, "summer-manual-course", requestKeyOf(requestId), () =>
        summerScheduleRepository.createManualCourses(sanitized, tx),
      );
      return value;
    });
  },

  async updateManualCourse(id: number, data: Partial<InsertManualScheduleCourse>) {
    if (!Number.isInteger(id) || id <= 0) throw httpError(400, "id 格式錯誤");
    const patch = normalizeManualCoursePatchInput(data);
    const row = await summerScheduleRepository.updateManualCourse(id, patch);
    if (!row) throw httpError(404, "找不到手動課程");
    return row;
  },

  async deleteManualCourse(id: number) {
    if (!Number.isInteger(id) || id <= 0) throw httpError(400, "id 格式錯誤");
    await summerScheduleRepository.updateManualCourse(id, { status: "deleted" });
    return { success: true };
  },

  /**
   * 從 Google 試算表匯入「補習班上課資訊」。
   *
   * ── 為什麼要這條路 ──────────────────────────────────────────────────
   * 補習班的課一直是人手打進手動排課的，於是同一件事長出多種寫法。
   * 2026-08-19 實測正式庫：42 種課名裡至少 12 種是同一件事的不同寫法
   *   樂獅桌球／樂獅-桌球　斯塔／斯塔-游泳　新學林／新學林-游泳
   *   立得／立得-游泳／立得補習班／立德（最後一個還是別的字）
   * 而試算表那邊本來就把「補習班名稱」與「項目類別」分成兩欄，是乾淨的來源。
   * 這裡由程式用固定格式把兩欄組成課名，人就沒有打錯的機會，
   * 而且新項目（例如斯塔的瑜珈）自動就有，不必改程式。
   *
   * ── 刻意只收補習班 ─────────────────────────────────────────────────
   * 假日班不在試算表裡（場館端確認過「這邊沒有假日班」），它走報名系統 API。
   * 若讓假日班也從這條路進來會變成兩個來源同時寫，畫面上一堂課會出現兩次。
   *
   * ── 冪等 ───────────────────────────────────────────────────────────
   * 以 (date, courseName, startTime, endTime) 當鍵：已存在就更新，不存在才新增。
   * 巨集按兩次不會變成兩倍堂數 —— 那會直接變成兩倍薪水。
   * 「查有沒有、再新增」在全域匯入鎖（LOCK_NS.cramImport）裡做，整批一個交易：
   * 兩次同時跑會排隊，第二次只會更新；任何一筆寫入失敗整批不留。
   * 鍵要不要含場館（venue_id）待業務確認，目前維持不含。
   *
   * ── 教練歸後台 ─────────────────────────────────────────────────────
   * 已存在的課若已經有教練（後台可能改過），更新時不覆寫教練，只回報在 coachKept。
   * 沒有教練的課才由匯入補上。
   *
   * ── 不自動刪除 ─────────────────────────────────────────────────────
   * 試算表刪掉的課，這裡只會列進 stale 回報，不會自動把資料庫的刪掉。
   * 匯入來源是人維護的表，一次誤刪就把整週課程清空的風險不值得冒。
   */
  async importCramCourses(payload: any) {
    const rows: any[] = Array.isArray(payload?.rows) ? payload.rows : [];
    const dryRun = payload?.dryRun === true;
    if (!rows.length) throw httpError(400, "rows 為必填且不可為空");
    if (rows.length > 500) throw httpError(400, "單次最多 500 筆");

    // 員工名冊只撈一次，用來把「排班人員」的姓名對回 employeeId。
    // 對不到不擋整批 —— 名冊外的臨時教練是常態（CLAUDE.md 第八條記載 19 個）。
    const employees = await employeeService.getAllEmployees();
    const empByName = new Map<string, any>();
    for (const e of employees) {
      const n = String(e.name || "").trim();
      if (n && !empByName.has(n)) empByName.set(n, e);
    }

    // 補習班名單：薪資頁的分類器用「課名開頭是不是補習班」來決定 1 小時還是 1.5 小時。
    // 名單外的補習班，球類的課會被判成「球類課程 1.5h」而不是「補習班課程 1h」——
    // CLAUDE.md 記載這個坑踩過，45 筆每堂多算 0.5 小時。
    // 匯入時比對一次，沒在名單裡的回報出來，不要等薪水發錯才發現。
    const PV_CRAM_DEFAULT = ["加洲森林","欣蓓","樂獅","新學林","皇家達","曼斯特","空中美語","立得","立德","斯塔","小丑魚"];
    let cramList: string[] = PV_CRAM_DEFAULT;
    try {
      const cfg = await systemService.findSystemConfig("summer-payroll-config-v1");
      const parsed = cfg ? (typeof cfg.value === "string" ? JSON.parse(cfg.value) : cfg.value) : null;
      if (Array.isArray(parsed?.cramSchools) && parsed.cramSchools.length) cramList = parsed.cramSchools;
    } catch {
      // 讀不到設定就用預設名單。這裡只影響「要不要提醒」，不影響匯入本身。
    }
    const unknownCramNames = new Set<string>();

    const venues = await venueService.findAll();
    const venueByName = new Map<string, any>();
    for (const v of venues) {
      for (const n of [v.name, v.shortName]) {
        const k = String(n || "").trim();
        if (k && !venueByName.has(k)) venueByName.set(k, v);
      }
    }

    const inserted: any[] = [];
    const updated: any[] = [];
    const coachKept: any[] = [];
    const skipped: { row: any; reason: string }[] = [];
    const unmatchedCoaches = new Set<string>();

    // 第一段：逐列檢查、組好要寫的值。格式有問題的列記進 skipped，不擋其他列。
    const planned: InsertManualScheduleCourse[] = [];
    for (const raw of rows) {
      try {
        const cram = String(raw?.cramName ?? "").trim();
        const sport = String(raw?.sportType ?? "").trim();
        if (!cram) { skipped.push({ row: raw, reason: "缺補習班名稱" }); continue; }
        // 項目類別空白＝游泳。場館端的規則：有球類就打球類，沒寫就是游泳。
        const courseName = `${cram}-${sport || "游泳"}`;
        if (!cramList.some((c) => c && courseName.indexOf(String(c).trim()) === 0)) {
          unknownCramNames.add(cram);
        }

        const date = normalizeDate(raw?.date);
        const startTime = normalizeTime(raw?.startTime, "startTime");
        const endTime = normalizeTime(raw?.endTime, "endTime");
        if (startTime >= endTime) { skipped.push({ row: raw, reason: "結束時間不晚於開始時間" }); continue; }

        const week = SUMMER_WEEKS.find((w) => date >= w.startDate && date <= w.endDate);
        if (!week) { skipped.push({ row: raw, reason: `日期 ${date} 不在暑假 9 週範圍內` }); continue; }

        const venueRaw = String(raw?.venueName ?? "").trim();
        const venue = venueRaw ? venueByName.get(venueRaw) : undefined;
        if (venueRaw && !venue) { skipped.push({ row: raw, reason: `對不到場館「${venueRaw}」` }); continue; }

        // 教練：試算表的「排班人員」可能是多人。目前資料表只放得下一位，
        // 多的先記在 note，等班表頁支援多教練再處理。
        const coachNames: string[] = Array.isArray(raw?.coachNames)
          ? raw.coachNames.map((s: any) => String(s || "").trim()).filter(Boolean)
          : String(raw?.coachNames ?? "").split(/[、,，;；\s]+/).map((s) => s.trim()).filter(Boolean);
        const matched = coachNames.map((n) => ({ n, e: empByName.get(n) }));
        matched.filter((m) => !m.e).forEach((m) => unmatchedCoaches.add(m.n));
        const firstMatched = matched.find((m) => m.e)?.e;

        const noteParts: string[] = [];
        if (coachNames.length > 1) noteParts.push(`排班人員：${coachNames.join("、")}`);
        if (raw?.note) noteParts.push(String(raw.note).trim());

        planned.push({
          weekNo: week.no,
          date,
          venueId: venue ? venue.id : normalizeManualCourseVenueId(raw?.venueId),
          venueName: venue ? venue.name : (raw?.venueName ?? null),
          courseName,
          startTime,
          endTime,
          registeredCount: normalizeNonNegativeInt(raw?.registeredCount),
          requiredCoaches: normalizeNonNegativeInt(raw?.requiredCoaches ?? 1),
          employeeId: firstMatched ? firstMatched.id : null,
          employeeName: firstMatched ? firstMatched.name : (coachNames[0] || null),
          note: noteParts.join("｜") || null,
          status: "active",
        });
      } catch (e: any) {
        skipped.push({ row: raw, reason: e?.message || String(e) });
      }
    }

    // 第二段：在全域匯入鎖裡查與寫，整批一個交易。寫入失敗就整批回滾、往外丟，不當成單列略過。
    await withTx(async (tx) => {
      await lockXact(tx, LOCK_NS.cramImport, 0);
      for (const values of planned) {
        const { date, courseName, startTime, endTime } = values;
        const existing = await summerScheduleRepository.findActiveCourseInSlot({ date, courseName, startTime, endTime }, tx);
        if (existing) {
          const hasCoach = existing.employeeId != null || String(existing.employeeName ?? "").trim() !== "";
          const { employeeId, employeeName, ...rest } = values;
          if (hasCoach && ((employeeId ?? null) !== existing.employeeId || (employeeName ?? null) !== existing.employeeName)) {
            coachKept.push({ id: existing.id, date, courseName, startTime, endTime });
          }
          if (!dryRun) await summerScheduleRepository.updateManualCourse(existing.id, hasCoach ? rest : values, tx);
          updated.push({ id: existing.id, date, courseName, startTime, endTime });
        } else {
          if (!dryRun) await summerScheduleRepository.createManualCourses([values], tx);
          inserted.push({ date, courseName, startTime, endTime });
        }
      }
    });

    return {
      dryRun,
      insertedCount: inserted.length,
      updatedCount: updated.length,
      skippedCount: skipped.length,
      inserted,
      updated,
      skipped,
      // 已有教練、匯入沒有覆寫的課（教練以後台為準）。試算表的教練跟後台不同時要人看一下。
      coachKept,
      // 對不到名冊的教練姓名。不是錯誤，但要讓人看得見 —— 靜默忽略就會有人領不到錢。
      unmatchedCoaches: Array.from(unmatchedCoaches),
      // 不在薪資頁「補習班名單」裡的補習班。球類的課會被算成 1.5h 而不是 1h，
      // 也就是每堂多算 0.5 小時的錢。要在薪資頁把它們加進名單。
      unknownCramNames: Array.from(unknownCramNames),
    };
  },

  /**
   * Publish the week's stored draft (plus its manual courses) to the employees' shifts. Only the
   * stored draft is published; shifts sent in the request are ignored, so what employees see is
   * always what was saved. Runs under the week's lock, so two clicks publish one copy.
   */
  async publishShifts(payload: any) {
    const weekNo = normalizeWeekNo(payload?.weekNo);
    const week = SUMMER_WEEKS.find((w) => w.no === weekNo);
    if (!week) throw httpError(400, "weekNo 只允許 1-9");
    if (Array.isArray(payload?.shifts) && payload.shifts.length > 0) {
      console.warn(`[summer publish] 第 ${weekNo} 週請求帶了 shifts，已忽略；發布以伺服器已儲存的草稿為準`);
    }

    // 已離職的員工不擋（見 PublishRefs），所以名冊與場館在交易外讀一次即可。
    const [employees, venueRows] = await Promise.all([employeeService.getAllEmployees(), venueService.findAll()]);
    const refs: PublishRefs = { employeeIds: new Set(employees.map((e) => e.id)), venueIds: new Set(venueRows.map((v) => v.id)) };

    return withTx(async (tx) => {
      await lockXact(tx, LOCK_NS.summerWeek, weekNo);
      const draft = await summerScheduleRepository.getDraft(weekNo, tx);
      const stored = Array.isArray(draft?.shiftEntries) ? (draft!.shiftEntries as any[]) : [];
      const rawEntries = Array.isArray(draft?.rawEntries) ? (draft!.rawEntries as any[]) : [];
      const manualCourses = await summerScheduleRepository.getActiveManualCourses(weekNo, tx);
      const incoming = mergeShiftEntries(stored, buildManualCourseShiftEntries(manualCourses, rawEntries, weekNo));
      return applyPublish(tx, week, weekNo, incoming, refs);
    });
  },

  async getPublishedDutyShifts(weekNo: number) {
    const week = SUMMER_WEEKS.find((w) => w.no === weekNo);
    if (!week) return { items: [] };

    // 改為直接抓正式後台班表 shifts，不再只抓「暑假排班v40」發布資料。
    const rows = await db.select().from(shifts).where(
      and(
        gte(shifts.date, week.startDate),
        lte(shifts.date, week.endDate),
        eq(shifts.status, "active")
      )
    );

    const employees = await employeeService.getAllEmployees();
    const empMap = new Map(employees.map((e) => [e.id, e.name]));

    const venues = await venueService.findAll();
    const venueMap = new Map(venues.map((v) => [v.id, v]));

    function resolveDutyRoleKind(role?: string | null, notes?: string | null) {
      const text = `${role || ""} ${notes || ""}`;

      if (
        text.includes("救生") ||
        text.includes("守望") ||
        text.toLowerCase().includes("lifeguard")
      ) {
        return "lifeguard";
      }

      if (
        text.includes("櫃台") ||
        text.includes("櫃檯") ||
        text.includes("櫃臺") ||
        text.toLowerCase().includes("frontdesk") ||
        text.toLowerCase().includes("counter")
      ) {
        return "frontdesk";
      }

      return null;
    }

    const items = rows
      .map((s) => {
        const roleKind = resolveDutyRoleKind(s.role, s.notes);
        if (!roleKind) return null;

        return {
          id: s.id,
          employeeId: s.employeeId,
          employeeName: empMap.get(s.employeeId) ?? "未知",
          venueId: s.venueId,
          venueName: venueMap.get(s.venueId)?.name ?? venueMap.get(s.venueId)?.shortName ?? "未知",
          date: s.date,
          startTime: s.startTime,
          endTime: s.endTime,
          role: s.role,
          roleKind,
          notes: s.notes ?? "",
        };
      })
      .filter(Boolean);

    // 合併派遣人員班次（下方表格「派遣人員」）
    const dispRows = await db.select().from(dispatchShifts).where(
      and(
        gte(dispatchShifts.date, week.startDate),
        lte(dispatchShifts.date, week.endDate),
        ne(dispatchShifts.status, "cancelled")
      )
    );
    dispRows.forEach((d) => {
      const roleKind = resolveDutyRoleKind(d.role, d.notes);
      if (!roleKind) return;
      const name = d.dispatchName || "未知派遣";
      items.push({
        id: `dispatch-${d.id}`,
        employeeId: d.linkedEmployeeId ?? null,
        employeeName: name,
        venueId: d.venueId ?? null,
        venueName: venueMap.get(d.venueId ?? -1)?.name ?? venueMap.get(d.venueId ?? -1)?.shortName ?? "未知",
        date: d.date,
        startTime: d.startTime,
        endTime: d.endTime,
        role: d.role,
        roleKind,
        notes: d.notes ?? "",
      } as any);
    });

    return { items };
  },

  async getMySummerShifts(weekNo: number, lineId: string) {
    const week = SUMMER_WEEKS.find((w) => w.no === weekNo);
    if (!week) throw httpError(400, "weekNo 只允許 1-9");

    const employee = await employeeService.getEmployeeByLineId(lineId);
    if (!employee) throw httpError(404, "找不到此 LINE 帳號對應的員工資料");

    const empShifts = await shiftService.getShiftsByEmployeeAndDateRange(employee.id, week.startDate, week.endDate);
    const summerShifts = empShifts.filter(
      (s) =>
        s.notes?.includes("暑假排班v40") &&
        s.status === "active" &&
        !s.notes.includes("暑假救生排班") &&
        !s.notes.includes("暑假櫃台排班")
    );

    const venues = await venueService.findAll();
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
