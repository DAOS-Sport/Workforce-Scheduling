const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML_PATH = path.resolve(__dirname, '../../client/public/admin/summer-schedule-v40.html');

process.env.TZ = 'Asia/Taipei';
if (new Date(2026, 6, 1).getTimezoneOffset() !== -480) {
  throw new Error('v40 date code uses the local time zone; this process could not switch to Asia/Taipei');
}

function innerTextOf(el) {
  let out = '';
  const hidden = n => n.classList && (n.classList.contains('id-hint') || n.classList.contains('force-badge'));
  const walk = n => {
    if (n.nodeType === 3) { out += n.data; return; }
    if (n.nodeType !== 1) return;
    const tag = n.tagName;
    if (tag === 'BR') { out += '\n'; return; }
    if (tag === 'STYLE' || tag === 'SCRIPT' || (n !== el && hidden(n))) return;
    const block = /^(DIV|P|LI|TR|TABLE|SECTION|ARTICLE|H[1-6])$/.test(tag);
    if (block && out && !out.endsWith('\n')) out += '\n';
    n.childNodes.forEach(walk);
    if (block && out && !out.endsWith('\n')) out += '\n';
  };
  walk(el);
  return out.replace(/^\n+|\n+$/g, '');
}

function installPolyfills(win) {
  Object.defineProperty(win.HTMLElement.prototype, 'innerText', {
    configurable: true,
    get() { return innerTextOf(this); },
    set(v) {
      this.textContent = '';
      String(v ?? '').split('\n').forEach((part, i) => {
        if (i) this.appendChild(this.ownerDocument.createElement('br'));
        if (part) this.appendChild(this.ownerDocument.createTextNode(part));
      });
    },
  });
  win.alert = msg => { win.__alerts.push(String(msg)); };
  win.confirm = () => true;
  win.scrollTo = () => {};
  if (!win.CSS) win.CSS = {};
  win.CSS.escape = s => String(s).replace(/[^\w-]/g, c => '\\' + c);
}

function weekParam(url) {
  const m = String(url).match(/[?&]weekNo=(\d+)/);
  return m ? Number(m[1]) : null;
}

function reply(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

function makeFetch(win, fx) {
  return (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    const u = String(url);
    win.__pending++;
    win.__requests.push(`${method} ${u}`);
    const respond = () => {
      if (method !== 'GET') {
        win.__posts.push({ url: u, body: opts.body ? JSON.parse(opts.body) : null });
        return reply(200, { data: { success: true, updatedAt: '2026-07-06T06:05:00.000Z' } });
      }
      const wk = weekParam(u);
      if (u.includes('/api/admin/me')) return reply(200, { id: 1 });
      if (u.includes('summer-employees')) return reply(200, { items: fx.employees || [] });
      if (u.includes('enrollment-counts')) {
        const e = fx.enrollment || { status: 200, items: [] };
        if (e.status !== 200) return reply(e.status, {});
        return reply(200, { data: { items: wk === fx.weekNo ? e.items : [], lastUpdated: e.lastUpdated || null, filters: { weekNo: wk } } });
      }
      if (u.includes('schedule-assignments')) {
        const rawEntries = wk === fx.weekNo ? fx.rawEntries || [] : [];
        return reply(200, { data: { version: 'v40', weekNo: wk, updatedAt: rawEntries.length ? '2026-07-06T06:00:00.000Z' : null, rawEntries, assignments: [], shifts: [] } });
      }
      if (u.includes('manual-schedule-courses')) return reply(200, { items: wk === fx.weekNo ? fx.manualCourses || [] : [] });
      if (u.includes('duty-shifts')) return reply(200, { data: { items: wk === fx.weekNo ? fx.dutyShifts || [] : [] } });
      if (u.includes('summer-availability')) return reply(200, { items: wk === fx.weekNo ? fx.availability || [] : [] });
      if (u.includes('salary-rates')) return reply(200, { items: fx.salaryRates || [] });
      if (u.includes('system-config')) return reply(200, { data: { value: fx.payrollConfig ? JSON.stringify(fx.payrollConfig) : null } });
      return reply(404, {});
    };
    return new Promise(resolve => {
      win.setTimeout(() => { win.__pending--; resolve(respond()); }, 0);
    });
  };
}

async function settle(win) {
  let quiet = 0;
  for (let i = 0; i < 400 && quiet < 5; i++) {
    await new Promise(r => setTimeout(r, 5));
    quiet = win.__pending === 0 ? quiet + 1 : 0;
  }
  if (win.__pending) throw new Error('v40 page did not settle');
}

const html = fs.readFileSync(HTML_PATH, 'utf8');

async function openV40(fx) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    virtualConsole: new VirtualConsole(),
    pretendToBeVisual: true,
    url: 'https://localhost/admin/summer-schedule-v40.html',
    beforeParse(win) {
      win.__pending = 0;
      win.__requests = [];
      win.__posts = [];
      win.__alerts = [];
      installPolyfills(win);
      win.fetch = makeFetch(win, fx);
    },
  });
  const win = dom.window;
  await settle(win);
  if (fx.weekNo && fx.weekNo !== 1) {
    const sel = win.document.getElementById('weekSelect');
    sel.value = String(fx.weekNo - 1);
    sel.dispatchEvent(new win.Event('change'));
    await settle(win);
  }
  win.eval('render()');
  await settle(win);
  return { dom, win, settle: () => settle(win), run: src => JSON.parse(JSON.stringify(win.eval(src)) ?? 'null'), close: () => dom.window.close() };
}

module.exports = { openV40, HTML_PATH };
