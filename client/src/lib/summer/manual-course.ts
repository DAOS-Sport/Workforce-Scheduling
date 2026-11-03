import { manualCourseIdFromCoachKey } from './cell-key';
import { parseManualDates, weekNoForDate } from './dates';
import { venueIdByName } from './parse';
import type { Employee, EmployeeId, IsoDate, ManualCourse, VenueConfig, VenueName, WeekConfig } from './types';

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const idOf = (v: unknown): EmployeeId | '' => (typeof v === 'number' || typeof v === 'string' ? v : '');

export function normalizeManualCourse(r: Record<string, unknown>, fallbackWeekNo: number): ManualCourse {
  const course: ManualCourse = {
    id: idOf(r.id),
    source: 'manual',
    date: str(r.date),
    weekNo: Number(r.weekNo) || Number(fallbackWeekNo) || 0,
    venueId: idOf(r.venueId) || '',
    venueName: str(r.venueName) || str(r.venue) || '',
    courseName: str(r.courseName) || '',
    startTime: str(r.startTime) || '',
    endTime: str(r.endTime) || '',
    registeredCount: Number(r.registeredCount) || 0,
    requiredCoaches: Number(r.requiredCoaches) || 0,
    note: str(r.note) || '',
    updatedAt: str(r.updatedAt) || '',
  };
  const employeeId = idOf(r.employeeId);
  if (employeeId !== '') {
    course.employeeId = employeeId;
    course.employeeName = str(r.employeeName);
  }
  return course;
}

export function manualCourseSignature(courses: readonly ManualCourse[], weekNo: number): string {
  return JSON.stringify(
    courses
      .filter(r => Number(r.weekNo) === Number(weekNo))
      .map(r => ({
        id: String(r.id),
        date: r.date,
        venueId: String(r.venueId || ''),
        venueName: r.venueName || '',
        courseName: r.courseName || '',
        startTime: r.startTime || '',
        endTime: r.endTime || '',
        registeredCount: Number(r.registeredCount) || 0,
        requiredCoaches: Number(r.requiredCoaches) || 0,
        note: r.note || '',
      }))
      .sort((a, b) => (a.date + a.startTime + a.id).localeCompare(b.date + b.startTime + b.id)),
  );
}

export function dedupeManualCourses(courses: readonly ManualCourse[]): ManualCourse[] {
  const seen = new Set<string>();
  return courses.filter(r => {
    const k = `${String(r.id || '')}|${String(r.date || '')}|${String(r.courseName || '')}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function manualCoursesForVenue(courses: readonly ManualCourse[], venue: VenueConfig, week: WeekConfig): ManualCourse[] {
  const vId = String(venue.venueId || venueIdByName(venue.name) || '');
  return courses
    .filter(r => Number(r.weekNo) === Number(week.no) && (r.venueName ? r.venueName === venue.name : !!vId && String(r.venueId || '') === vId))
    .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
}

export interface ManualCourseForm {
  dates: string;
  courseName: string;
  startTime: string;
  endTime: string;
  registeredCount: string;
  requiredCoaches: string;
  note: string;
}

export const EMPTY_MANUAL_FORM: ManualCourseForm = {
  dates: '',
  courseName: '',
  startTime: '16:00',
  endTime: '17:00',
  registeredCount: '4',
  requiredCoaches: '1',
  note: '',
};

export function formAfterAdd(form: ManualCourseForm): ManualCourseForm {
  return { ...form, dates: '', courseName: '', note: '' };
}

export interface NewManualCourse {
  source: 'manual';
  date: IsoDate;
  weekNo: number;
  venueId: number | '';
  venueName: VenueName;
  courseName: string;
  startTime: string;
  endTime: string;
  registeredCount: number;
  requiredCoaches: number;
  note: string;
  createdAt: string;
}

export type ManualCourseFormResult = { ok: true; items: NewManualCourse[] } | { ok: false; message: string };

export function validateManualCourseForm(form: ManualCourseForm, venueName: VenueName, week: WeekConfig, now: Date): ManualCourseFormResult {
  const dates = parseManualDates(form.dates, Number(week.start.slice(0, 4)));
  const courseName = form.courseName.trim();
  const { startTime, endTime } = form;
  if (!dates.length) return { ok: false, message: '請輸入日期，例如 07/06、07/13、07/20' };
  if (!courseName) return { ok: false, message: '請輸入課程名稱' };
  if (!startTime || !endTime) return { ok: false, message: '請輸入開始與結束時間' };
  if (startTime >= endTime) return { ok: false, message: `結束時間（${endTime}）必須晚於開始時間（${startTime}），請重新確認` };
  return {
    ok: true,
    items: dates.map(date => ({
      source: 'manual',
      date,
      weekNo: weekNoForDate(date) ?? 0,
      venueId: venueIdByName(venueName),
      venueName,
      courseName,
      startTime,
      endTime,
      registeredCount: Number(form.registeredCount || 0),
      requiredCoaches: Number(form.requiredCoaches || 0),
      note: form.note.trim(),
      createdAt: now.toISOString(),
    })),
  };
}

export function otherWeeksNotice(created: readonly { weekNo: number }[], currentWeek: number): string | null {
  const weeks = new Set(created.map(r => Number(r.weekNo)));
  if (!weeks.size || weeks.has(Number(currentWeek))) return null;
  const list = [...weeks].sort((a, b) => a - b).join('、第');
  return `已新增 ${created.length} 筆手動課程，分別排在第${list}週（目前檢視第 ${currentWeek} 週）。請切換週次即可看到。`;
}

export const MANUAL_COURSE_MESSAGES = {
  createFailed: '手動課程新增失敗，資料沒有同步到伺服器。請確認登入狀態與網路後再試一次。',
  deleteConfirm: '刪除這筆手動課程？',
  deleteFailed: '手動課程刪除失敗，伺服器資料沒有變更。請確認登入狀態與網路後再試一次。',
  empty: '本週尚未新增手動課程。',
} as const;

export type ManualEditableField = 'courseName' | 'registeredCount' | 'requiredCoaches' | 'note';

export function applyManualField(course: ManualCourse, field: ManualEditableField, value: string): ManualCourse {
  if (field === 'registeredCount' || field === 'requiredCoaches') {
    return { ...course, [field]: Number.parseInt(String(value || '').trim(), 10) || 0 };
  }
  return { ...course, [field]: String(value || '').trim() };
}

export function canPatchManualCourse(id: number | string): boolean {
  return /^\d+$/.test(String(id));
}

export function manualCoachSelection(course: ManualCourse | undefined, key: string, emp: Employee): ManualCourse | null {
  const id = manualCourseIdFromCoachKey(key);
  if (!id || !course || String(course.id) !== id) return null;
  if (String(course.employeeId || '') === String(emp.id) && String(course.employeeName || '') === String(emp.name || '')) return null;
  return { ...course, employeeId: emp.id, employeeName: emp.name };
}
