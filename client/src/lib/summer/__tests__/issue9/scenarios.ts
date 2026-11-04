// Issue #9 scenarios from docs/summer-v40/儲存語意合約.md section 4.6, written once and run against two targets:
// the v40 page (scripts/summer-v40/issue9-harness.ts, expected red) and the React draft store (draft-store.test.ts, expected green).
// Each check is the contract's "React 版驗收" sentence for that scenario.
// Edits go through the picker / stage path (set the cell, then schedule the auto-save), as in the contract's harness.
import { dutyGridCellKey } from '../../cell-key';
import type { WeekNo } from '../../types';
import { FakeScheduleServer, labelKey, short } from './fake-server';

export interface ScenarioClock {
  /** Absolute virtual time in ms (what Date.now() returns inside the target). */
  now(): number;
  /** Runs every timer due up to `abs` (inclusive) and lets pending promise callbacks settle. */
  advanceTo(abs: number): Promise<void>;
  setTimeout(fn: () => void, ms: number): unknown;
}

export interface Issue9Page {
  edit(key: string, value: string): void;
  switchWeek(weekNo: WeekNo): void;
  /** The unsaved flag the target shows for the week on screen. */
  hasUnsaved(): boolean;
  statusText(): string;
  /** Value of a cell in the week on screen, as the target holds it in memory. */
  cell(key: string): string | undefined;
  close(): void;
}

export interface Issue9Target {
  name: string;
  clock: ScenarioClock;
  /** Opens week 1 hydrated from the server with polling started, and returns once the page is idle. Time must not move. */
  open(server: FakeScheduleServer): Promise<Issue9Page>;
}

export interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

export interface ScenarioResult {
  id: string;
  title: string;
  checks: Check[];
  log: string[];
}

export interface Scenario {
  id: string;
  title: string;
  run(target: Issue9Target): Promise<ScenarioResult>;
}

export const SCENARIO_EPOCH = Date.UTC(2026, 6, 6, 1, 0, 0); // 2026-07-06 09:00 Taipei

export const X = labelKey(dutyGridCellKey(1, '新北高中', 'lifeguard', 1, 3), 'X');
export const Y = labelKey(dutyGridCellKey(1, '新北高中', 'lifeguard', 1, 4), 'Y');
export const Z = labelKey(dutyGridCellKey(1, '新北高中', 'lifeguard', 1, 5), 'Z');
const KEYS = [X, Y, Z];

const iso = (ms: number) => new Date(ms).toISOString();

interface Ctx {
  target: Issue9Target;
  server: FakeScheduleServer;
  page: Issue9Page;
  t0: number;
  checks: Check[];
  at(t: number): Promise<void>;
  snapshot(label: string): void;
  check(name: string, pass: boolean, detail: string): void;
  reload(): Promise<Issue9Page>;
}

async function openWithoutDelay(target: Issue9Target, server: FakeScheduleServer): Promise<Issue9Page> {
  const get = server.getDelay;
  server.getDelay = () => 0;
  try {
    return await target.open(server);
  } finally {
    server.getDelay = get;
  }
}

async function start(target: Issue9Target, seed: (server: FakeScheduleServer, t0: number) => void): Promise<Ctx> {
  const server = new FakeScheduleServer(target.clock);
  const t0 = target.clock.now();
  server.startAt(t0);
  seed(server, t0);
  const page = await openWithoutDelay(target, server);
  if (target.clock.now() !== t0) throw new Error(`${target.name}: opening the page moved the clock`);
  const checks: Check[] = [];
  const ctx: Ctx = {
    target,
    server,
    page,
    t0,
    checks,
    at: t => target.clock.advanceTo(t0 + t),
    snapshot: label => {
      const local: Record<string, string> = {};
      KEYS.forEach(k => {
        const v = ctx.page.cell(k);
        if (v !== undefined) local[short(k)] = v;
      });
      const w1 = Object.entries(server.cells(1))
        .filter(([k]) => KEYS.includes(k))
        .map(([k, v]) => `${short(k)}=${v}`);
      server.log.push(`t=${server.rel()}ms SNAPSHOT ${label}: dirty=${ctx.page.hasUnsaved()} status="${ctx.page.statusText()}" local=${JSON.stringify(local)} server.w1=${JSON.stringify(w1)}`);
    },
    check: (name, pass, detail) => {
      checks.push({ name, pass, detail });
      server.log.push(`t=${server.rel()}ms CHECK ${pass ? 'PASS' : 'FAIL'} ${name} — ${detail}`);
    },
    reload: async () => {
      ctx.page.close();
      const fresh = await openWithoutDelay(target, server);
      server.log.push(`t=${server.rel()}ms RELOAD (fresh page loads server.w1)`);
      return fresh;
    },
  };
  return ctx;
}

function finish(id: string, title: string, ctx: Ctx): ScenarioResult {
  ctx.page.close();
  return { id, title, checks: ctx.checks, log: ctx.server.log };
}

/** Steps shared by scenarios 1 and 2: Y=A at t=0, POST#1 takes 2000ms, Z=B at t=1500 while POST#1 is in flight. */
async function editWhileSaving(target: Issue9Target): Promise<Ctx> {
  const ctx = await start(target, (s, t0) => s.seed(1, { [X]: 'old' }, iso(t0 - 120_000)));
  ctx.server.postDelay = () => 2000;
  ctx.page.edit(Y, 'A');
  await ctx.at(1500);
  ctx.page.edit(Z, 'B');
  await ctx.at(2400);
  ctx.snapshot('autosave timer for B fired while POST#1 in flight');
  await ctx.at(2900);
  ctx.snapshot('POST#1 returned');
  return ctx;
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'S1',
    title: '劇本 1：舊請求完成不得清掉新修改的未存旗標',
    async run(target) {
      const ctx = await editWhileSaving(target);
      const unsaved = ctx.page.hasUnsaved();
      const status = ctx.page.statusText();
      ctx.check('t=2900 hasUnsaved 仍是 true', unsaved, `hasUnsaved=${unsaved}`);
      ctx.check('t=2900 狀態不顯示「已儲存」', !status.includes('已儲存'), `status="${status}"`);
      return finish('S1', this.title, ctx);
    },
  },
  {
    id: 'S2',
    title: '劇本 2：A 在途時改 B，之後必須再存 B，重整仍保留 B',
    async run(target) {
      const ctx = await editWhileSaving(target);
      await ctx.at(4900);
      const z = ctx.server.cells(1)[Z];
      ctx.check('t=4900 伺服器已有 Z=B', z === 'B', `server Z=${JSON.stringify(z)}`);
      await ctx.at(20_000);
      ctx.snapshot('after 20s (no more edits)');
      ctx.page = await ctx.reload();
      const y = ctx.page.cell(Y);
      const zz = ctx.page.cell(Z);
      ctx.check('重整後 Y=A、Z=B 都在', y === 'A' && zz === 'B', `reloaded Y=${JSON.stringify(y)} Z=${JSON.stringify(zz)}`);
      return finish('S2', this.title, ctx);
    },
  },
  {
    id: 'S3',
    title: '劇本 3：背景同步不得覆蓋尚未保存的本地修改',
    async run(target) {
      const ctx = await start(target, (s, t0) => s.seed(1, { [X]: 'old' }, iso(t0 - 120_000)));
      ctx.server.seed(1, { [X]: 'other-device' }, iso(ctx.t0 - 60_000));
      ctx.server.log.push(`t=0ms another admin saved week 1 (X=other-device, updatedAt 60s newer than this page)`);
      ctx.server.getDelay = () => 1000;
      await ctx.at(8500);
      ctx.page.edit(Z, 'C');
      await ctx.at(9000);
      ctx.snapshot('poll GET returned');
      const z = ctx.page.cell(Z);
      const unsaved = ctx.page.hasUnsaved();
      ctx.check('t=9000 本機 Z=C 保留', z === 'C', `local Z=${JSON.stringify(z)}`);
      ctx.check('t=9000 Z=C 仍標為未存', unsaved, `hasUnsaved=${unsaved}`);
      await ctx.at(9700);
      ctx.snapshot('autosave for Z returned');
      const w1 = ctx.server.cells(1);
      ctx.check('t=9700 伺服器同時有 X=other-device 與 Z=C', w1[X] === 'other-device' && w1[Z] === 'C', `server X=${JSON.stringify(w1[X])} Z=${JSON.stringify(w1[Z])}`);
      return finish('S3', this.title, ctx);
    },
  },
  {
    id: 'S4',
    title: '劇本 4：存檔剛回來、下一筆還沒送時切週，B 不得遺失、第 2 週不得被寫入',
    async run(target) {
      const ctx = await start(target, (s, t0) => s.seed(1, { [X]: 'old' }, iso(t0 - 120_000)));
      ctx.server.postDelay = () => 1500;
      ctx.page.edit(Y, 'A');
      await ctx.at(2000);
      ctx.page.edit(Z, 'B');
      await ctx.at(2400);
      ctx.snapshot('POST#1 returned, B not yet sent');
      await ctx.at(2500);
      ctx.page.switchWeek(2);
      await ctx.at(6000);
      ctx.snapshot('3.5s after switching to week 2');
      const z = ctx.server.cells(1)[Z];
      ctx.check('第 1 週伺服器有 Z=B', z === 'B', `server w1 Z=${JSON.stringify(z)}`);
      const week2 = ctx.server.posts.filter(p => p.weekNo === 2);
      ctx.check('第 2 週沒有編輯，不得送出 POST', week2.length === 0, `week-2 POSTs: ${week2.map(p => `#${p.no} at t=${p.sentAt}ms with ${p.keys.length} cells`).join(', ') || 'none'}`);
      const wrongWeek = ctx.server.posts.filter(p => p.keys.some(k => !k.startsWith(`w${p.weekNo}-`)));
      ctx.check('每筆 POST 的格子都屬於它自己的週次', wrongWeek.length === 0, `mismatched: ${wrongWeek.map(p => `#${p.no}`).join(', ') || 'none'}`);
      return finish('S4', this.title, ctx);
    },
  },
];

export function passed(result: ScenarioResult): boolean {
  return result.checks.length > 0 && result.checks.every(c => c.pass);
}

export function failedChecks(result: ScenarioResult): string[] {
  return result.checks.filter(c => !c.pass).map(c => `${c.name} (${c.detail})`);
}
