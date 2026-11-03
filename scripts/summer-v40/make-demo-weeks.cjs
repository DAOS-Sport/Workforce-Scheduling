// Writes scripts/summer-v40/demo/weeks.json: synthetic input for recompute-shifts.ts.
// Stored shiftEntries are the v40 golden shifts with three planted differences, so the report shows each kind.
const fs = require('fs');
const path = require('path');
const golden = require('../../client/src/lib/summer/__fixtures__/v40-golden.json');

const week = name => golden.pipelines.find(p => p.name === name);
const toInput = (p, shiftEntries) => ({
  weekNo: p.fx.weekNo,
  rawEntries: p.fx.rawEntries,
  shiftEntries,
  employees: p.fx.employees,
  enrollmentItems: p.fx.enrollment.status === 200 ? p.fx.enrollment.items : null,
  manualCourses: p.fx.manualCourses,
  payrollConfig: p.fx.payrollConfig,
});

const w2 = week('week2-full');
const stored = JSON.parse(JSON.stringify(w2.core.shifts));
const course = stored.find(x => x.notes.includes('報名 12 人'));
course.notes = course.notes.replace('報名 12 人', '報名 10 人');
const removed = stored.splice(3, 1);
stored.push({ ...stored[1], date: '2026-07-10', notes: '已刪掉的舊班' });

const w3 = week('week3-enrollment-failed');
const out = { weeks: [toInput(w2, stored), toInput(w3, w3.core.shifts)] };
const file = path.join(__dirname, 'demo', 'weeks.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${path.relative(process.cwd(), file)}; planted: one stale enrollment count in notes, removed ${removed.length} row, added 1 stale row`);
