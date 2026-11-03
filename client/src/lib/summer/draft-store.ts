// Save queue for the summer schedule draft (contract 5.3, issue #9). Plain TypeScript, no React.
//
// One WeekDraft per week. `base` is what the server is known to hold; `local` holds edits the server has not
// confirmed yet, each tagged with the version it was made at. The screen shows base ⊕ local.
//   edit      → local[key] = {value, version: ++head}; auto-save 900ms after the last edit
//   send      → only when nothing is in flight; payload is computed from base ⊕ local by payload.ts and carries
//               the draft's own weekNo; inFlight remembers the version and the snapshot that went out
//   success   → saved = inFlight.version; base = snapshot; local drops versions ≤ saved; newer edits go out at once
//   failure   → local untouched; 409 blocks until a reload, anything else retries after 2s, 4s, 8s, 10s…
//   poll      → every 8s for the week on screen; an answer is used only if it is newer, nothing is in flight, the
//               week is still on screen and no cell has focus. It replaces base only, so unsaved local edits stay on top.
// Invariant: hasUnsaved(d) === d.headVersion > d.savedVersion.
import type { PublishResult, RemoteDraft, SaveFailure, SaveResult } from './api';
import { weekPrefix } from './cell-key';
import { weekByNo } from './config';
import { hourMinute } from './dates';
import { blocksEmptySave, buildSavePayload, draftFromRawEntries, type ServerDraftShape } from './payload';
import type { Draft, EmployeeMeta, SaveSchedulePayload, WeekNo } from './types';
import { applyDerivedCells, buildWeekModel, type WeekInput } from './week-model';

export const AUTO_SAVE_DELAY_MS = 900;
export const POLL_INTERVAL_MS = 8000;
export const RECENT_EDIT_MS = 5000;

export const EMPTY_GUARD_MESSAGE =
  '保護機制：目前畫面沒有任何可辨識的排班資料，因此未寫入資料庫，避免覆蓋已排好的班。請先確認班表已載入或重新整理後再存檔。';
export const PUBLISH_UNSAVED_MESSAGE = '尚有未儲存的變更且儲存失敗，請確認登入/網路後再發布，以免發布到舊資料。';
const CONFLICT_MESSAGE = '伺服器拒絕儲存，請重新載入';

export type DraftVersion = number & { readonly __brand: 'DraftVersion' };
const version = (n: number) => n as DraftVersion;

export interface LocalEdit {
  value: string;
  employees: readonly EmployeeMeta[];
  version: DraftVersion;
}

export interface DraftBase {
  cells: ReadonlyMap<string, string>;
  meta: ReadonlyMap<string, readonly EmployeeMeta[]>;
  serverUpdatedAt: string | null;
}

export interface InFlight {
  version: DraftVersion;
  /** Exactly what was sent, as the server will hold it after success. */
  snapshot: Draft;
  payload: SaveSchedulePayload;
}

export type SavePhase = 'idle' | 'pending' | 'saving' | 'retrying' | 'blocked';
export type BlockReason = 'empty-guard' | 'server-409';

export interface WeekDraft {
  weekNo: WeekNo;
  loaded: boolean;
  base: DraftBase;
  /** Last server copy (loaded or saved), for the blank guard (R097). */
  serverShape: ServerDraftShape;
  local: ReadonlyMap<string, LocalEdit>;
  headVersion: DraftVersion;
  savedVersion: DraftVersion;
  inFlight: InFlight | null;
  phase: SavePhase;
  blocked: BlockReason | null;
  error: string | null;
  loadError: string | null;
  retryDelayMs: number;
  lastSync: { kind: 'saved' | 'synced'; at: number } | null;
}

export function emptyWeekDraft(weekNo: WeekNo): WeekDraft {
  return {
    weekNo,
    loaded: false,
    base: { cells: new Map(), meta: new Map(), serverUpdatedAt: null },
    serverShape: {},
    local: new Map(),
    headVersion: version(0),
    savedVersion: version(0),
    inFlight: null,
    phase: 'idle',
    blocked: null,
    error: null,
    loadError: null,
    retryDelayMs: 0,
    lastSync: null,
  };
}

export function hasUnsaved(d: WeekDraft): boolean {
  return d.headVersion > d.savedVersion;
}

const views = new WeakMap<WeekDraft, Draft>();

/** What the screen shows: the server copy with unsaved edits on top. Same object for the same draft. */
export function viewDraft(d: WeekDraft): Draft {
  const cached = views.get(d);
  if (cached) return cached;
  let view: Draft = { cells: d.base.cells, meta: d.base.meta };
  if (d.local.size) {
    const cells = new Map(d.base.cells);
    const meta = new Map(d.base.meta);
    d.local.forEach((e, key) => {
      cells.set(key, e.value);
      meta.set(key, e.employees);
    });
    view = { cells, meta };
  }
  views.set(d, view);
  return view;
}

/** R004: an edit of one cell. Employees default to the cell's current meta. The key must belong to the draft's week. */
export function applyEdit(d: WeekDraft, key: string, value: string, employees?: readonly EmployeeMeta[]): WeekDraft {
  if (!key.startsWith(weekPrefix(d.weekNo))) throw new Error(`cell ${key} does not belong to week ${d.weekNo}`);
  const head = version(d.headVersion + 1);
  const local = new Map(d.local);
  local.set(key, { value: String(value ?? ''), employees: [...(employees ?? viewDraft(d).meta.get(key) ?? [])], version: head });
  const stillBlocked = !d.inFlight && d.blocked === 'server-409';
  return {
    ...d,
    local,
    headVersion: head,
    phase: d.inFlight ? 'saving' : stillBlocked ? 'blocked' : 'pending',
    blocked: stillBlocked ? d.blocked : null,
    error: stillBlocked ? d.error : null,
  };
}

/** R096, R097: start a save from base ⊕ local, or say why not (not loaded, already in flight, blank guard). */
export function beginSave(d: WeekDraft, build: (snapshot: Draft) => SaveSchedulePayload): { draft: WeekDraft; payload: SaveSchedulePayload | null } {
  if (!d.loaded || d.inFlight) return { draft: d, payload: null };
  const payload = build(viewDraft(d));
  if (payload.weekNo !== d.weekNo) throw new Error(`payload for week ${payload.weekNo} built from the week ${d.weekNo} draft`);
  if (blocksEmptySave(d.serverShape, payload)) {
    return { draft: { ...d, phase: 'blocked', blocked: 'empty-guard', error: EMPTY_GUARD_MESSAGE }, payload: null };
  }
  return {
    draft: { ...d, inFlight: { version: d.headVersion, snapshot: draftFromRawEntries(payload.rawEntries), payload }, phase: 'saving', blocked: null, error: null },
    payload,
  };
}

/** R099: the server stored the in-flight snapshot. Only edits up to the sent version count as saved. */
export function saveSucceeded(d: WeekDraft, updatedAt: string | null, now: number): WeekDraft {
  const sent = d.inFlight;
  if (!sent) return d;
  const savedVersion = version(Math.max(d.savedVersion, sent.version));
  const local = new Map(Array.from(d.local).filter(([, e]) => e.version > savedVersion));
  const next: WeekDraft = {
    ...d,
    inFlight: null,
    savedVersion,
    local,
    base: { cells: sent.snapshot.cells, meta: sent.snapshot.meta, serverUpdatedAt: updatedAt ?? new Date(now).toISOString() },
    serverShape: sent.payload,
    blocked: null,
    error: null,
    retryDelayMs: 0,
    lastSync: { kind: 'saved', at: now },
  };
  return { ...next, phase: hasUnsaved(next) ? 'pending' : 'idle' };
}

export function nextRetryDelay(prevMs: number): number {
  return Math.min((prevMs || 1000) * 2, 10_000);
}

/** R100, E05: local edits stay. 409 stops the queue until a reload; anything else is retried with backoff. */
export function saveFailed(d: WeekDraft, failure: SaveFailure): WeekDraft {
  if (failure.kind === 'conflict') {
    return { ...d, inFlight: null, phase: 'blocked', blocked: 'server-409', error: failure.message || CONFLICT_MESSAGE };
  }
  return { ...d, inFlight: null, phase: 'retrying', blocked: null, error: failure.message, retryDelayMs: nextRetryDelay(d.retryDelayMs) };
}

/** R102, R219: reasons not to send the poll GET at all. An unloaded week is loaded instead (null). */
export function pollSkipReason(d: WeekDraft, ctx: { now: number; lastEditAt: number; editing: boolean }): 'saving' | 'unsaved' | 'recent-edit' | 'editing' | null {
  if (!d.loaded) return null;
  if (d.inFlight) return 'saving';
  if (hasUnsaved(d)) return 'unsaved';
  if (ctx.now - ctx.lastEditAt < RECENT_EDIT_MS) return 'recent-edit';
  if (ctx.editing) return 'editing';
  return null;
}

function isNewer(candidate: string | null, known: string | null): boolean {
  const c = candidate ? Date.parse(candidate) : NaN;
  if (!Number.isFinite(c)) return false;
  const k = known ? Date.parse(known) : NaN;
  return !Number.isFinite(k) || c > k;
}

/**
 * R102, R008: checks made after the GET returns. The first load of a week is always taken (unless a save is out).
 * Unsaved local edits do not block it: the answer replaces base only and the edits stay on top (scenario 3).
 */
export function remoteDiscardReason(d: WeekDraft, remote: RemoteDraft, ctx: { currentWeek: WeekNo; editing: boolean }): 'saving' | 'other-week' | 'editing' | 'not-newer' | null {
  if (remote.weekNo !== d.weekNo) throw new Error(`week ${remote.weekNo} answer offered to the week ${d.weekNo} draft`);
  if (d.inFlight) return 'saving';
  if (!d.loaded) return null;
  if (d.weekNo !== ctx.currentWeek) return 'other-week';
  if (ctx.editing) return 'editing';
  if (!isNewer(remote.updatedAt, d.base.serverUpdatedAt)) return 'not-newer';
  return null;
}

/** R102, R113: take a server copy as the new base. `syncedAt` marks a background sync for the status text. */
export function applyRemote(d: WeekDraft, remote: RemoteDraft, syncedAt: number | null): WeekDraft {
  if (remote.weekNo !== d.weekNo) throw new Error(`week ${remote.weekNo} answer offered to the week ${d.weekNo} draft`);
  return {
    ...d,
    loaded: true,
    loadError: null,
    base: { cells: remote.draft.cells, meta: remote.draft.meta, serverUpdatedAt: remote.updatedAt },
    serverShape: remote.shape,
    lastSync: syncedAt === null ? d.lastSync : { kind: 'synced', at: syncedAt },
  };
}

export type SaveTone = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

/** R099, R100, R101: the status text v40 shows, derived from the draft so 已儲存 only appears when nothing is unsaved. */
export function saveStatus(d: WeekDraft): { tone: SaveTone; text: string } {
  if (d.phase === 'blocked') return { tone: 'error', text: d.blocked === 'empty-guard' ? '保護：空白班表未寫入' : CONFLICT_MESSAGE };
  if (d.inFlight) return { tone: 'saving', text: '儲存中' };
  if (d.phase === 'retrying') return { tone: 'error', text: '儲存失敗，重試中…' };
  if (hasUnsaved(d)) return { tone: 'pending', text: '待自動儲存' };
  if (!d.loaded) return d.loadError ? { tone: 'error', text: '讀取失敗' } : { tone: 'idle', text: '讀取中' };
  if (d.lastSync) return { tone: 'saved', text: `${d.lastSync.kind === 'saved' ? '已儲存' : '已同步'} ${hourMinute(new Date(d.lastSync.at))}` };
  return { tone: 'idle', text: '就緒' };
}

// ---------------------------------------------------------------------------------------------------------------
// Payload from a snapshot

export type WeekContext = Omit<WeekInput, 'week' | 'draft'>;
export type PayloadBuilder = (weekNo: WeekNo, snapshot: Draft, generatedAt: Date) => SaveSchedulePayload;

/** R096, R104: rawEntries, assignments and shifts all from one snapshot, with the derived cells v40 writes on render. */
export function payloadFromSnapshot(context: WeekContext, weekNo: WeekNo, snapshot: Draft, generatedAt: Date): SaveSchedulePayload {
  const model = buildWeekModel({ ...context, week: weekByNo(weekNo), draft: snapshot });
  return buildSavePayload(model, applyDerivedCells(snapshot, model.derivedCells), generatedAt);
}

export function snapshotPayloadBuilder(contextFor: (weekNo: WeekNo) => WeekContext): PayloadBuilder {
  return (weekNo, snapshot, generatedAt) => payloadFromSnapshot(contextFor(weekNo), weekNo, snapshot, generatedAt);
}

// ---------------------------------------------------------------------------------------------------------------
// The store

export interface StoreTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
  now(): number;
}

/** Looked up on every call, so test fake timers installed after import still apply. */
export const globalTimers: StoreTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: id => globalThis.clearTimeout(id as ReturnType<typeof globalThis.setTimeout>),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: id => globalThis.clearInterval(id as ReturnType<typeof globalThis.setInterval>),
  now: () => Date.now(),
};

export interface DraftApi {
  load(weekNo: WeekNo): Promise<RemoteDraft>;
  save(payload: SaveSchedulePayload): Promise<SaveResult>;
}

export interface DraftStoreOptions {
  api: DraftApi;
  buildPayload: PayloadBuilder;
  initialWeek?: WeekNo;
  timers?: StoreTimers;
  /** R219: true while the focus is inside an editable cell. */
  isEditing?: () => boolean;
  /** Called on each poll round that queries the server, so the page can refresh manual courses with it (R102). */
  onPoll?: (weekNo: WeekNo) => void;
}

export interface DraftStoreState {
  currentWeek: WeekNo;
  weeks: ReadonlyMap<WeekNo, WeekDraft>;
}

export type FlushResult = { ok: true } | { ok: false; reason: 'not-loaded' | 'blocked' | 'failed'; message: string };

export interface DraftStore {
  /** For useSyncExternalStore: a new object after every change. */
  getState(): DraftStoreState;
  subscribe(listener: () => void): () => void;
  /** The draft of a week; the week on screen when omitted. */
  week(weekNo?: WeekNo): WeekDraft;
  /** R116: show another week and load it. The previous week's queue keeps going with its own weekNo. */
  open(weekNo: WeekNo): Promise<void>;
  /** R004, R101, R103: the one entry point for cell edits (typing, picker, stage). */
  edit(weekNo: WeekNo, key: string, value: string, employees?: readonly EmployeeMeta[]): void;
  /** 立即儲存: send now, like v40 even when nothing is unsaved. */
  saveNow(weekNo?: WeekNo): void;
  /** R110: send what is unsaved without waiting for the debounce and resolve once the server has all of it. */
  flush(weekNo?: WeekNo): Promise<FlushResult>;
  /** E05 recovery after a 409: load the server copy and either keep the local edits on top (and send) or drop them. */
  reload(weekNo: WeekNo, mode: 'keep-local' | 'discard-local'): Promise<void>;
  pollOnce(): Promise<void>;
  startPolling(): void;
  stopPolling(): void;
  /** Any week with an unsaved or in-flight edit (beforeunload). */
  hasUnsavedAnyWeek(): boolean;
  dispose(): void;
}

type SendReason = 'auto' | 'manual' | 'followup' | 'retry' | 'flush' | 'switch' | 'loaded';

export function createDraftStore(options: DraftStoreOptions): DraftStore {
  const timers = options.timers ?? globalTimers;
  const isEditing = options.isEditing ?? (() => false);
  const initialWeek = options.initialWeek ?? 1;
  let state: DraftStoreState = { currentWeek: initialWeek, weeks: new Map([[initialWeek, emptyWeekDraft(initialWeek)]]) };
  const empties = new Map<WeekNo, WeekDraft>();
  const listeners = new Set<() => void>();
  const autoSaveTimers = new Map<WeekNo, unknown>();
  const retryTimers = new Map<WeekNo, unknown>();
  const flushWaiters = new Set<() => boolean>();
  let pollTimer: unknown = null;
  let lastEditAt = -Infinity;
  let disposed = false;

  const week = (w: WeekNo = state.currentWeek): WeekDraft => {
    const d = state.weeks.get(w);
    if (d) return d;
    if (!empties.has(w)) empties.set(w, emptyWeekDraft(w));
    return empties.get(w)!;
  };

  const put = (d: WeekDraft) => {
    if (disposed) return;
    const weeks = new Map(state.weeks);
    weeks.set(d.weekNo, d);
    state = { ...state, weeks };
    listeners.forEach(l => l());
    flushWaiters.forEach(done => {
      if (done()) flushWaiters.delete(done);
    });
  };

  const clearTimer = (timersByWeek: Map<WeekNo, unknown>, w: WeekNo) => {
    if (!timersByWeek.has(w)) return;
    timers.clearTimeout(timersByWeek.get(w));
    timersByWeek.delete(w);
  };

  function scheduleAutoSave(w: WeekNo) {
    clearTimer(autoSaveTimers, w);
    autoSaveTimers.set(
      w,
      timers.setTimeout(() => {
        autoSaveTimers.delete(w);
        send(w, 'auto');
      }, AUTO_SAVE_DELAY_MS),
    );
  }

  function send(w: WeekNo, reason: SendReason) {
    if (disposed) return;
    const d = week(w);
    if (!d.loaded || d.inFlight) return;
    // A retry finishes a failed save even when it carried no new edits (a 立即儲存 on a clean week); otherwise
    // the status would stay 儲存失敗，重試中… with no retry coming.
    const explicit = reason === 'manual' || reason === 'retry';
    if (!explicit && (d.blocked === 'server-409' || !hasUnsaved(d))) return;
    clearTimer(autoSaveTimers, w);
    clearTimer(retryTimers, w);
    const generatedAt = new Date(timers.now());
    const { draft, payload } = beginSave(d, snapshot => options.buildPayload(w, snapshot, generatedAt));
    if (draft !== d) put(draft);
    if (!payload) return;
    options.api.save(payload).then(
      result => settle(w, result),
      err => settle(w, { ok: false, kind: 'network', status: null, message: String(err) }),
    );
  }

  function settle(w: WeekNo, result: SaveResult) {
    if (disposed) return;
    if (result.ok) {
      const next = saveSucceeded(week(w), result.updatedAt, timers.now());
      put(next);
      if (hasUnsaved(next)) send(w, 'followup');
      return;
    }
    const next = saveFailed(week(w), result);
    put(next);
    if (next.phase !== 'retrying') return;
    clearTimer(retryTimers, w);
    retryTimers.set(
      w,
      timers.setTimeout(() => {
        retryTimers.delete(w);
        send(w, 'retry');
      }, next.retryDelayMs),
    );
  }

  async function load(w: WeekNo, mode: 'open' | 'poll' | 'keep-local' | 'discard-local'): Promise<void> {
    let remote: RemoteDraft;
    try {
      remote = await options.api.load(w);
    } catch (err) {
      const d = week(w);
      if (!disposed && !d.loaded) put({ ...d, loadError: String(err) });
      return;
    }
    if (disposed) return;
    const d = week(w);
    if (mode === 'keep-local' || mode === 'discard-local') {
      if (d.inFlight) return;
      clearTimer(autoSaveTimers, w);
      clearTimer(retryTimers, w);
      let next = applyRemote(d, remote, timers.now());
      if (mode === 'discard-local') next = { ...next, local: new Map(), savedVersion: next.headVersion };
      next = { ...next, phase: hasUnsaved(next) ? 'pending' : 'idle', blocked: null, error: null, retryDelayMs: 0 };
      put(next);
      send(w, 'loaded');
      return;
    }
    if (remoteDiscardReason(d, remote, { currentWeek: state.currentWeek, editing: isEditing() })) return;
    const next = applyRemote(d, remote, d.loaded ? timers.now() : null);
    put(next);
    if (!d.loaded) send(w, 'loaded');
  }

  async function pollOnce(): Promise<void> {
    if (disposed) return;
    const w = state.currentWeek;
    const d = week(w);
    if (!d.loaded) return load(w, 'open');
    if (pollSkipReason(d, { now: timers.now(), lastEditAt, editing: isEditing() })) return;
    options.onPoll?.(w);
    return load(w, 'poll');
  }

  function flush(w: WeekNo = state.currentWeek): Promise<FlushResult> {
    if (!week(w).loaded) return Promise.resolve({ ok: false, reason: 'not-loaded', message: PUBLISH_UNSAVED_MESSAGE });
    send(w, 'flush');
    return new Promise(resolve => {
      const done = (): boolean => {
        const d = week(w);
        if (disposed) resolve({ ok: false, reason: 'failed', message: PUBLISH_UNSAVED_MESSAGE });
        else if (d.inFlight) return false;
        else if (!hasUnsaved(d)) resolve({ ok: true });
        else if (d.phase === 'blocked') resolve({ ok: false, reason: 'blocked', message: d.error ?? PUBLISH_UNSAVED_MESSAGE });
        else if (d.phase === 'retrying') resolve({ ok: false, reason: 'failed', message: PUBLISH_UNSAVED_MESSAGE });
        else return false;
        return true;
      };
      if (!done()) flushWaiters.add(done);
    });
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    week,
    open(w) {
      const prev = state.currentWeek;
      if (prev !== w && hasUnsaved(week(prev))) send(prev, 'switch');
      if (!disposed) {
        const weeks = new Map(state.weeks);
        if (!weeks.has(w)) weeks.set(w, emptyWeekDraft(w));
        state = { currentWeek: w, weeks };
        listeners.forEach(l => l());
      }
      return load(w, 'open');
    },
    edit(w, key, value, employees) {
      put(applyEdit(state.weeks.get(w) ?? emptyWeekDraft(w), key, value, employees));
      lastEditAt = timers.now();
      scheduleAutoSave(w);
    },
    saveNow(w = state.currentWeek) {
      send(w, 'manual');
    },
    flush,
    reload: (w, mode) => load(w, mode),
    pollOnce,
    startPolling() {
      if (pollTimer === null && !disposed) pollTimer = timers.setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
    },
    stopPolling() {
      if (pollTimer !== null) timers.clearInterval(pollTimer);
      pollTimer = null;
    },
    hasUnsavedAnyWeek: () => Array.from(state.weeks.values()).some(d => hasUnsaved(d) || !!d.inFlight),
    dispose() {
      if (pollTimer !== null) timers.clearInterval(pollTimer);
      pollTimer = null;
      autoSaveTimers.forEach(id => timers.clearTimeout(id));
      retryTimers.forEach(id => timers.clearTimeout(id));
      autoSaveTimers.clear();
      retryTimers.clear();
      disposed = true;
      flushWaiters.forEach(done => done());
      flushWaiters.clear();
      listeners.clear();
    },
  };
}

/** R110: publish only after the server holds every edit of the week; report the v40 message only on a real failure. */
export function publishWhenSaved(store: Pick<DraftStore, 'flush'>, weekNo: WeekNo, publish: (weekNo: WeekNo) => Promise<PublishResult>): Promise<PublishResult> {
  return store.flush(weekNo).then(flushed => (flushed.ok ? publish(weekNo) : { ok: false, status: null, inserted: null, message: flushed.message }));
}

/** S24: ask before leaving while any week has an unsaved or in-flight edit (v40 had no such prompt). */
export function bindBeforeUnload(store: Pick<DraftStore, 'hasUnsavedAnyWeek'>, target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>): () => void {
  const handler = (event: Event) => {
    if (!store.hasUnsavedAnyWeek()) return;
    event.preventDefault();
    (event as BeforeUnloadEvent).returnValue = '';
  };
  target.addEventListener('beforeunload', handler);
  return () => target.removeEventListener('beforeunload', handler);
}
