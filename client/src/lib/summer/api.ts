// Draft read, draft save and publish calls of the summer schedule page (E04, E05, E11).
// The loose response unwrapping of R005 lives only here; callers get typed results.
// The save body is the payload.ts object serialized as is: the server reads version, weekNo, rawEntries, assignments
// and shifts from it, so nothing is added or renamed on the way out.
import { unwrapApiPayload } from './api-shape';
import { draftFromRawEntries, rawEntriesFromDraft, type ServerDraftShape } from './payload';
import type { Draft, SaveSchedulePayload, WeekNo } from './types';

export const SCHEDULE_ASSIGNMENTS_URL = '/api/admin/schedule-assignments';
export const PUBLISH_SHIFTS_URL = '/api/admin/summer-schedule/publish-shifts';

export interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  credentials?: 'include';
  body?: string;
}

export interface ResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (url: string, init?: FetchInit) => Promise<ResponseLike>;

const browserFetch: FetchLike = (url, init) => fetch(url, init);

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
const arrayOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const nonEmptyString = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export interface RemoteDraft {
  weekNo: WeekNo;
  /** Server write time of this copy; null for a week that was never saved. */
  updatedAt: string | null;
  draft: Draft;
  /** What the server holds, for the blank guard (R097). */
  shape: ServerDraftShape & { rawEntries: ReturnType<typeof rawEntriesFromDraft> };
}

/** E04 response: `rawEntries` (or the older `entries`), `assignments`, `shifts` (or `shiftEntries`), `updatedAt`. */
export function parseRemoteDraft(json: unknown, weekNo: WeekNo): RemoteDraft {
  const raw = unwrapApiPayload(json);
  const body = isObject(raw) ? raw : {};
  const entries = Array.isArray(body.rawEntries) ? body.rawEntries : arrayOf(body.entries);
  const draft = draftFromRawEntries(entries.filter(isObject));
  return {
    weekNo,
    updatedAt: nonEmptyString(body.updatedAt),
    draft,
    shape: { rawEntries: rawEntriesFromDraft(draft), assignments: arrayOf(body.assignments), shifts: arrayOf(body.shifts), shiftEntries: arrayOf(body.shiftEntries) },
  };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** E04: GET /api/admin/schedule-assignments?weekNo=N. Throws on a non-2xx answer or a network failure. */
export async function fetchScheduleDraft(weekNo: WeekNo, fetchImpl: FetchLike = browserFetch): Promise<RemoteDraft> {
  const res = await fetchImpl(`${SCHEDULE_ASSIGNMENTS_URL}?weekNo=${weekNo}`, { credentials: 'include' });
  if (!res.ok) throw new ApiError(res.status, `schedule assignment API status ${res.status}`);
  return parseRemoteDraft(await res.json(), weekNo);
}

export interface SaveFailure {
  ok: false;
  /** conflict = 409 (blank guard now, version check after #14): stop and ask for a reload. Others are retried. */
  kind: 'conflict' | 'http' | 'network';
  status: number | null;
  message: string;
}

export type SaveResult = { ok: true; updatedAt: string | null } | SaveFailure;

const jsonOrNull = (res: ResponseLike) => res.json().catch(() => null);

/** E05: POST /api/admin/schedule-assignments. Never throws. */
export async function saveScheduleDraft(payload: SaveSchedulePayload, fetchImpl: FetchLike = browserFetch): Promise<SaveResult> {
  let res: ResponseLike;
  try {
    res = await fetchImpl(SCHEDULE_ASSIGNMENTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return { ok: false, kind: 'network', status: null, message: String(err) };
  }
  const body = unwrapApiPayload(await jsonOrNull(res));
  if (!res.ok) {
    const message = (isObject(body) && nonEmptyString(body.message)) || `API status ${res.status}`;
    return { ok: false, kind: res.status === 409 ? 'conflict' : 'http', status: res.status, message };
  }
  return { ok: true, updatedAt: isObject(body) ? nonEmptyString(body.updatedAt) : null };
}

export interface PublishResult {
  ok: boolean;
  status: number | null;
  inserted: number | null;
  message: string;
}

/** E11: POST /api/admin/summer-schedule/publish-shifts with { weekNo, generatedAt }; the server publishes what it stored. */
export async function publishShifts(weekNo: WeekNo, generatedAt: Date, fetchImpl: FetchLike = browserFetch): Promise<PublishResult> {
  let res: ResponseLike;
  try {
    res = await fetchImpl(PUBLISH_SHIFTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ weekNo, generatedAt: generatedAt.toISOString() }),
    });
  } catch (err) {
    return { ok: false, status: null, inserted: null, message: String(err) };
  }
  const body = unwrapApiPayload(await jsonOrNull(res));
  const result = isObject(body) ? body : {};
  if (!res.ok || result.success !== true) {
    return { ok: false, status: res.status, inserted: null, message: nonEmptyString(result.message) ?? `API status ${res.status}` };
  }
  return { ok: true, status: res.status, inserted: typeof result.inserted === 'number' ? result.inserted : null, message: '' };
}

export interface ScheduleApi {
  load(weekNo: WeekNo): Promise<RemoteDraft>;
  save(payload: SaveSchedulePayload): Promise<SaveResult>;
  publish(weekNo: WeekNo, generatedAt: Date): Promise<PublishResult>;
}

export function createScheduleApi(fetchImpl: FetchLike = browserFetch): ScheduleApi {
  return {
    load: weekNo => fetchScheduleDraft(weekNo, fetchImpl),
    save: payload => saveScheduleDraft(payload, fetchImpl),
    publish: (weekNo, generatedAt) => publishShifts(weekNo, generatedAt, fetchImpl),
  };
}
