// The React side of the issue #9 scenarios: the draft store wired to the fake server through api.ts.
// Payloads are built by payload.ts from the snapshot, with an empty roster and no enrollment, like a page that has
// only loaded the draft.
import { createScheduleApi } from '../../api';
import { createDraftStore, hasUnsaved, saveStatus, snapshotPayloadBuilder, viewDraft, type DraftStore, type StoreTimers } from '../../draft-store';
import type { WeekNo } from '../../types';
import type { FakeScheduleServer } from './fake-server';
import type { Issue9Page, Issue9Target, ScenarioClock } from './scenarios';

export const EMPTY_CONTEXT = { employees: [], aliases: {}, manualCourses: [], enrollment: { kind: 'loading' } } as const;

export function storeOn(server: FakeScheduleServer, timers?: StoreTimers): DraftStore {
  return createDraftStore({
    api: createScheduleApi(server.fetch),
    buildPayload: snapshotPayloadBuilder(() => EMPTY_CONTEXT),
    timers,
    initialWeek: 1,
  });
}

export function pageFor(store: DraftStore): Issue9Page {
  return {
    edit: (key, value) => store.edit(store.getState().currentWeek, key, value),
    switchWeek: (weekNo: WeekNo) => {
      void store.open(weekNo);
    },
    hasUnsaved: () => hasUnsaved(store.week()),
    statusText: () => saveStatus(store.week()).text,
    cell: key => viewDraft(store.week()).cells.get(key),
    close: () => store.dispose(),
  };
}

/** `timersFor` gives each opened store its own timers; omit it to use the global (possibly faked) timers. */
export function reactTarget(clock: ScenarioClock, timersFor?: (owner: string) => StoreTimers): Issue9Target {
  let opened = 0;
  return {
    name: 'react draft-store',
    clock,
    async open(server) {
      const store = storeOn(server, timersFor?.(`store-${++opened}`));
      store.startPolling();
      const loaded = store.open(1);
      await clock.advanceTo(clock.now());
      await loaded;
      return pageFor(store);
    },
  };
}
