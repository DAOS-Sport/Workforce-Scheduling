import { describe, expect, it } from 'vitest';
import { createScheduleApi, fetchScheduleDraft, parseRemoteDraft, publishShifts, saveScheduleDraft, type FetchLike } from '../api';
import type { SaveSchedulePayload } from '../types';

interface Call {
  url: string;
  init: Parameters<FetchLike>[1];
}

function fakeFetch(status: number, body: unknown, calls: Call[] = []): FetchLike {
  return async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
}

const PAYLOAD: SaveSchedulePayload = {
  version: 'v40',
  weekNo: 2,
  generatedAt: '2026-07-06T06:05:00.000Z',
  rawEntries: [{ key: 'w2-新北高中-lifeguard-dutygrid-r1-d1', value: '王偉 08:00-12:00', employees: [] }],
  assignments: [],
  shifts: [],
};

describe('draft read (E04, R005, R113)', () => {
  it('reads the plain object the server returns', () => {
    const remote = parseRemoteDraft(
      { version: 'v40', weekNo: 2, updatedAt: '2026-07-06T06:00:00.000Z', rawEntries: [{ key: 'w2-a', value: '王偉', employees: [{ employeeId: 9 }] }], assignments: [{}], shifts: [] },
      2,
    );
    expect(remote.weekNo).toBe(2);
    expect(remote.updatedAt).toBe('2026-07-06T06:00:00.000Z');
    expect(remote.draft.cells.get('w2-a')).toBe('王偉');
    expect(remote.draft.meta.get('w2-a')).toEqual([{ employeeId: 9 }]);
    expect(remote.shape.assignments).toHaveLength(1);
  });

  it('unwraps { data }, falls back to entries and shiftEntries, and treats a missing updatedAt as null (E04, R005)', () => {
    const remote = parseRemoteDraft({ data: { entries: [{ key: 'w1-x', value: null }, { value: 'no key' }], shiftEntries: [{}] } }, 1);
    expect(remote.updatedAt).toBeNull();
    expect([...remote.draft.cells]).toEqual([['w1-x', '']]);
    expect(remote.shape.shiftEntries).toHaveLength(1);
    expect(remote.shape.rawEntries).toEqual([{ key: 'w1-x', value: '', employees: [] }]);
  });

  it('an empty week reads as an empty draft (E04)', () => {
    const remote = parseRemoteDraft({ version: 'v40', weekNo: 3, rawEntries: [], assignments: [], shifts: [] }, 3);
    expect(remote.draft.cells.size).toBe(0);
    expect(remote.updatedAt).toBeNull();
    expect(parseRemoteDraft(null, 3).draft.cells.size).toBe(0);
  });

  it('GETs the week with the session cookie and throws on a non-2xx answer (E04)', async () => {
    const calls: Call[] = [];
    await fetchScheduleDraft(3, fakeFetch(200, { rawEntries: [] }, calls));
    expect(calls).toEqual([{ url: '/api/admin/schedule-assignments?weekNo=3', init: { credentials: 'include' } }]);
    await expect(fetchScheduleDraft(3, fakeFetch(500, {}))).rejects.toThrow('schedule assignment API status 500');
  });
});

describe('draft save (E05, R099)', () => {
  it('POSTs the payload byte for byte as JSON with the session cookie', async () => {
    const calls: Call[] = [];
    const result = await saveScheduleDraft(PAYLOAD, fakeFetch(200, { success: true, updatedAt: '2026-07-06T06:05:00.000Z' }, calls));
    expect(result).toEqual({ ok: true, updatedAt: '2026-07-06T06:05:00.000Z' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/admin/schedule-assignments');
    expect(calls[0].init).toEqual({ method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(PAYLOAD) });
  });

  it('reads updatedAt from a wrapped answer and reports null when there is none (R099)', async () => {
    expect(await saveScheduleDraft(PAYLOAD, fakeFetch(200, { data: { success: true, updatedAt: '2026-07-06T06:05:00.000Z' } }))).toEqual({ ok: true, updatedAt: '2026-07-06T06:05:00.000Z' });
    expect(await saveScheduleDraft(PAYLOAD, fakeFetch(200, { success: true }))).toEqual({ ok: true, updatedAt: null });
    expect(await saveScheduleDraft(PAYLOAD, fakeFetch(200, null))).toEqual({ ok: true, updatedAt: null });
  });

  it('409 is a conflict carrying the server message; other failures are retryable (E05)', async () => {
    expect(await saveScheduleDraft(PAYLOAD, fakeFetch(409, { message: '保護：空白班表不覆蓋既有排班資料' }))).toEqual({
      ok: false,
      kind: 'conflict',
      status: 409,
      message: '保護：空白班表不覆蓋既有排班資料',
    });
    expect(await saveScheduleDraft(PAYLOAD, fakeFetch(500, { message: 'boom' }))).toEqual({ ok: false, kind: 'http', status: 500, message: 'boom' });
    expect(await saveScheduleDraft(PAYLOAD, fakeFetch(401, null))).toEqual({ ok: false, kind: 'http', status: 401, message: 'API status 401' });
    const offline: FetchLike = async () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await saveScheduleDraft(PAYLOAD, offline)).toEqual({ ok: false, kind: 'network', status: null, message: 'TypeError: Failed to fetch' });
  });
});

describe('publish call (E11, R110)', () => {
  it('sends only the week and the time; the server publishes what it has stored', async () => {
    const calls: Call[] = [];
    const result = await publishShifts(2, new Date('2026-07-06T06:05:00Z'), fakeFetch(200, { success: true, inserted: 5 }, calls));
    expect(result).toEqual({ ok: true, status: 200, inserted: 5, message: '' });
    expect(calls[0]).toEqual({
      url: '/api/admin/summer-schedule/publish-shifts',
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ weekNo: 2, generatedAt: '2026-07-06T06:05:00.000Z' }) },
    });
    expect(await publishShifts(2, new Date(), fakeFetch(200, { success: false, message: '沒有資料' }))).toEqual({ ok: false, status: 200, inserted: null, message: '沒有資料' });
  });

  it('createScheduleApi binds the three calls to one fetch', async () => {
    const calls: Call[] = [];
    const api = createScheduleApi(fakeFetch(200, { success: true, updatedAt: '2026-07-06T06:05:00.000Z', rawEntries: [] }, calls));
    await api.load(1);
    await api.save(PAYLOAD);
    await api.publish(1, new Date('2026-07-06T06:05:00Z'));
    expect(calls.map(c => `${c.init?.method ?? 'GET'} ${c.url}`)).toEqual([
      'GET /api/admin/schedule-assignments?weekNo=1',
      'POST /api/admin/schedule-assignments',
      'POST /api/admin/summer-schedule/publish-shifts',
    ]);
  });
});
