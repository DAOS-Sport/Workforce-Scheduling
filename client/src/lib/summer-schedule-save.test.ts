// @vitest-environment node
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";

const html = readFileSync("client/public/admin/summer-schedule-v40.html", "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
const pages: JSDOM[] = [];
const version = (n: number) => new Date(Date.UTC(2026, 6, 1, 0, 0, n)).toISOString();
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const response = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => ({ data }) });

function page(fetch: ReturnType<typeof vi.fn>) {
  const dom = new JSDOM(html, { url: "http://localhost/admin/summer-schedule-v40.html", runScripts: "outside-only" });
  pages.push(dom);
  const w = dom.window as any;
  w.fetch = fetch;
  w.alert = vi.fn();
  w.console.warn = vi.fn();
  // Execute the actual old page. Only unrelated rendering/assignment parsing is stubbed;
  // save, dirty tracking, hydration, polling and DOM input binding run unchanged.
  w.eval(script + "\nwindow.__run = code => eval(code);");
  w.document.removeEventListener("DOMContentLoaded", w.bootSummerScheduleV40);
  w.__run(`
    document.getElementById('weekSelect').innerHTML='<option value="0">Week 1</option><option value="1">Week 2</option>';
    render=()=>{}; loadManualCoursesForWeek=async()=>false;
    refreshEmployeeChips=()=>{}; validateAll=()=>{};
    shouldBlockProtectedEmptySave=()=>false;
    scheduleState={weekNo:1,cells:new Map(),meta:new Map(),loaded:true,updatedAt:0};
    document.body.insertAdjacentHTML('beforeend','<div contenteditable="true" data-key="w1-test-note"></div>');
    bindAutoSave();
  `);
  const cell = w.document.querySelector('[data-key="w1-test-note"]') as HTMLElement;
  Object.defineProperty(cell, "offsetParent", { get: () => w.document.body });
  const edit = (value: string) => {
    cell.textContent = value;
    cell.dispatchEvent(new w.Event("input", { bubbles: true }));
  };
  return { w, edit, eval: (code: string) => w.__run(code) };
}

afterEach(() => { pages.splice(0).forEach((p) => p.window.close()); vi.restoreAllMocks(); });

describe("old v40 page save (#9 / F19)", () => {
  it("saves B after A in flight, keeps dirty until B is read back, and reloads B", async () => {
    const a = deferred<any>(), b = deferred<any>();
    const posts: any[] = [];
    let stored: any = { updatedAt: null, rawEntries: [] };
    const fetch = vi.fn(async (_url: string, options?: any) => {
      if (options?.method === "POST") {
        const payload = JSON.parse(options.body);
        posts.push(payload);
        const index = posts.length;
        await (index === 1 ? a.promise : b.promise);
        stored = { ...payload, updatedAt: version(index) };
        return response({ updatedAt: stored.updatedAt });
      }
      return response(stored);
    });
    const p = page(fetch);
    p.edit("A");
    const saving = p.w.saveToServer();
    p.edit("B");
    p.eval("clearTimeout(_autoSaveTimer)"); // B's debounce may already have fired while A is still in flight.
    let waitingDone = false;
    const waiting = p.w.saveToServer().then(() => { waitingDone = true; });
    a.resolve(undefined);
    await vi.waitFor(() => expect(posts).toHaveLength(2));
    expect(p.eval("hasUnsavedChanges()")).toBe(true);
    expect(waitingDone).toBe(false); // another caller must wait for the entire drain, including B
    expect(posts[1].rawEntries[0].value).toBe("B");
    expect(posts[1].expectedUpdatedAt).toBe(version(1));
    b.resolve(undefined);
    await saving;
    await waiting;
    expect(p.eval("hasUnsavedChanges()")).toBe(false);
    expect(p.w.document.getElementById("syncStatus")?.textContent).toContain("已儲存");
    const reload = page(fetch);
    reload.eval("resetScheduleState(1)");
    await reload.w.loadExistingScheduleAssignments();
    expect(reload.eval("scheduleState.cells.get('w1-test-note')")).toBe("B");
  });

  it("does not apply a poll response when input arrived during the request", async () => {
    const remote = deferred<any>();
    const p = page(vi.fn(() => remote.promise));
    let poll!: () => Promise<void>;
    p.w.setInterval = ((fn: () => Promise<void>) => { poll = fn; return 1; }) as any;
    p.w.startSyncPolling();
    const polling = poll();
    p.edit("local B");
    remote.resolve(response({ updatedAt: version(9), rawEntries: [{ key: "w1-test-note", value: "remote A" }] }));
    await polling;
    expect(p.eval("scheduleState.cells.get('w1-test-note')")).toBe("local B");
    expect(p.eval("hasUnsavedChanges()")).toBe(true);
  });

  it("does not hydrate over an edit made while initial load is in flight", async () => {
    const remote = deferred<any>();
    const p = page(vi.fn((url: string, options?: any) => {
      if (url.endsWith("schedule-save-events")) return Promise.resolve(response({}));
      return options?.method === "POST" ? Promise.resolve(response({}, 409)) : remote.promise;
    }));
    p.eval("resetScheduleState(1)");
    const loading = p.w.loadExistingScheduleAssignments();
    p.edit("local B");
    remote.resolve(response({ updatedAt: version(9), rawEntries: [{ key: "w1-test-note", value: "remote A" }] }));
    await loading;
    expect(p.eval("scheduleState.cells.get('w1-test-note')")).toBe("local B");
    expect(p.eval("hasUnsavedChanges()")).toBe(true);
    await p.w.saveToServer();
    expect(p.w.document.getElementById("syncStatus").textContent).toContain("儲存衝突");
    expect(p.eval("_saveRetryTimer")).toBe(null);
    expect(p.eval("scheduleState.cells.get('w1-test-note')")).toBe("local B");
  });

  it("keeps dirty and reports a readback version mismatch", async () => {
    const fetch = vi.fn(async (url: string, options?: any) => {
      if (url.endsWith("schedule-save-events")) return response({});
      return response({ updatedAt: version(options?.method === "POST" ? 1 : 2) });
    });
    const p = page(fetch);
    p.edit("B");
    await p.w.saveToServer();
    expect(p.eval("hasUnsavedChanges()")).toBe(true);
    expect(fetch.mock.calls.some(([url, opts]) => url.endsWith("schedule-save-events") && JSON.parse(opts.body).event === "readback_mismatch")).toBe(true);
  });

  it("reports a failed save and an unsaved page exit without sending cell content", async () => {
    const fetch = vi.fn(async (url: string, _options?: any) => response({}, url.endsWith("schedule-save-events") ? 200 : 500));
    const p = page(fetch);
    p.edit("fictional note");
    await p.w.saveToServer();
    p.w.dispatchEvent(new p.w.Event("pagehide"));
    const events = fetch.mock.calls.filter(([url]) => url.endsWith("schedule-save-events")).map(([, opts]) => JSON.parse(opts.body));
    expect(events).toEqual([{ event: "save_failed" }, { event: "unsaved_exit" }]);
    expect(p.eval("hasUnsavedChanges()")).toBe(true);
  });

  it("stores notes, hidden cells and employee metadata using the existing rawEntries contract", async () => {
    let stored: any;
    const fetch = vi.fn(async (_url: string, options?: any) => {
      if (options?.method === "POST") stored = { ...JSON.parse(options.body), updatedAt: version(1) };
      return response(stored);
    });
    const p = page(fetch);
    p.edit("fictional note");
    p.eval(`setCellValue('w1-hidden-note','hidden note'); saveEmployeeMeta('w1-test-note',[{id:123,name:'測試教練',role:'教練'}])`);
    await p.w.saveToServer();
    expect(stored.rawEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "w1-test-note", value: "fictional note", employees: [expect.objectContaining({ employeeId: 123, employeeName: "測試教練" })] }),
      expect.objectContaining({ key: "w1-hidden-note", value: "hidden note" }),
    ]));
    const reload = page(fetch);
    reload.eval("resetScheduleState(1)");
    await reload.w.loadExistingScheduleAssignments();
    expect(reload.eval("scheduleState.cells.get('w1-hidden-note')")).toBe("hidden note");
    expect(reload.eval("getEmployeeMeta('w1-test-note')[0].employeeId")).toBe(123);
  });

  it("does not apply a stale response after a local edit was saved during the poll", async () => {
    const old = deferred<any>();
    let calls = 0, stored: any;
    const p = page(vi.fn(async (_url: string, options?: any) => {
      if (++calls === 1) return old.promise;
      if (options?.method === "POST") stored = { ...JSON.parse(options.body), updatedAt: version(2) };
      return response(stored);
    }));
    let poll!: () => Promise<void>;
    p.w.setInterval = ((fn: () => Promise<void>) => { poll = fn; return 1; }) as any;
    p.w.startSyncPolling();
    const polling = poll();
    p.edit("B");
    await p.w.saveToServer();
    old.resolve(response({ updatedAt: version(9), rawEntries: [{ key: "w1-test-note", value: "stale A" }] }));
    await polling;
    expect(p.eval("scheduleState.cells.get('w1-test-note')")).toBe("B");
  });

  it("keeps the old week and its draft when saving before a week change fails", async () => {
    const p = page(vi.fn(async (url: string) => response({}, url.endsWith("schedule-save-events") ? 200 : 500)));
    p.eval(`
      ensureAdminLoggedIn=async()=>true; purgeLegacyStorageOnce=()=>{}; initWeeks=()=>{};
      loadEmployeesForSchedule=async()=>{}; fetchPublishedDutyShifts=()=>{};
      buildAvailabilityPage=()=>{}; renderAvailabilityReport=()=>{};
      renderPayrollReport=()=>{}; loadBackendPayrollRates=async()=>{}; startSyncPolling=()=>{};
    `);
    await p.w.bootSummerScheduleV40();
    p.edit("B");
    const select = p.w.document.getElementById("weekSelect");
    select.value = "1";
    select.dispatchEvent(new p.w.Event("change"));
    await vi.waitFor(() => expect(p.w.document.getElementById("syncStatus").textContent).toContain("儲存失敗"));
    expect(select.value).toBe("0");
    expect(p.eval("scheduleState.cells.get('w1-test-note')")).toBe("B");
    expect(p.eval("hasUnsavedChanges()")).toBe(true);
  });

  it("uses the server version when a saved empty draft is loaded before editing", async () => {
    let stored: any = { updatedAt: version(1), rawEntries: [] };
    const p = page(vi.fn(async (url: string, options?: any) => {
      if (url.endsWith("schedule-save-events")) return response({});
      if (options?.method === "POST") {
        const payload = JSON.parse(options.body);
        if (payload.expectedUpdatedAt !== stored.updatedAt) return response({}, 409);
        stored = { ...payload, updatedAt: version(2) };
      }
      return response(stored);
    }));
    p.eval("resetScheduleState(1)");
    await p.w.loadExistingScheduleAssignments();
    p.edit("B");
    await p.w.saveToServer();
    expect(p.eval("hasUnsavedChanges()")).toBe(false);
    expect(stored.rawEntries[0].value).toBe("B");
  });

  it("can retry with the acknowledged version when only the readback failed", async () => {
    let stored: any = { updatedAt: null, rawEntries: [] }, reads = 0, saves = 0;
    const p = page(vi.fn(async (url: string, options?: any) => {
      if (url.endsWith("schedule-save-events")) return response({});
      if (options?.method === "POST") {
        const payload = JSON.parse(options.body);
        if (payload.expectedUpdatedAt !== stored.updatedAt) return response({}, 409);
        stored = { ...payload, updatedAt: version(++saves) };
        return response(stored);
      }
      return ++reads === 1 ? response({}, 503) : response(stored);
    }));
    p.edit("B");
    await p.w.saveToServer();
    expect(p.eval("hasUnsavedChanges()")).toBe(true);
    await p.w.saveToServer();
    expect(p.eval("hasUnsavedChanges()")).toBe(false);
    expect(saves).toBe(2);
  });
});
