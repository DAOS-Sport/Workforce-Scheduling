// A fake /api/admin/schedule-assignments backend with per-request delays, driven by whatever clock the target uses.
// A POST is committed when its response is delivered (send time + delay), the same way the issue #9 harness modelled it.
// Response shapes follow server/modules/summerSchedule/summerSchedule.routes.ts: GET returns the draft object,
// POST returns { success, updatedAt }, the blank guard answers 409 { message }.
import type { RawEntry } from '../../types';

export interface ServerClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
}

export interface StoredWeek {
  rawEntries: RawEntry[];
  assignments: unknown[];
  shifts: unknown[];
  updatedAt: string | null;
}

export interface FakeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface PostRecord {
  no: number;
  sentAt: number;
  weekNo: number;
  keys: string[];
  cells: Record<string, string>;
  body: Record<string, unknown>;
}

const SCHEDULE_URL = '/api/admin/schedule-assignments';
const PUBLISH_URL = '/api/admin/summer-schedule/publish-shifts';

function reply(status: number, body: unknown): FakeResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

export function cellsOf(entries: readonly RawEntry[]): Record<string, string> {
  const out: Record<string, string> = {};
  entries.forEach(e => {
    out[e.key] = e.value;
  });
  return out;
}

export class FakeScheduleServer {
  readonly weeks = new Map<number, StoredWeek>();
  readonly log: string[] = [];
  readonly posts: PostRecord[] = [];
  readonly publishes: { sentAt: number; weekNo: number }[] = [];
  getDelay: (no: number) => number = () => 100;
  postDelay: (no: number) => number = () => 300;
  postStatus: (no: number) => number = () => 200;
  private getCount = 0;
  private postCount = 0;
  private t0: number;

  constructor(private readonly clock: ServerClock) {
    this.t0 = clock.now();
  }

  /** Scenario time zero; log lines are relative to it. */
  startAt(t0: number): void {
    this.t0 = t0;
  }

  rel(): number {
    return this.clock.now() - this.t0;
  }

  seed(weekNo: number, cells: Record<string, string>, updatedAt: string): void {
    this.weeks.set(weekNo, {
      rawEntries: Object.entries(cells).map(([key, value]) => ({ key, value, employees: [] })),
      assignments: [],
      shifts: [],
      updatedAt,
    });
  }

  cells(weekNo: number): Record<string, string> {
    return cellsOf(this.weeks.get(weekNo)?.rawEntries ?? []);
  }

  private snapshotGet(weekNo: number) {
    const w = this.weeks.get(weekNo);
    if (!w) return { version: 'v40', weekNo, rawEntries: [], assignments: [], shifts: [] };
    return { version: 'v40', weekNo, updatedAt: w.updatedAt, rawEntries: w.rawEntries, assignments: w.assignments, shifts: w.shifts };
  }

  handles(url: string): boolean {
    return url.startsWith(SCHEDULE_URL) || url.startsWith(PUBLISH_URL);
  }

  fetch = (url: string, init: { method?: string; body?: unknown } = {}): Promise<FakeResponse> => {
    const method = String(init.method || 'GET').toUpperCase();
    return new Promise(resolve => {
      if (url.startsWith(PUBLISH_URL)) {
        const body = JSON.parse(String(init.body || '{}')) as { weekNo: number };
        this.publishes.push({ sentAt: this.rel(), weekNo: Number(body.weekNo) });
        this.log.push(`t=${this.rel()}ms PUBLISH sent week=${body.weekNo}`);
        this.clock.setTimeout(() => resolve(reply(200, { success: true, inserted: 0 })), 0);
        return;
      }
      if (method === 'GET') {
        const no = ++this.getCount;
        const weekNo = Number(/[?&]weekNo=(\d+)/.exec(url)?.[1] || 1);
        const sentAt = this.rel();
        const delay = this.getDelay(no);
        this.log.push(`t=${sentAt}ms GET#${no} sent week=${weekNo} (returns at +${delay}ms)`);
        this.clock.setTimeout(() => {
          this.log.push(`t=${this.rel()}ms GET#${no} (sent t=${sentAt}ms) returned`);
          resolve(reply(200, JSON.parse(JSON.stringify(this.snapshotGet(weekNo)))));
        }, delay);
        return;
      }
      const no = ++this.postCount;
      const body = JSON.parse(String(init.body || '{}')) as Record<string, unknown>;
      const weekNo = Number(body.weekNo);
      const rawEntries = (Array.isArray(body.rawEntries) ? body.rawEntries : []) as RawEntry[];
      const cells = cellsOf(rawEntries);
      const record: PostRecord = { no, sentAt: this.rel(), weekNo, keys: Object.keys(cells), cells, body };
      this.posts.push(record);
      const delay = this.postDelay(no);
      const status = this.postStatus(no);
      this.log.push(`t=${record.sentAt}ms POST#${no} sent week=${weekNo} cells=${describeCells(cells)} (returns at +${delay}ms${status === 200 ? '' : `, status ${status}`})`);
      this.clock.setTimeout(() => {
        if (status === 409) {
          this.log.push(`t=${this.rel()}ms POST#${no} returned 409`);
          resolve(reply(409, { message: '保護：空白班表不覆蓋既有排班資料' }));
          return;
        }
        if (status !== 200) {
          this.log.push(`t=${this.rel()}ms POST#${no} returned ${status}`);
          resolve(reply(status, { message: `status ${status}` }));
          return;
        }
        const updatedAt = new Date(this.clock.now()).toISOString();
        this.weeks.set(weekNo, {
          rawEntries: JSON.parse(JSON.stringify(rawEntries)),
          assignments: Array.isArray(body.assignments) ? body.assignments : [],
          shifts: Array.isArray(body.shifts) ? body.shifts : [],
          updatedAt,
        });
        this.log.push(`t=${this.rel()}ms POST#${no} returned`);
        resolve(reply(200, { success: true, updatedAt }));
      }, delay);
    });
  };
}

/** Scenario keys are long cell keys; logs print the short label the contract used (X, Y, Z). */
const LABELS = new Map<string, string>();
export function labelKey(key: string, label: string): string {
  LABELS.set(key, label);
  return key;
}
export function short(key: string): string {
  return LABELS.get(key) ?? key;
}

/** Labelled cells by name; other non-empty cells (derived enroll / needed counts and the like) only as a count. */
export function describeCells(cells: Record<string, string>): string {
  const named = Object.entries(cells).filter(([k]) => LABELS.has(k));
  const others = Object.entries(cells).filter(([k, v]) => !LABELS.has(k) && v !== '').length;
  return JSON.stringify(named.map(([k, v]) => `${short(k)}=${v}`)) + (others ? ` +${others} other non-empty cells` : '');
}
