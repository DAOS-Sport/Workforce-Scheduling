/* Round-trip 安全驗證：refreshInlineEmployeeStatusText 會改寫格子文字並寫回
   scheduleState，所以「重組後再解析」必須與「原文解析」逐欄相同，否則就是
   在把班表資料改壞。這裡用 dev DB 的真實班表文字全量比對。 */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const { Pool } = require('pg');

const html = fs.readFileSync('client/public/admin/summer-schedule-v40.html', 'utf8');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  const emps = (await pool.query(
    'select id,name,role,line_id from employees where name is not null')).rows
    .map(r => ({ id: r.id, name: r.name, role: r.role, lineBound: !!r.line_id }));

  const weeks = (await pool.query('select week_no, raw_entries from summer_schedule_assignments')).rows;
  await pool.end();

  const reply = (d) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(d), text: () => Promise.resolve('') });
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://localhost/admin/summer-schedule-v40.html',
    beforeParse(win) {
      win.fetch = (u) => {
        u = String(u);
        if (u.includes('/api/admin/me')) return reply({ ok: true, id: 1, name: 't' });
        if (u.includes('summer-employees')) return reply({ items: emps });
        return reply({});
      };
      win.alert = () => {}; win.scrollTo = () => {};
      win.requestAnimationFrame = (f) => setTimeout(f, 0);
      if (!win.CSS) win.CSS = {};
      if (!win.CSS.escape) win.CSS.escape = (s) => String(s).replace(/[^\w-]/g, (c) => '\\' + c);
    },
  });
  const win = dom.window;
  await new Promise(r => setTimeout(r, 4000));

  const week = { activeWeekdays: [1, 2, 3, 4, 5], no: 6, start: '2026-08-03', end: '2026-08-09' };
  const byName = new Map(emps.map(e => [String(e.name).trim(), e]));

  // 複製 refreshInlineEmployeeStatusText 的重組規則（同一個 splitCoachLineParts）
  const rebuildLine = (line) => {
    const p = win.splitCoachLineParts(line);
    if (!p.name) return line;
    const emp = byName.get(p.name);
    if (!emp) return line;
    const rebuilt = `${p.marker}${emp.name}${p.follow ? '跟課' : ''}${p.days}${emp.lineBound ? '' : '（未綁定）'}`;
    const chk = win.splitCoachLineParts(rebuilt);
    if (chk.marker !== p.marker || chk.name !== p.name || chk.days !== p.days || chk.follow !== p.follow) return line;
    return rebuilt;
  };

  const sig = (line) => JSON.stringify(
    win.parseAssignments(line, 'weekday', week, '')
       .map(a => ({ n: a.name, r: a.coachRole, f: !!a.follow, d: (a.days || []).slice().sort() })));

  let total = 0, changed = 0, recognized = 0;
  const broken = [];
  for (const w of weeks) {
    for (const e of (w.raw_entries || [])) {
      const v = String(e.value || '');
      if (!v.trim()) continue;
      for (const line of v.split(/\n+/).map(s => s.trim()).filter(Boolean)) {
        total++;
        const rebuilt = rebuildLine(line);
        if (rebuilt !== line) changed++;
        if (rebuilt !== line) recognized++;
        const a = sig(line), b = sig(rebuilt);
        if (a !== b) broken.push({ week: w.week_no, line, rebuilt, before: a, after: b });
      }
    }
  }

  console.log(`掃描 ${total} 行（week ${weeks.map(w => w.week_no).join('/')}）`);
  console.log(`  被識別並重寫：${recognized} 行`);
  console.log(`  解析結果不一致：${broken.length} 行`);
  if (broken.length) {
    broken.slice(0, 10).forEach(b => {
      console.log(`\n  !! w${b.week}  "${b.line}"  ->  "${b.rebuilt}"`);
      console.log(`     before ${b.before}`);
      console.log(`     after  ${b.after}`);
    });
  }

  // 針對性檢查：帶前綴/星期的寫法
  console.log('\n--- 指標案例 ---');
  [['a莊子鋐1234', 'a', '莊子鋐', '1234', false],
   ['a宿蘊涵2345', 'a', '宿蘊涵', '2345', false],
   ['*蔡霆諺', '*', '蔡霆諺', '', false],
   ['熊韋程', '', '熊韋程', '', false],
   ['Anna陳美', '', 'Anna陳美', '', false],
   ['*莊柏彥*劉承翰', '*', '莊柏彥*劉承翰', '', false],
   // 跟課：姓名必須歸戶到本人，不能整串變成一個對不到名冊的新名字
   ['侯凱捷跟課', '', '侯凱捷', '', true],
   ['許和喆跟課', '', '許和喆', '', true],
   ['侯凱捷跟課1234', '', '侯凱捷', '1234', true]].forEach(([ln, mk, nm, dy, fl]) => {
    const p = win.splitCoachLineParts(ln);
    const ok = p.marker === mk && p.name === nm && p.days === dy && !!p.follow === fl;
    console.log(`  ${ok ? 'OK ' : '!! '}"${ln}" -> marker=${JSON.stringify(p.marker)} name=${JSON.stringify(p.name)} days=${JSON.stringify(p.days)} follow=${!!p.follow}`);
  });

  // 跟課要成為角色，而且姓名要跟本人是同一個 key
  console.log('\n--- 跟課角色 ---');
  [['侯凱捷跟課', '跟課', '侯凱捷'],
   ['侯凱捷', '教練', '侯凱捷'],
   ['a侯凱捷跟課', '助教', '侯凱捷'],
   ['*侯凱捷跟課', '當班下', '侯凱捷']].forEach(([ln, role, nm]) => {
    const r = win.parseAssignments(ln, 'weekday', week, '')[0];
    const ok = r && r.coachRole === role && r.name === nm;
    console.log(`  ${ok ? 'OK ' : '!! '}"${ln}" -> name=${r ? r.name : '(無)'} role=${r ? r.coachRole : '(無)'}`);
  });

  console.log('\n' + '='.repeat(60));
  console.log(broken.length ? `!! ${broken.length} 行解析結果被改變，不可上線` : '全部 round-trip 一致，資料不會被改壞');
  process.exit(broken.length ? 1 : 0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
