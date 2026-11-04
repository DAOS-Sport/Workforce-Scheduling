import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScheduleApi, parseRemoteDraft } from '../api';
import { dutyGridCellKey } from '../cell-key';
import {
  AUTO_SAVE_DELAY_MS,
  POLL_INTERVAL_MS,
  applyEdit,
  applyRemote,
  beginSave,
  bindBeforeUnload,
  createDraftStore,
  emptyWeekDraft,
  hasUnsaved,
  nextRetryDelay,
  payloadFromSnapshot,
  pollSkipReason,
  publishWhenSaved,
  remoteDiscardReason,
  saveFailed,
  saveStatus,
  saveSucceeded,
  snapshotPayloadBuilder,
  viewDraft,
  type DraftStoreOptions,
  type WeekContext,
  type WeekDraft,
} from '../draft-store';
import { normalizeEmployee } from '../roster';
import type { Employee, WeekNo } from '../types';
import { FakeScheduleServer } from './issue9/fake-server';
import { EMPTY_CONTEXT, reactTarget } from './issue9/react-target';
import { SCENARIOS, SCENARIO_EPOCH, X, Y, Z, failedChecks, type ScenarioClock } from './issue9/scenarios';

const iso = (ms: number) => new Date(ms).toISOString();

function fakeClock(): ScenarioClock {
  return {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    advanceTo: async abs => {
      await vi.advanceTimersByTimeAsync(Math.max(0, abs - Date.now()));
      for (let i = 0; i < 20; i++) await Promise.resolve();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(SCENARIO_EPOCH);
});
afterEach(() => {
  vi.useRealTimers();
});

// The same scenario objects run against the v40 page in scripts/summer-v40/issue9-harness.ts, where every one is red.
async function runScenario(id: string) {
  const scenario = SCENARIOS.find(s => s.id === id);
  if (!scenario) throw new Error(`no scenario ${id}`);
  const result = await scenario.run(reactTarget(fakeClock()));
  expect(failedChecks(result), result.log.join('\n')).toEqual([]);
  expect(result.checks.length).toBeGreaterThan(0);
}

describe('issue #9 scenarios on the draft store (4.6)', () => {
  it('與 v40 不同：劇本 1，舊請求回來不清掉在途期間新修改的未存旗標，也不顯示「已儲存」（R096, R099, R101）', () => runScenario('S1'));
  it('與 v40 不同：劇本 2，A 在途時改 B，A 回來立刻補送 B，重整後 B 仍在（R096, R099）', () => runScenario('S2'));
  it('與 v40 不同：劇本 3，輪詢回來只換 base，本機未存的 Z 保留並與遠端 X 一起存回（R102, R008）', () => runScenario('S3'));
  it('與 v40 不同：劇本 4，切週時舊週帶著自己的 weekNo 送完，新週不被寫入（R116）', () => runScenario('S4'));
});

// ---------------------------------------------------------------------------------------------------------------
// Pure transitions

const W1_ENTRIES = [{ key: X, value: 'old', employees: [] }];
function loadedDraft(entries = W1_ENTRIES, updatedAt: string | null = '2026-07-06T00:58:00.000Z', weekNo: WeekNo = 1): WeekDraft {
  return applyRemote(emptyWeekDraft(weekNo), parseRemoteDraft({ weekNo, updatedAt, rawEntries: entries, assignments: [], shifts: [] }, weekNo), null);
}
const build = (d: WeekDraft) => (snapshot: Parameters<typeof payloadFromSnapshot>[2]) => payloadFromSnapshot(EMPTY_CONTEXT, d.weekNo, snapshot, new Date(SCENARIO_EPOCH));

describe('edits and versions (R004)', () => {
  it('every edit bumps the head version, marks the week unsaved and shows on top of the base (R004)', () => {
    let d = loadedDraft();
    expect(hasUnsaved(d)).toBe(false);
    d = applyEdit(d, Y, 'A');
    expect(d.headVersion).toBe(1);
    expect(hasUnsaved(d)).toBe(true);
    d = applyEdit(d, Y, 'A2');
    expect(d.headVersion).toBe(2);
    expect(d.local.get(Y)?.version).toBe(2);
    expect(viewDraft(d).cells.get(Y)).toBe('A2');
    expect(viewDraft(d).cells.get(X)).toBe('old');
    expect(d.base.cells.has(Y)).toBe(false);
  });

  it('keeps the cell meta unless the edit brings its own employees (R004)', () => {
    const meta = [{ employeeId: 9, employeeName: '王偉', lineBound: true, role: '救生', venueId: 2, venueName: '新北高中' }];
    let d = loadedDraft([{ key: X, value: '王偉', employees: meta as never[] }]);
    d = applyEdit(d, X, '王偉 08:00-12:00');
    expect(viewDraft(d).meta.get(X)).toEqual(meta);
    d = applyEdit(d, X, '', []);
    expect(viewDraft(d).meta.get(X)).toEqual([]);
  });

  it('refuses a key of another week, so a queued edit can never change weeks (R004, R116)', () => {
    expect(() => applyEdit(loadedDraft(), 'w2-新北高中-lifeguard-dutygrid-r1-d1', 'x')).toThrow(/week 1/);
  });
});

describe('sending (R096, R097)', () => {
  it('snapshots base plus local, records the version and refuses a second request while one is in flight (R096)', () => {
    let d = applyEdit(applyEdit(loadedDraft(), Y, 'A'), Z, 'B');
    const first = beginSave(d, build(d));
    expect(first.payload?.weekNo).toBe(1);
    expect(first.payload?.rawEntries.filter(e => [X, Y, Z].includes(e.key)).map(e => `${e.key === X ? 'X' : e.key === Y ? 'Y' : 'Z'}=${e.value}`)).toEqual(['X=old', 'Y=A', 'Z=B']);
    d = first.draft;
    expect(d.inFlight?.version).toBe(2);
    expect(d.phase).toBe('saving');
    d = applyEdit(d, Z, 'C');
    const second = beginSave(d, build(d));
    expect(second.payload).toBeNull();
    expect(second.draft).toBe(d);
  });

  it('does not send before the week is loaded (R096)', () => {
    const d = emptyWeekDraft(1);
    expect(beginSave(d, build(d)).payload).toBeNull();
  });

  it('rawEntries, assignments and shifts of one save all come from the same snapshot (R096, R104)', () => {
    const employees = [normalizeEmployee({ id: 9, name: '王偉', role: '救生', lineBound: true })].filter((e): e is Employee => !!e);
    const ctx: WeekContext = { ...EMPTY_CONTEXT, employees };
    let d = loadedDraft([{ key: X, value: '王偉 08:00-12:00', employees: [] }]);
    d = applyEdit(d, Z, '王偉 13:00-15:00');
    const { payload } = beginSave(d, snapshot => payloadFromSnapshot(ctx, 1, snapshot, new Date(SCENARIO_EPOCH)));
    expect(payload).not.toBeNull();
    const raw = Object.fromEntries(payload!.rawEntries.filter(e => e.key === X || e.key === Z).map(e => [e.key, e.value]));
    expect(raw).toEqual({ [X]: '王偉 08:00-12:00', [Z]: '王偉 13:00-15:00' });
    expect(payload!.assignments.map(a => `${a.employeeName} ${a.days.join()} ${a.startTime}-${a.endTime}`)).toEqual(['王偉 3 08:00-12:00', '王偉 5 13:00-15:00']);
    expect(payload!.shifts.map(s => `${s.employeeId} ${s.date} ${s.startTime}`)).toEqual(['9 2026-07-01 08:00', '9 2026-07-03 13:00']);
  });

  it('the blank guard stops the request and blocks the week until the next edit (R096, R097)', () => {
    let d = loadedDraft([{ key: X, value: '王偉 08:00-12:00', employees: [] }]);
    d = applyEdit(d, X, '');
    const blocked = beginSave(d, build(d));
    expect(blocked.payload).toBeNull();
    expect(blocked.draft.phase).toBe('blocked');
    expect(blocked.draft.blocked).toBe('empty-guard');
    expect(saveStatus(blocked.draft).text).toBe('保護：空白班表未寫入');
    expect(blocked.draft.error).toBe('保護機制：目前畫面沒有任何可辨識的排班資料，因此未寫入資料庫，避免覆蓋已排好的班。請先確認班表已載入或重新整理後再存檔。');
    expect(hasUnsaved(blocked.draft)).toBe(true);
  });
});

describe('save results (R099, R100, E05)', () => {
  it('success clears only the versions that were sent and keeps the newer ones (R099)', () => {
    let d = applyEdit(loadedDraft(), Y, 'A');
    d = beginSave(d, build(d)).draft;
    d = applyEdit(d, Z, 'B');
    d = saveSucceeded(d, '2026-07-06T01:00:02.900Z', SCENARIO_EPOCH + 2900);
    expect(d.savedVersion).toBe(1);
    expect(d.headVersion).toBe(2);
    expect(hasUnsaved(d)).toBe(true);
    expect([...d.local.keys()]).toEqual([Z]);
    expect(d.base.cells.get(Y)).toBe('A');
    expect(d.base.serverUpdatedAt).toBe('2026-07-06T01:00:02.900Z');
    expect(d.inFlight).toBeNull();
    expect(saveStatus(d).text).toBe('待自動儲存');
  });

  it('success without updatedAt falls back to now and shows 已儲存 HH:MM in Taipei time (R099)', () => {
    let d = applyEdit(loadedDraft(), Y, 'A');
    d = beginSave(d, build(d)).draft;
    d = saveSucceeded(d, null, Date.UTC(2026, 6, 6, 6, 5));
    expect(d.base.serverUpdatedAt).toBe('2026-07-06T06:05:00.000Z');
    expect(hasUnsaved(d)).toBe(false);
    expect(saveStatus(d)).toEqual({ tone: 'saved', text: '已儲存 14:05' });
  });

  it('a later edit to the same cell survives the earlier save of that cell (R099)', () => {
    let d = applyEdit(loadedDraft(), Y, 'A');
    d = beginSave(d, build(d)).draft;
    d = applyEdit(d, Y, 'A2');
    d = saveSucceeded(d, '2026-07-06T01:00:02.000Z', SCENARIO_EPOCH);
    expect(viewDraft(d).cells.get(Y)).toBe('A2');
    expect(hasUnsaved(d)).toBe(true);
  });

  it('failure keeps every local edit and backs off 2s, 4s, 8s, 10s, 10s (R100)', () => {
    expect([0, 2000, 4000, 8000, 10000].map(nextRetryDelay)).toEqual([2000, 4000, 8000, 10000, 10000]);
    let d = applyEdit(loadedDraft(), Y, 'A');
    d = beginSave(d, build(d)).draft;
    d = saveFailed(d, { ok: false, kind: 'http', status: 500, message: 'boom' });
    expect(d.inFlight).toBeNull();
    expect(d.phase).toBe('retrying');
    expect(d.retryDelayMs).toBe(2000);
    expect(viewDraft(d).cells.get(Y)).toBe('A');
    expect(saveStatus(d)).toEqual({ tone: 'error', text: '儲存失敗，重試中…' });
  });

  it('與 v40 不同：409 停下來提示重新載入，不再無限重試（R100, E05）', () => {
    let d = applyEdit(loadedDraft(), Y, 'A');
    d = beginSave(d, build(d)).draft;
    d = saveFailed(d, { ok: false, kind: 'conflict', status: 409, message: '保護：空白班表不覆蓋既有排班資料' });
    expect(d.phase).toBe('blocked');
    expect(d.blocked).toBe('server-409');
    expect(d.error).toBe('保護：空白班表不覆蓋既有排班資料');
    expect(saveStatus(d)).toEqual({ tone: 'error', text: '伺服器拒絕儲存，請重新載入' });
    expect(hasUnsaved(d)).toBe(true);
  });

  it('status text for each state (R099, R100, R101)', () => {
    const fresh = loadedDraft();
    expect(saveStatus(emptyWeekDraft(1))).toEqual({ tone: 'idle', text: '讀取中' });
    expect(saveStatus(fresh)).toEqual({ tone: 'idle', text: '就緒' });
    const edited = applyEdit(fresh, Y, 'A');
    expect(saveStatus(edited)).toEqual({ tone: 'pending', text: '待自動儲存' });
    expect(saveStatus(beginSave(edited, build(edited)).draft)).toEqual({ tone: 'saving', text: '儲存中' });
    const synced = applyRemote(fresh, parseRemoteDraft({ updatedAt: '2026-07-06T01:00:30.000Z', rawEntries: W1_ENTRIES }, 1), Date.UTC(2026, 6, 6, 6, 7));
    expect(saveStatus(synced)).toEqual({ tone: 'saved', text: '已同步 14:07' });
  });
});

describe('remote apply (R102, R008, R219)', () => {
  const remote = (updatedAt: string | null, value = 'other-device', weekNo: WeekNo = 1) =>
    parseRemoteDraft({ weekNo, updatedAt, rawEntries: [{ key: dutyGridCellKey(weekNo, '新北高中', 'lifeguard', 1, 3), value, employees: [] }] }, weekNo);
  const ctx = { currentWeek: 1 as WeekNo, editing: false };

  it('before sending the GET: skip while saving, unsaved, edited within 5s or a cell has focus (R102, R219)', () => {
    const clean = loadedDraft();
    const base = { now: 100_000, lastEditAt: 0, editing: false };
    expect(pollSkipReason(clean, base)).toBeNull();
    expect(pollSkipReason(applyEdit(clean, Y, 'A'), base)).toBe('unsaved');
    const inFlight = beginSave(applyEdit(clean, Y, 'A'), build(clean)).draft;
    expect(pollSkipReason(inFlight, base)).toBe('saving');
    expect(pollSkipReason(clean, { ...base, lastEditAt: 96_000 })).toBe('recent-edit');
    expect(pollSkipReason(clean, { ...base, lastEditAt: 95_000 })).toBeNull();
    expect(pollSkipReason(clean, { ...base, editing: true })).toBe('editing');
  });

  it('after the GET: keep only a newer answer for the week on screen with nothing in flight and no focused cell (R102, R008)', () => {
    const clean = loadedDraft();
    expect(remoteDiscardReason(clean, remote('2026-07-06T00:59:00.000Z'), ctx)).toBeNull();
    expect(remoteDiscardReason(clean, remote('2026-07-06T00:58:00.000Z'), ctx)).toBe('not-newer');
    expect(remoteDiscardReason(clean, remote(null), ctx)).toBe('not-newer');
    expect(remoteDiscardReason(clean, remote('2026-07-06T00:59:00.000Z'), { ...ctx, currentWeek: 2 })).toBe('other-week');
    expect(remoteDiscardReason(clean, remote('2026-07-06T00:59:00.000Z'), { ...ctx, editing: true })).toBe('editing');
    const inFlight = beginSave(applyEdit(clean, Y, 'A'), build(clean)).draft;
    expect(remoteDiscardReason(inFlight, remote('2026-07-06T00:59:00.000Z'), ctx)).toBe('saving');
    expect(() => remoteDiscardReason(clean, remote('2026-07-06T00:59:00.000Z', 'x', 2), ctx)).toThrow();
  });

  it('first load of a week takes the server copy whatever its time (R102, R113)', () => {
    expect(remoteDiscardReason(emptyWeekDraft(1), remote(null), ctx)).toBeNull();
    expect(remoteDiscardReason(emptyWeekDraft(1), remote(null), { ...ctx, currentWeek: 2 })).toBeNull();
  });

  it('與 v40 不同：套用遠端只換 base，本機未存的格疊在上面（R102）', () => {
    let d = applyEdit(loadedDraft(), Z, 'C');
    d = applyEdit(d, X, 'mine');
    d = applyRemote(d, remote('2026-07-06T00:59:00.000Z'), SCENARIO_EPOCH);
    expect(d.base.cells.get(X)).toBe('other-device');
    expect(viewDraft(d).cells.get(X)).toBe('mine');
    expect(viewDraft(d).cells.get(Z)).toBe('C');
    expect(hasUnsaved(d)).toBe(true);
    expect(d.base.serverUpdatedAt).toBe('2026-07-06T00:59:00.000Z');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The store on a fake server

async function setup(opts: Partial<DraftStoreOptions> = {}, seed: Record<string, string> = { [X]: 'old' }) {
  const clock = fakeClock();
  const server = new FakeScheduleServer(clock);
  const t0 = Date.now();
  server.startAt(t0);
  server.seed(1, seed, iso(t0 - 120_000));
  const store = createDraftStore({ api: createScheduleApi(server.fetch), buildPayload: snapshotPayloadBuilder(() => EMPTY_CONTEXT), initialWeek: 1, ...opts });
  server.getDelay = () => 0;
  const loading = store.open(1);
  await clock.advanceTo(Date.now());
  await loading;
  server.getDelay = () => 100;
  const at = (ms: number) => clock.advanceTo(t0 + ms);
  return { clock, server, store, t0, at };
}

describe('auto-save (R101, R103)', () => {
  it('one edit stream sends once, 900ms after the last keystroke (R101, R103)', async () => {
    const { server, store, at } = await setup();
    expect(AUTO_SAVE_DELAY_MS).toBe(900);
    store.edit(1, Y, '王');
    await at(300);
    store.edit(1, Y, '王偉');
    await at(600);
    store.edit(1, Y, '王偉 8');
    expect(saveStatus(store.week()).text).toBe('待自動儲存');
    await at(1499);
    expect(server.posts).toHaveLength(0);
    await at(1500);
    expect(server.posts.map(p => [p.sentAt, p.cells[Y]])).toEqual([[1500, '王偉 8']]);
    await at(1800);
    expect(saveStatus(store.week()).text).toBe('已儲存 09:00');
    store.dispose();
  });

  it('立即儲存 sends right away, even with nothing unsaved, like v40 (R101)', async () => {
    const { server, store, at } = await setup();
    store.saveNow();
    await at(0);
    expect(server.posts.map(p => p.sentAt)).toEqual([0]);
    store.edit(1, Y, 'A');
    store.saveNow();
    await at(10);
    expect(server.posts.map(p => p.sentAt)).toEqual([0]);
    await at(400);
    expect(server.posts.map(p => [p.sentAt, p.cells[Y]])).toEqual([
      [0, undefined],
      [300, 'A'],
    ]);
    store.dispose();
  });

  it('retries a failed save with backoff while edits are unsaved, then resets (R100)', async () => {
    const { server, store, at } = await setup();
    server.postStatus = n => (n <= 3 ? 500 : 200);
    store.edit(1, Y, 'A');
    await at(1200);
    expect(saveStatus(store.week()).text).toBe('儲存失敗，重試中…');
    await at(20_000);
    expect(server.posts.map(p => p.sentAt)).toEqual([900, 3200, 7500, 15800]);
    expect(server.cells(1)[Y]).toBe('A');
    expect(store.week().retryDelayMs).toBe(0);
    store.dispose();
  });

  it('a failed 立即儲存 with nothing unsaved is retried too, so 重試中 never sticks (R100)', async () => {
    const { server, store, at } = await setup();
    server.postStatus = n => (n === 1 ? 500 : 200);
    store.saveNow();
    await at(300);
    expect(saveStatus(store.week()).text).toBe('儲存失敗，重試中…');
    await at(2600);
    expect(server.posts.map(p => p.sentAt)).toEqual([0, 2300]);
    expect(saveStatus(store.week())).toEqual({ tone: 'saved', text: '已儲存 09:00' });
    store.dispose();
  });

  it('reloading cancels a pending retry (R100, E05)', async () => {
    const { server, store, at } = await setup();
    server.postStatus = () => 500;
    store.edit(1, Y, 'A');
    await at(1200);
    expect(store.week().phase).toBe('retrying');
    const reloading = store.reload(1, 'discard-local');
    await at(1300);
    await reloading;
    await at(30_000);
    expect(server.posts.map(p => p.sentAt)).toEqual([900]);
    expect(saveStatus(store.week()).tone).toBe('saved');
    store.dispose();
  });

  it('與 v40 不同：伺服器回 409 後不自動重試，重新載入時把本機修改疊上遠端再送（E05, R100）', async () => {
    const { server, store, at } = await setup();
    server.postStatus = n => (n === 1 ? 409 : 200);
    store.edit(1, Y, 'A');
    await at(1200);
    expect(store.week().blocked).toBe('server-409');
    store.edit(1, Z, 'B');
    await at(60_000);
    expect(server.posts).toHaveLength(1);
    expect(hasUnsaved(store.week())).toBe(true);
    server.seed(1, { [X]: 'other-device' }, iso(Date.now() - 1000));
    const reloading = store.reload(1, 'keep-local');
    await at(60_100);
    await reloading;
    await at(61_500);
    expect(server.posts).toHaveLength(2);
    expect(server.cells(1)).toMatchObject({ [X]: 'other-device', [Y]: 'A', [Z]: 'B' });
    expect(hasUnsaved(store.week())).toBe(false);
    store.dispose();
  });

  it('reload can also drop the local edits and take the server copy (E05)', async () => {
    const { server, store, at } = await setup();
    server.postStatus = () => 409;
    store.edit(1, Y, 'A');
    await at(1200);
    const reloading = store.reload(1, 'discard-local');
    await at(1300);
    await reloading;
    expect(hasUnsaved(store.week())).toBe(false);
    expect(viewDraft(store.week()).cells.get(Y)).toBeUndefined();
    expect(store.week().phase).toBe('idle');
    store.dispose();
  });
});

describe('polling (R102, R219, R008)', () => {
  it('GETs the week on screen every 8000ms and tells the page to refresh its other data (R102)', async () => {
    const onPoll = vi.fn();
    const { server, store, at } = await setup({ onPoll });
    expect(POLL_INTERVAL_MS).toBe(8000);
    store.startPolling();
    await at(16_200);
    expect(server.log.filter(l => / GET#\d+ sent/.test(l)).map(l => l.split(' ')[0])).toEqual(['t=0ms', 't=8000ms', 't=16000ms']);
    expect(onPoll.mock.calls).toEqual([[1], [1]]);
    store.dispose();
  });

  it('applies a newer server copy and shows 已同步 (R102)', async () => {
    const { server, store, at } = await setup();
    store.startPolling();
    server.seed(1, { [X]: 'other-device' }, iso(Date.now() - 1000));
    await at(8100);
    expect(viewDraft(store.week()).cells.get(X)).toBe('other-device');
    expect(saveStatus(store.week()).text).toBe('已同步 09:00');
    store.dispose();
  });

  it('skips the GET while a cell has focus (R219)', async () => {
    let editing = true;
    const { server, store, at } = await setup({ isEditing: () => editing });
    store.startPolling();
    await at(8100);
    expect(server.log.filter(l => / GET#\d+ sent/.test(l))).toHaveLength(1);
    editing = false;
    await at(16_100);
    expect(server.log.filter(l => / GET#\d+ sent/.test(l))).toHaveLength(2);
    store.dispose();
  });

  it('drops an answer that comes back while a cell has focus, and applies it on the next round (R008)', async () => {
    let editing = false;
    const { server, store, at } = await setup({ isEditing: () => editing });
    store.startPolling();
    server.seed(1, { [X]: 'other-device' }, iso(Date.now() - 1000));
    server.getDelay = () => 500;
    await at(8000);
    editing = true;
    await at(8500);
    expect(viewDraft(store.week()).cells.get(X)).toBe('old');
    editing = false;
    await at(16_500);
    expect(viewDraft(store.week()).cells.get(X)).toBe('other-device');
    store.dispose();
  });

  it('drops an answer that comes back after a save was sent (R102)', async () => {
    const { server, store, at } = await setup();
    store.startPolling();
    server.seed(1, { [X]: 'other-device' }, iso(Date.now() - 1000));
    server.getDelay = () => 1000;
    server.postDelay = () => 2000;
    await at(8000);
    store.edit(1, Y, 'A');
    store.saveNow();
    await at(9000);
    expect(store.week().inFlight).not.toBeNull();
    expect(store.week().base.cells.get(X)).toBe('old');
    store.dispose();
  });

  it('drops an answer for a week that is no longer on screen (R102, R116)', async () => {
    const { server, store, at } = await setup();
    store.startPolling();
    server.seed(1, { [X]: 'other-device' }, iso(Date.now() - 1000));
    server.getDelay = () => 1000;
    await at(8100);
    void store.open(2);
    await at(9500);
    expect(store.week(1).base.cells.get(X)).toBe('old');
    store.dispose();
  });
});

describe('switching weeks (R116)', () => {
  it('與 v40 不同：切週時舊週的未存修改立刻帶著自己的週次送出，切回來資料都在（R116）', async () => {
    const { server, store, at } = await setup();
    server.seed(2, { [dutyGridCellKey(2, '新北高中', 'lifeguard', 1, 1)]: 'w2-old' }, iso(Date.now() - 1000));
    store.edit(1, Y, 'A');
    await at(100);
    void store.open(2);
    await at(100);
    expect(server.posts.map(p => [p.weekNo, p.sentAt, p.cells[Y]])).toEqual([[1, 100, 'A']]);
    await at(500);
    expect(store.getState().currentWeek).toBe(2);
    expect(viewDraft(store.week()).cells.get(dutyGridCellKey(2, '新北高中', 'lifeguard', 1, 1))).toBe('w2-old');
    expect(() => store.edit(2, Y, 'wrong week')).toThrow();
    void store.open(1);
    await at(700);
    expect(viewDraft(store.week()).cells.get(Y)).toBe('A');
    expect(server.posts.every(p => p.keys.every(k => k.startsWith(`w${p.weekNo}-`)))).toBe(true);
    store.dispose();
  });

  it('an edit made in an unloaded week waits for the load before it is sent (R116, R096)', async () => {
    const { server, store, at } = await setup();
    server.getDelay = () => 2000;
    void store.open(2);
    const k2 = dutyGridCellKey(2, '新北高中', 'lifeguard', 1, 1);
    store.edit(2, k2, 'early');
    await at(1500);
    expect(server.posts).toHaveLength(0);
    await at(3000);
    expect(server.posts.map(p => [p.weekNo, p.sentAt, p.cells[k2]])).toEqual([[2, 2000, 'early']]);
    store.dispose();
  });
});

describe('publish waits for the queue (R110)', () => {
  it('與 v40 不同：存檔在途時按發布，等存檔回來再發布，不誤報儲存失敗（R110）', async () => {
    const { server, store, at } = await setup();
    server.postDelay = () => 2000;
    store.edit(1, Y, 'A');
    await at(1000);
    const publish = vi.fn(async () => ({ ok: true, status: 200, inserted: 1, message: '' }));
    const result = publishWhenSaved(store, 1, publish);
    await at(2899);
    expect(publish).not.toHaveBeenCalled();
    await at(2900);
    expect(await result).toEqual({ ok: true, status: 200, inserted: 1, message: '' });
    expect(publish).toHaveBeenCalledWith(1);
    expect(server.cells(1)[Y]).toBe('A');
    store.dispose();
  });

  it('flush skips the debounce and also waits for edits made while saving (R110)', async () => {
    const { server, store, at } = await setup();
    server.postDelay = () => 500;
    store.edit(1, Y, 'A');
    const flushed = store.flush(1);
    await at(0);
    expect(server.posts.map(p => p.sentAt)).toEqual([0]);
    store.edit(1, Z, 'B');
    await at(1000);
    expect(await flushed).toEqual({ ok: true });
    expect(server.cells(1)).toMatchObject({ [Y]: 'A', [Z]: 'B' });
    store.dispose();
  });

  it('reports the v40 message only when the save really failed, and does not publish (R110)', async () => {
    const { server, store, at } = await setup();
    server.postStatus = () => 500;
    store.edit(1, Y, 'A');
    const publish = vi.fn();
    const result = publishWhenSaved(store, 1, publish);
    await at(400);
    expect(await result).toEqual({ ok: false, status: null, inserted: null, message: '尚有未儲存的變更且儲存失敗，請確認登入/網路後再發布，以免發布到舊資料。' });
    expect(publish).not.toHaveBeenCalled();
    store.dispose();
  });

  it('publishes at once when nothing is waiting (R110)', async () => {
    const { store } = await setup();
    await expect(store.flush(1)).resolves.toEqual({ ok: true });
    store.dispose();
  });
});

describe('leaving the page (S24)', () => {
  it('asks before unload while any week has an unsaved or in-flight edit', async () => {
    const { store, at } = await setup();
    const target = new EventTarget();
    const unbind = bindBeforeUnload(store, target);
    let lastReturnValue: unknown;
    const fire = () => {
      // A browser's BeforeUnloadEvent has a writable returnValue; a plain Event's is a read-only getter.
      const ev = new Event('beforeunload', { cancelable: true }) as Event & { returnValue: unknown };
      Object.defineProperty(ev, 'returnValue', { value: undefined, writable: true, configurable: true });
      target.dispatchEvent(ev);
      lastReturnValue = ev.returnValue;
      return ev.defaultPrevented;
    };
    expect(fire()).toBe(false);
    store.edit(1, Y, 'A');
    expect(fire()).toBe(true);
    expect(lastReturnValue).toBe('');
    await at(1500);
    expect(fire()).toBe(false);
    unbind();
    store.edit(1, Z, 'B');
    expect(fire()).toBe(false);
    store.dispose();
  });
});
