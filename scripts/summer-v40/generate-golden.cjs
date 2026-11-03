// Rebuilds client/src/lib/summer/__fixtures__/v40-golden.json by running the real v40 page in jsdom.
// Usage: node scripts/summer-v40/generate-golden.cjs
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { openV40, HTML_PATH } = require('./v40-page.cjs');
const { pipelines } = require('./scenarios.cjs');
const { CAPTURE_CORE } = require('./capture.cjs');
const { CAPTURE_STAGE, CAPTURE_PAYROLL, CAPTURE_MOBILE, CAPTURE_AVAILABILITY } = require('./capture-views.cjs');
const { UNIT_CASES } = require('./unit-cases.cjs');

const OUT = path.resolve(__dirname, '../../client/src/lib/summer/__fixtures__/v40-golden.json');

async function runUnits() {
  const page = await openV40({ weekNo: 1, employees: [] });
  page.win.eval('validateAll = function () {}; scheduleAutoSave = function () {}; renderAvailabilityReport = function () {}; refreshEmployeeChips = function () {};');
  const out = {};
  for (const [group, spec] of Object.entries(UNIT_CASES)) {
    page.win.eval(`employees = ${JSON.stringify(spec.employees || [])}.map(normalizeEmployeeFromApi).filter(e => e && e.id);`);
    page.win.eval(`pvConfig = ${JSON.stringify({ hours: {}, rates: {}, mult: {}, typeOverrides: {}, ...(spec.pvConfig || {}) })};`);
    out[group] = spec.cases.map(args => ({ args, result: page.run(`(${spec.call})(...${JSON.stringify(args)})`) }));
  }
  page.close();
  return out;
}

async function runPipelines() {
  const out = [];
  for (const p of pipelines) {
    const page = await openV40(p.fx);
    const core = page.run(CAPTURE_CORE);
    const stage = page.run(CAPTURE_STAGE);
    const payroll = page.run(CAPTURE_PAYROLL);
    if (p.fx.payrollConfig && !payroll.configLoaded) throw new Error(`${p.name}: payroll config not loaded`);
    if (p.fx.weekNo === 2 && !core.shifts.some(s => s.roleType === 'course')) throw new Error(`${p.name}: no course shifts captured`);
    if (core.shifts.some(s => /報名 \.\.\. 人|載入中/.test(s.notes))) throw new Error(`${p.name}: captured before enrollment settled`);
    page.win.eval('loadAvailabilityFromDB()');
    await page.settle();
    page.win.eval('validateAll()');
    const withAvailability = page.run(CAPTURE_CORE);
    const availability = page.run(CAPTURE_AVAILABILITY);
    const mobile = page.run(CAPTURE_MOBILE);
    out.push({
      name: p.name,
      fx: p.fx,
      core,
      stage,
      payroll,
      withAvailability: { courseCells: withAvailability.courseCells, dutyCells: withAvailability.dutyCells, issues: withAvailability.issues },
      availability,
      mobile,
    });
    page.close();
  }
  return out;
}

(async () => {
  const html = fs.readFileSync(HTML_PATH);
  const golden = {
    source: path.relative(path.resolve(__dirname, '../..'), HTML_PATH).replace(/\\/g, '/'),
    sourceSha256: crypto.createHash('sha256').update(html).digest('hex'),
    units: await runUnits(),
    pipelines: await runPipelines(),
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(golden, null, 1) + '\n');
  const unitCount = Object.values(golden.units).reduce((n, c) => n + c.length, 0);
  console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${unitCount} unit cases, ${golden.pipelines.length} pipelines`);
  process.exit(0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
