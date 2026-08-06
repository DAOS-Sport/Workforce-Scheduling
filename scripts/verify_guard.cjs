/* 資料遺失防護驗證：三個場景，確認設定不會被空值覆寫、班表路徑未受影響。 */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const SRC = 'client/public/admin/summer-schedule-v40.html';
const html = fs.readFileSync(SRC, 'utf8');
const CFG = '/api/system-config/summer-payroll-config-v1';

const results = [];
function check(name, got, want) {
  const ok = String(got) === String(want);
  results.push(ok);
  console.log(`${ok ? 'OK ' : '!! '}${name}\n     got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
}

/** configReply: 針對 system-config 的回應（null = 模擬 500 失敗） */
function boot(configReply) {
  const posts = [];
  const reply = (data) => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://localhost/admin/summer-schedule-v40.html',
    beforeParse(win) {
      win.fetch = (url, opts) => {
        const u = String(url);
        if (u.includes('system-config')) {
          if (opts && opts.method === 'POST') {
            posts.push(JSON.parse(opts.body).value);
            return reply({ ok: true });
          }
          if (configReply === null) {
            return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}), text: () => Promise.resolve('') });
          }
          return reply(configReply);
        }
        if (u.includes('/api/admin/me')) return reply({ ok: true, id: 1, name: 't', role: 'admin' });
        if (u.includes('summer-employees')) return reply({ items: [] });
        if (u.includes('salary-rates')) return reply([]);
        return reply({});
      };
      win.alert = () => {};
      win.scrollTo = () => {};
      win.requestAnimationFrame = (fn) => setTimeout(fn, 0);
      if (!win.CSS) win.CSS = {};
      if (!win.CSS.escape) win.CSS.escape = (s) => String(s).replace(/[^\w-]/g, (c) => '\\' + c);
    },
  });
  return { win: dom.window, posts };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // ============ 場景 1：後端載入失敗 → 一律不准寫回，避免蓋掉別人的設定 ============
  console.log('--- 場景 1：後端載入失敗（500）---');
  {
    const { win, posts } = boot(null);
    await wait(3500);
    await win.pvLoadConfigFromServer();
    win.renderPayrollReport();
    const h = win.document.getElementById('pvh_4');
    h.value = '1';
    win.pvSaveTypeRates();
    await wait(1500);
    check('載入失敗時不得 POST（否則會清空他人設定）', posts.length, 0);
    check('狀態列有提示使用者', /暫不儲存/.test(win.document.getElementById('pvConfigStatus').textContent), true);
  }

  // ============ 場景 2：後端已有設定 → 改費率不得清掉 typeOverrides ============
  console.log('\n--- 場景 2：後端已有 20 筆分類指定 ---');
  {
    const existing = {
      hours: { '球類課程': '1.5' },
      rates: { '球類課程|教練': '500' },
      mult: { '當班下': '0.3', '助教': '0.4' },
      typeOverrides: { '樂獅-籃球': '補習班課程', '加洲森林-棒球': '補習班課程' },
    };
    const { win, posts } = boot({ key: 'summer-payroll-config-v1', value: JSON.stringify(existing) });
    await wait(3500);
    const loaded = await win.pvLoadConfigFromServer();
    check('後端設定載入成功', loaded, true);
    check('分類指定生效：樂獅-籃球 → 補習班課程',
      win.classifyCourseType({ courseName: '樂獅-籃球', startTime: '15:00', endTime: '16:00' }), '補習班課程');
    check('費率有回填', win.document.getElementById('pvr_4_0').value, '500');

    win.renderPayrollReport();
    win.document.getElementById('pvh_4').value = '1';
    win.pvSaveTypeRates();
    await wait(1500);
    check('改費率後有 POST', posts.length > 0, true);
    const sent = JSON.parse(posts[posts.length - 1]);
    check('POST 仍帶著原有的 2 筆分類指定（沒被清空）',
      Object.keys(sent.typeOverrides || {}).length, 2);
    check('POST 帶著新的時數值', sent.hours['球類課程'], '1');
    check('改時數後分類指定仍在記憶體生效',
      win.classifyCourseType({ courseName: '加洲森林-棒球', startTime: '15:00', endTime: '16:00' }), '補習班課程');
  }

  // ============ 場景 3：後端尚無設定（第一次使用）→ 必須存得進去 ============
  console.log('\n--- 場景 3：後端尚無設定（第一次使用）---');
  {
    const { win, posts } = boot({});
    await wait(3500);
    await win.pvLoadConfigFromServer();
    win.renderPayrollReport();
    win.document.getElementById('pvh_4').value = '1';
    win.pvSaveTypeRates();
    await wait(1500);
    check('第一次使用可以存進後端', posts.length > 0, true);

    // 班表路徑未受影響
    ['collectSchedulePayload', 'collectNormalizedAssignments', 'setCellValue', 'getSaved',
     'saveToServer', 'publishToEmployeePortal', 'render'].forEach((fn) =>
      check(`班表函式 ${fn} 未受影響`, typeof win[fn], 'function'));
    let payloadOk = true;
    try { win.collectSchedulePayload(); } catch (e) { payloadOk = e.message; }
    check('collectSchedulePayload 仍可執行', payloadOk, true);
  }

  const bad = results.filter((r) => !r).length;
  console.log('='.repeat(62));
  console.log(bad ? `!! ${bad} / ${results.length} 項失敗` : `全部 ${results.length} 項通過`);
  process.exit(bad ? 1 : 0);
})();
