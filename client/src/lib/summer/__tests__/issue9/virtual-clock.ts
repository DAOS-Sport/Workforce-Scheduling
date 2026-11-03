// Deterministic clock for running the v40 page (jsdom) and the draft store side by side outside vitest.
// Timers fire in due-time order; between timers every pending promise callback runs, so a fetch that resolves
// inside a timer is fully handled before the next timer fires.
import type { ScenarioClock } from './scenarios';

interface Timer {
  id: number;
  at: number;
  seq: number;
  fn: () => void;
  every: number | null;
  owner: string;
}

const drainPromises = async () => {
  for (let i = 0; i < 20; i++) await new Promise<void>(r => setImmediate(r));
};

export class VirtualClock implements ScenarioClock {
  private t: number;
  private seq = 0;
  private nextId = 1;
  private readonly timers = new Map<number, Timer>();

  constructor(start: number) {
    this.t = start;
  }

  now = (): number => this.t;

  private add(fn: () => void, ms: number, every: boolean, owner: string): number {
    const id = this.nextId++;
    const delay = Math.max(0, Number(ms) || 0);
    this.timers.set(id, { id, at: this.t + delay, seq: this.seq++, fn, every: every ? Math.max(1, delay) : null, owner });
    return id;
  }

  /** Timer functions tagged with an owner, so closing a page cancels everything it scheduled. */
  timersFor(owner: string) {
    return {
      setTimeout: (fn: () => void, ms = 0) => this.add(fn, ms, false, owner),
      setInterval: (fn: () => void, ms = 0) => this.add(fn, ms, true, owner),
      clearTimeout: (id: unknown) => {
        this.timers.delete(Number(id));
      },
      clearInterval: (id: unknown) => {
        this.timers.delete(Number(id));
      },
      now: this.now,
    };
  }

  setTimeout = (fn: () => void, ms: number): number => this.add(fn, ms, false, 'shared');

  dropOwner(owner: string): void {
    this.timers.forEach((t, id) => {
      if (t.owner === owner) this.timers.delete(id);
    });
  }

  async advanceTo(abs: number): Promise<void> {
    if (abs < this.t) throw new Error(`clock cannot go back from ${this.t} to ${abs}`);
    for (let guard = 0; ; guard++) {
      if (guard > 100_000) throw new Error('timer loop does not settle');
      await drainPromises();
      let due: Timer | null = null;
      for (const t of Array.from(this.timers.values())) {
        if (t.at <= abs && (!due || t.at < due.at || (t.at === due.at && t.seq < due.seq))) due = t;
      }
      if (!due) break;
      this.t = due.at;
      if (due.every === null) this.timers.delete(due.id);
      else this.timers.set(due.id, { ...due, at: due.at + due.every, seq: this.seq++ });
      due.fn();
    }
    this.t = abs;
    await drainPromises();
  }
}
