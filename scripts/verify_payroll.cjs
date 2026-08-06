/* jsdom 冒煙驗證：改動後頁面能載入、時數可覆寫、分類指定生效、角色欄存在。
   pvConfig / PV_TYPE_HOURS 是 let/const，不掛 window，所以一律從函式介面驗證。 */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const SRC = 'client/public/admin/summer-schedule-v40.html';
const html = fs.readFileSync(SRC, 'utf8');

const reply = (data) => Promise.resolve({
  ok: true, status: 200,
  json: () => Promise.resolve(data),
  text: () => Promise.resolve(JSON.stringify(data)),
});

const posted = [];
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'https://localhost/admin/summer-schedule-v40.html',
  beforeParse(win) {
    win.fetch = (url, opts) => {
      const u = String(url);
      if (opts && opts.method === 'POST') posted.push(u);
      if (u.includes('/api/admin/me')) return reply({ ok: true, id: 1, name: 'tester', role: 'admin' });
      if (u.includes('summer-employees')) return reply({ items: [] });
      if (u.includes('system-config')) return reply({});
      if (u.includes('salary-rates')) return reply([]);
      if (u.includes('manual-schedule-courses')) return reply({ items: [] });
      return reply({});
    };
    win.alert = () => {};
    win.scrollTo = () => {};
    win.requestAnimationFrame = (fn) => setTimeout(fn, 0);
    // jsdom 這版沒有 CSS.escape，既有的 getNeededNumber 會用到（與本次改動無關）
    if (!win.CSS) win.CSS = {};
    if (!win.CSS.escape) win.CSS.escape = (s) => String(s).replace(/[^\w-]/g, (ch) => '\\' + ch);
  },
});

const win = dom.window;
const results = [];
const check = (name, got, want) => {
  const ok = String(got) === String(want);
  results.push(ok);
  console.log(`${ok ? 'OK ' : '!! '}${name}\n     got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
};

setTimeout(() => {
  const errs = [];
  win.addEventListener('error', (e) => errs.push(e.message));

  // --- 0. 頁面存活 + 新函式就位 ---
  check('頁面未被登入畫面取代', !!win.document.getElementById('payrollView'), true);
  ['pvHoursOf', 'pvSetCourseTypeOverride', 'renderCourseTypeMap', 'pvLoadConfigFromServer',
   'pvPushConfigToServer', 'pvHoursCellHtml', 'pvSyncHoursInputs', 'classifyCourseType']
    .forEach(fn => check(`函式 ${fn} 存在`, typeof win[fn], 'function'));

  // --- 1. 時數：預設值 + 可覆寫 ---
  check('預設 球類課程 = 1.5h', win.pvHoursOf('球類課程'), 1.5);
  check('預設 補習班課程 = 1h', win.pvHoursOf('補習班課程'), 1);
  check('預設 游泳一般團班 = 1.34h', win.pvHoursOf('游泳一般團班'), 1.34);

  win.renderPayrollReport();                      // 建出費率矩陣 input
  const hoursInput = win.document.getElementById('pvh_4');   // index 4 = 球類課程
  check('球類課程 有時數輸入格', !!hoursInput, true);
  check('時數格帶出目前值', hoursInput && hoursInput.value, '1.5');

  hoursInput.value = '1';
  win.pvSaveTypeRates();
  check('改時數後 球類課程 = 1h（不再寫死）', win.pvHoursOf('球類課程'), 1);
  check('未改動的 補習班課程 仍為 1h', win.pvHoursOf('補習班課程'), 1);

  // --- 2. 補習班名開頭 = 補習班課程（不論後面接球種或游泳）---
  const t = (n) => win.classifyCourseType({ courseName: n, startTime: '15:00', endTime: '16:00' });
  check('樂獅桌球 → 補習班課程', t('樂獅桌球'), '補習班課程');
  check('樂獅-籃球 → 補習班課程', t('樂獅-籃球'), '補習班課程');
  check('加洲森林-棒球 → 補習班課程', t('加洲森林-棒球'), '補習班課程');
  check('立得-游泳 → 補習班課程', t('立得-游泳'), '補習班課程');
  check('新學林（無球種）→ 補習班課程', t('新學林'), '補習班課程');
  // 公司自己辦的球類仍須是 1.5h，這是本次修復的另一半
  check('夏令營-羽球 → 球類課程', t('夏令營-羽球'), '球類課程');
  check('營隊羽球 → 球類課程', t('營隊羽球'), '球類課程');
  check('體育課-羽球 → 球類課程', t('體育課-羽球'), '球類課程');
  check('補習班課 1h', win.pvHoursOf('補習班課程'), 1);

  // 名單可編輯：加入新補習班後立刻生效，不必改程式
  win.pvSetCramSchools('樂獅、加洲森林、新學林、立得、丙丁補習班');
  check('新增的補習班立刻生效', t('丙丁補習班-羽球'), '補習班課程');
  check('名單內其他補習班不受影響', t('加洲森林-棒球'), '補習班課程');
  check('被移出名單的欣蓓回到關鍵字判斷', t('欣蓓-籃球'), '球類課程');

  // --- 2b. 逐課名指定仍可覆寫規則 ---
  const indoor = { courseName: '室內羽球課', startTime: '15:00', endTime: '16:00' };
  check('室內羽球課 預設為球類', win.classifyCourseType(indoor), '球類課程');
  win.pvSetCourseTypeOverride('室內羽球課', '補習班課程');
  check('指定後 → 補習班課程', win.classifyCourseType(indoor), '補習班課程');
  win.pvSetCourseTypeOverride('室內羽球課', '');
  check('清空指定後回到系統判定', win.classifyCourseType(indoor), '球類課程');

  // --- 3. 角色分項欄 ---
  const staffHead = win.document.querySelectorAll('#pv2StaffBody')[0]
    .closest('table').querySelectorAll('thead th');
  const heads = Array.from(staffHead).map(th => th.textContent);
  check('員工試算表有「角色分項」欄', heads.some(h => h.includes('角色分項')), true);
  check('員工試算表欄數 = 11（兩欄併為一欄）', heads.length, 11);
  check('補習班名單輸入框存在', !!win.document.getElementById('pvCramList'), true);

  const rateHead = win.document.querySelector('.pv2-ratematrix thead').querySelectorAll('th');
  check('費率矩陣有「單堂時數」欄', Array.from(rateHead).map(t => t.textContent).includes('單堂時數'), true);

  check('課程分類指定區塊存在', !!win.document.getElementById('pv2TypeMapBody'), true);

  // --- 4. 設定有推去後端（pvPushConfigToServer 有 800ms debounce，要等它送出）---
  setTimeout(() => {
    check('設定會 POST 到 system-config',
      posted.some(u => u.includes('/api/system-config/summer-payroll-config-v1')), true);
    check('載入期間無未捕捉錯誤', errs.length, 0);

    const bad = results.filter(r => !r).length;
    console.log('='.repeat(60));
    console.log(bad ? `!! ${bad} / ${results.length} 項失敗` : `全部 ${results.length} 項通過`);
    process.exit(bad ? 1 : 0);
  }, 1500);
}, 4000);
