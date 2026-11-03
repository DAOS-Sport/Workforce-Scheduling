// Recomputes publish shifts from stored drafts and diffs them against the stored shiftEntries.
// Reads JSON only; never connects to a database.
// Usage: npx tsx scripts/summer-v40/recompute-shifts.ts <weeks.json> [--out report.json] [--no-v40]
// Input: one week object or { "weeks": [...] }, each week:
//   { weekNo, rawEntries, shiftEntries, employees, enrollmentItems | null, manualCourses, payrollConfig | null }
// enrollmentItems null means the enrollment API was unreachable; v40 then washes needed counts (R057).
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { isWeekNo, weekByNo } from '../../client/src/lib/summer/config';
import { normalizeEnrollmentItems } from '../../client/src/lib/summer/enrollment';
import { normalizeManualCourse } from '../../client/src/lib/summer/manual-course';
import { collectAssignments, collectShiftRows, draftFromRawEntries } from '../../client/src/lib/summer/payload';
import { normalizeEmployee } from '../../client/src/lib/summer/roster';
import type { Employee } from '../../client/src/lib/summer/types';
import { buildWeekModel } from '../../client/src/lib/summer/week-model';

type Rec = Record<string, unknown>;
interface WeekInput {
  weekNo: number;
  rawEntries: Rec[];
  shiftEntries: Rec[];
  employees: Rec[];
  enrollmentItems: Rec[] | null;
  manualCourses: Rec[];
  payrollConfig: { nameAliases?: Record<string, string> } | null;
}

const MATCH_FIELDS = ['date', 'startTime', 'endTime', 'employeeId', 'venueId', 'roleType', 'courseName', 'slotCode', 'manualCourseId'] as const;

function newShifts(w: WeekInput): Rec[] {
  if (!isWeekNo(w.weekNo)) throw new Error(`week ${w.weekNo} is not configured`);
  const week = weekByNo(w.weekNo);
  const model = buildWeekModel({
    week,
    draft: draftFromRawEntries(w.rawEntries),
    employees: w.employees.map(normalizeEmployee).filter((e): e is Employee => e !== null),
    aliases: w.payrollConfig?.nameAliases ?? {},
    manualCourses: w.manualCourses.map(r => normalizeManualCourse(r, week.no)),
    enrollment: w.enrollmentItems
      ? { kind: 'loaded', weekNo: week.no, items: normalizeEnrollmentItems(w.enrollmentItems, week.no), lastUpdated: null }
      : { kind: 'failed', message: '報名人數 API 讀取失敗' },
  });
  return JSON.parse(JSON.stringify(collectShiftRows(collectAssignments(model), week)));
}

async function v40Shifts(w: WeekInput): Promise<Rec[]> {
  const require = createRequire(import.meta.url);
  const { openV40 } = require('./v40-page.cjs');
  const page = await openV40({
    weekNo: w.weekNo,
    employees: w.employees,
    rawEntries: w.rawEntries,
    enrollment: w.enrollmentItems ? { status: 200, items: w.enrollmentItems } : { status: 500 },
    manualCourses: w.manualCourses,
    payrollConfig: w.payrollConfig,
  });
  try {
    return page.run('collectShiftRowsForPortal()');
  } finally {
    page.close();
  }
}

const matchKey = (s: Rec) => MATCH_FIELDS.map(f => String(s[f] ?? '')).join('|');

function flatten(s: Rec): Record<string, string> {
  const out: Record<string, string> = {};
  Object.entries(s).forEach(([k, v]) => {
    if (k === 'originalAssignment' && v && typeof v === 'object') Object.entries(v as Rec).forEach(([k2, v2]) => (out[`originalAssignment.${k2}`] = JSON.stringify(v2)));
    else out[k] = JSON.stringify(v);
  });
  return out;
}

interface Comparison {
  left: number;
  right: number;
  matched: number;
  identical: number;
  onlyLeft: Rec[];
  onlyRight: Rec[];
  fieldDiffs: Record<string, { count: number; examples: { key: string; left: unknown; right: unknown }[] }>;
}

function compare(left: Rec[], right: Rec[]): Comparison {
  const pool = new Map<string, Rec[]>();
  right.forEach(s => pool.set(matchKey(s), [...(pool.get(matchKey(s)) ?? []), s]));
  const result: Comparison = { left: left.length, right: right.length, matched: 0, identical: 0, onlyLeft: [], onlyRight: [], fieldDiffs: {} };
  left.forEach(a => {
    const bucket = pool.get(matchKey(a));
    const b = bucket?.shift();
    if (!b) {
      result.onlyLeft.push(a);
      return;
    }
    result.matched++;
    const fa = flatten(a);
    const fb = flatten(b);
    const fields = new Set([...Object.keys(fa), ...Object.keys(fb)]);
    let same = true;
    fields.forEach(f => {
      if (fa[f] === fb[f]) return;
      same = false;
      const d = (result.fieldDiffs[f] ??= { count: 0, examples: [] });
      d.count++;
      if (d.examples.length < 3) d.examples.push({ key: matchKey(a), left: fa[f] && JSON.parse(fa[f]), right: fb[f] && JSON.parse(fb[f]) });
    });
    if (same) result.identical++;
  });
  pool.forEach(rest => result.onlyRight.push(...rest));
  return result;
}

function describe(name: string, c: Comparison): string[] {
  const lines = [`  ${name}: ${c.left} vs ${c.right} rows, ${c.matched} matched, ${c.identical} identical, ${c.onlyLeft.length} only left, ${c.onlyRight.length} only right`];
  Object.entries(c.fieldDiffs)
    .sort((a, b) => b[1].count - a[1].count)
    .forEach(([f, d]) => lines.push(`    ${f}: ${d.count} rows differ, e.g. ${JSON.stringify(d.examples[0].left)} → ${JSON.stringify(d.examples[0].right)}`));
  c.onlyLeft.slice(0, 3).forEach(s => lines.push(`    only left: ${matchKey(s)}`));
  c.onlyRight.slice(0, 3).forEach(s => lines.push(`    only right: ${matchKey(s)}`));
  return lines;
}

async function main() {
  const args = process.argv.slice(2);
  const input = args.find(a => !a.startsWith('--'));
  if (!input) throw new Error('usage: recompute-shifts.ts <weeks.json> [--out report.json] [--no-v40]');
  const outIdx = args.indexOf('--out');
  const withV40 = !args.includes('--no-v40');
  const parsed = JSON.parse(fs.readFileSync(input, 'utf8'));
  const weeks: WeekInput[] = Array.isArray(parsed.weeks) ? parsed.weeks : [parsed];
  const report = [];
  for (const w of weeks) {
    const fresh = newShifts(w);
    const v40 = withV40 ? await v40Shifts(w) : null;
    const entry = {
      weekNo: w.weekNo,
      enrollment: w.enrollmentItems ? 'provided' : 'missing (v40 washes needed counts, R057)',
      storedVsNew: compare(w.shiftEntries, fresh),
      storedVsV40: v40 ? compare(w.shiftEntries, v40) : null,
      v40VsNew: v40 ? compare(v40, fresh) : null,
    };
    report.push(entry);
    console.log(`week ${w.weekNo} (enrollment ${entry.enrollment})`);
    describe('stored → new', entry.storedVsNew).forEach(l => console.log(l));
    if (entry.storedVsV40) describe('stored → v40', entry.storedVsV40).forEach(l => console.log(l));
    if (entry.v40VsNew) describe('v40 → new', entry.v40VsNew).forEach(l => console.log(l));
  }
  if (outIdx >= 0) {
    const out = path.resolve(args[outIdx + 1]);
    fs.writeFileSync(out, JSON.stringify(report, null, 1));
    console.log(`report written to ${out}`);
  }
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
