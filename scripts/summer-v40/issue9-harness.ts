// Runs the issue #9 scenarios (client/src/lib/summer/__tests__/issue9/scenarios.ts) against a target and prints the timeline.
//   npx tsx scripts/summer-v40/issue9-harness.ts            → the real v40 page in jsdom (expected: every scenario red)
//   npx tsx scripts/summer-v40/issue9-harness.ts --target=react → the React draft store on the same clock (expected: green)
// Exit code 1 when any check fails, so on v40 a non-zero exit is the expected "red".
//
// The v40 target loads client/public/admin/summer-schedule-v40.html unchanged: boot, render, hydration, saveToServer,
// scheduleAutoSave, startSyncPolling and the week <select> change handler are all the page's own code.
// Only the environment is replaced: timers and Date run on a virtual clock, fetch goes to a fake server
// (schedule-assignments and publish from fake-server.ts, every other endpoint answers empty at once).
// Edits call setCellValue + scheduleAutoSave, the employee picker / stage path (V024, V046). jsdom has no layout, so
// offsetParent is null and saveToServer's DOM flush (R096) never copies a box; the contract's harness has the same limit.
import { createRequire } from 'module';
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'fs';
import { FakeScheduleServer } from '../../client/src/lib/summer/__tests__/issue9/fake-server';
import { SCENARIOS, SCENARIO_EPOCH, failedChecks, passed, type Issue9Page, type Issue9Target } from '../../client/src/lib/summer/__tests__/issue9/scenarios';
import { VirtualClock } from '../../client/src/lib/summer/__tests__/issue9/virtual-clock';

const require = createRequire(import.meta.url);
const { HTML_PATH, installPolyfills } = require('./v40-page.cjs') as { HTML_PATH: string; installPolyfills: (win: unknown) => void };
const html = fs.readFileSync(HTML_PATH, 'utf8');

type Win = JSDOM['window'] & Record<string, any>;

function otherEndpoint(url: string): { status: number; body: unknown } {
  if (url.includes('/api/admin/me')) return { status: 200, body: { id: 1 } };
  if (url.includes('summer-employees')) return { status: 200, body: { items: [] } };
  if (url.includes('enrollment-counts')) return { status: 200, body: { data: { items: [], lastUpdated: null } } };
  if (url.includes('manual-schedule-courses')) return { status: 200, body: { items: [] } };
  if (url.includes('duty-shifts')) return { status: 200, body: { data: { items: [] } } };
  if (url.includes('summer-availability')) return { status: 200, body: { items: [] } };
  if (url.includes('salary-rates')) return { status: 200, body: { items: [] } };
  if (url.includes('system-config')) return { status: 200, body: { data: { value: null } } };
  return { status: 404, body: {} };
}

function v40Target(clock: VirtualClock): Issue9Target {
  let opened = 0;
  return {
    name: 'v40 page (client/public/admin/summer-schedule-v40.html)',
    clock,
    async open(server: FakeScheduleServer): Promise<Issue9Page> {
      const owner = `v40-${++opened}`;
      const timers = clock.timersFor(owner);
      const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        virtualConsole: new VirtualConsole(),
        url: 'https://localhost/admin/summer-schedule-v40.html',
        beforeParse(w) {
          const win = w as Win;
          win.__alerts = [];
          installPolyfills(win);
          const RealDate = win.Date as DateConstructor;
          class FakeDate extends RealDate {
            constructor(...args: unknown[]) {
              if (args.length === 0) super(clock.now());
              else super(...(args as [string]));
            }
            static now() {
              return clock.now();
            }
          }
          win.Date = FakeDate;
          win.setTimeout = timers.setTimeout;
          win.clearTimeout = timers.clearTimeout;
          win.setInterval = timers.setInterval;
          win.clearInterval = timers.clearInterval;
          win.requestAnimationFrame = (fn: () => void) => timers.setTimeout(fn, 0);
          win.fetch = (url: string, init?: { method?: string; body?: unknown }) => {
            const u = String(url);
            if (server.handles(u)) return server.fetch(u, init);
            const { status, body } = otherEndpoint(u);
            return new Promise(resolve => timers.setTimeout(() => resolve({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }), 0));
          };
        },
      });
      const win = dom.window as Win;
      await clock.advanceTo(clock.now());
      const loaded = win.eval('scheduleState.loaded && scheduleState.weekNo') as number | false;
      if (loaded !== 1) throw new Error(`v40 page did not hydrate week 1 (scheduleState.weekNo=${String(loaded)})`);
      const run = (src: string) => win.eval(src);
      return {
        edit: (key, value) => run(`setCellValue(${JSON.stringify(key)}, ${JSON.stringify(value)}); scheduleAutoSave();`),
        switchWeek: weekNo => {
          const sel = win.document.getElementById('weekSelect') as HTMLSelectElement;
          sel.value = String(weekNo - 1);
          sel.dispatchEvent(new win.Event('change'));
        },
        hasUnsaved: () => !!run('hasUnsavedChanges()'),
        statusText: () => win.document.getElementById('syncStatus')?.textContent ?? '',
        cell: key => run(`scheduleState.cells.get(${JSON.stringify(key)})`) as string | undefined,
        close: () => {
          clock.dropOwner(owner);
          win.close();
        },
      };
    },
  };
}

async function main() {
  const which = (process.argv.find(a => a.startsWith('--target=')) ?? '--target=v40').slice('--target='.length);
  let red = 0;
  for (const scenario of SCENARIOS) {
    const clock = new VirtualClock(SCENARIO_EPOCH);
    const target =
      which === 'react'
        ? (await import('../../client/src/lib/summer/__tests__/issue9/react-target')).reactTarget(clock, owner => clock.timersFor(owner))
        : v40Target(clock);
    const result = await scenario.run(target);
    const ok = passed(result);
    if (!ok) red++;
    console.log(`\n=== ${result.id} ${result.title} — ${target.name}: ${ok ? 'GREEN' : 'RED'}`);
    result.log.forEach(line => console.log(line));
    if (!ok) failedChecks(result).forEach(f => console.log(`  ✗ ${f}`));
  }
  console.log(`\n${which}: ${SCENARIOS.length - red}/${SCENARIOS.length} scenarios green, ${red} red`);
  process.exit(red ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(2);
});
