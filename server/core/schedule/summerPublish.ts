/**
 * 暑假班表發布前的整批檢查（GitHub #8）：任一筆不合格就整批不發布，員工現有班表不動。
 * 回報只帶列號與問題代碼，不帶姓名。
 */

export const PUBLISH_PROBLEMS = {
  missing_field: "缺少員工、場館、日期或時間",
  unknown_employee: "找不到員工",
  unknown_venue: "找不到場館",
  outside_week: "日期不在本週",
  bad_time: "時間格式錯誤",
  zero_length: "上下班時間相同",
} as const;

export type PublishProblemCode = keyof typeof PUBLISH_PROBLEMS;

export interface PublishProblem {
  index: number;
  code: PublishProblemCode;
}

/**
 * 已離職的員工不擋：過去的週裡本來就有後來離職的人，重新發布要能照原樣寫回。
 */
export interface PublishRefs {
  employeeIds: ReadonlySet<number>;
  venueIds: ReadonlySet<number>;
}

export interface PlannedShift {
  employeeId: number;
  venueId: number;
  date: string;
  startTime: string;
  endTime: string;
  role: string;
  notes: string;
}

export type PublishPlan = { ok: true; shifts: PlannedShift[] } | { ok: false; problems: PublishProblem[] };

const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

const isCalendarDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

function problemOf(e: any, week: { startDate: string; endDate: string }, refs: PublishRefs): PublishProblemCode | null {
  if (!e || !e.employeeId || !e.venueId || !e.date || !e.startTime || !e.endTime) return "missing_field";
  if (!refs.employeeIds.has(Number(e.employeeId))) return "unknown_employee";
  if (!refs.venueIds.has(Number(e.venueId))) return "unknown_venue";
  const date = String(e.date);
  if (!isCalendarDate(date) || date < week.startDate || date > week.endDate) return "outside_week";
  const start = String(e.startTime);
  const end = String(e.endTime);
  if (!TIME.test(start) || !TIME.test(end)) return "bad_time";
  // 結束早於開始是跨午夜班（與勞基法檢查一致），只有相同時間才算無效。
  if (start.slice(0, 5) === end.slice(0, 5)) return "zero_length";
  return null;
}

export function planSummerPublish(entries: any[], week: { startDate: string; endDate: string }, weekNo: number, refs: PublishRefs): PublishPlan {
  const problems: PublishProblem[] = [];
  entries.forEach((e, index) => {
    const code = problemOf(e, week, refs);
    if (code) problems.push({ index, code });
  });
  if (problems.length > 0) return { ok: false, problems };
  const noteTag = `暑假排班v40｜weekNo=${weekNo}`;
  return {
    ok: true,
    shifts: entries.map((e) => ({
      employeeId: Number(e.employeeId),
      venueId: Number(e.venueId),
      date: String(e.date),
      startTime: String(e.startTime),
      endTime: String(e.endTime),
      role: e.role || "教練",
      notes: e.notes ? `${e.notes}｜${noteTag}` : noteTag,
    })),
  };
}

/** 「找不到員工 2 筆、日期不在本週 1 筆」 */
export function describeProblems(problems: PublishProblem[]): string {
  const counts = new Map<PublishProblemCode, number>();
  for (const p of problems) counts.set(p.code, (counts.get(p.code) ?? 0) + 1);
  return Array.from(counts, ([code, n]) => `${PUBLISH_PROBLEMS[code]} ${n} 筆`).join("、");
}

/** A shift already published for the week, as far as the diff needs it. */
export interface PublishedShift {
  id: number;
  employeeId: number;
  venueId: number;
  date: string;
  startTime: string;
  endTime: string;
  role: string;
  notes: string | null;
}

export interface WeekDiff<S extends PublishedShift> {
  /** Published shifts that match a planned one exactly; they stay as they are, same id. */
  unchanged: S[];
  /** Published shifts no planned one matches; they are cancelled. */
  cancel: S[];
  /** Planned shifts no published one matches; they are added. */
  create: PlannedShift[];
}

/** `09:00` and `09:00:00` are the same time. */
const fullTime = (t: string) => (t.length === 5 ? `${t}:00` : t);

const shiftKey = (s: Omit<PlannedShift, "notes"> & { notes: string | null }) =>
  [s.employeeId, s.venueId, s.date, fullTime(s.startTime), fullTime(s.endTime), s.role, s.notes ?? ""].join("|");

/**
 * Compare the week as published with the plan, so republishing touches only what changed: an exact
 * match keeps its shift (and id), everything else published is cancelled, everything else planned
 * is added. Two identical planned rows need two published rows to both count as unchanged.
 */
export function diffSummerWeek<S extends PublishedShift>(published: S[], planned: PlannedShift[]): WeekDiff<S> {
  const waiting = new Map<string, S[]>();
  for (const s of [...published].sort((a, b) => a.id - b.id)) {
    const key = shiftKey(s);
    waiting.set(key, [...(waiting.get(key) ?? []), s]);
  }
  const unchanged: S[] = [];
  const create: PlannedShift[] = [];
  for (const p of planned) {
    const match = waiting.get(shiftKey(p))?.shift();
    if (match) unchanged.push(match);
    else create.push(p);
  }
  const cancel = Array.from(waiting.values()).flat();
  return { unchanged, cancel, create };
}
