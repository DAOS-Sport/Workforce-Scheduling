// Recomputes publish shifts from a stored draft export and diffs them against the stored shiftEntries.
// Reads one JSON file; never connects to a database or the network.
// Usage: npx tsx scripts/summer-v40/recompute-shifts.ts <weeks.json> [--out report.json] [--no-v40]
// Input: one week object or { "weeks": [...] }, each week:
//   { weekNo, rawEntries, shiftEntries, employees, enrollmentItems | null, manualCourses, payrollConfig | null }
// enrollmentItems null means the enrollment API data is not part of the export; the recompute then treats it as unreachable (R057).
// Output holds counts, field names and cellKeys only. Names, notes text and other row values are never printed or written.
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { isWeekNo, weekByNo } from '../../client/src/lib/summer/config';
import { normalizeEnrollmentItems } from '../../client/src/lib/summer/enrollment';
import { normalizeManualCourse } from '../../client/src/lib/summer/manual-course';
import { collectKeyedAssignments, collectShiftRows, draftFromRawEntries } from '../../client/src/lib/summer/payload';
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
interface Row {
  shift: Rec;
  cellKey: string | null;
}

const MATCH_FIELDS = ['date', 'startTime', 'endTime', 'employeeId', 'venueId', 'roleType', 'courseName', 'slotCode', 'manualCourseId'] as const;
const LOCATE_FIELDS = ['venueId', 'date', 'startTime', 'endTime', 'roleType', 'slotCode', 'manualCourseId'] as const;
const MAX_LISTED = 20;

function newRows(w: WeekInput): Row[] {
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
  const keyed = collectKeyedAssignments(model);
  const rows: Row[] = [];
  keyed.forEach(k => collectShiftRows([k.assignment], week).forEach(shift => rows.push({ shift: JSON.parse(JSON.stringify(shift)), cellKey: k.cellKey })));
  return rows.sort(
    (x, y) =>
      String(x.shift.date).localeCompare(String(y.shift.date)) ||
      String(x.shift.startTime).localeCompare(String(y.shift.startTime)) ||
      String(x.shift.employeeId).localeCompare(String(y.shift.employeeId)),
  );
}

async function v40Rows(w: WeekInput): Promise<Row[]> {
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
    return (page.run('collectShiftRowsForPortal()') as Rec[]).map(shift => ({ shift, cellKey: null }));
  } finally {
    page.close();
  }
}

const matchKey = (s: Rec) => MATCH_FIELDS.map(f => String(s[f] ?? '')).join('|');
const locate = (s: Rec) => LOCATE_FIELDS.map(f => `${f}=${String(s[f] ?? '')}`).join(' ');

function flatten(s: Rec): Record<string, string> {
  const out: Record<string, string> = {};
  Object.entries(s).forEach(([k, v]) => {
    if (k === 'originalAssignment' && v && typeof v === 'object') Object.entries(v as Rec).forEach(([k2, v2]) => (out[`originalAssignment.${k2}`] = JSON.stringify(v2)));
    else out[k] = JSON.stringify(v);
  });
  return out;
}

export interface Comparison {
  left: number;
  right: number;
  matched: number;
  identical: number;
  onlyLeft: number;
  onlyRight: number;
  fieldsDiffering: Record<string, number>;
  cellKeys: string[];
  onlyLeftRows: string[];
  onlyRightRows: string[];
  ignoredLeftFields: string[];
}

function compare(left: Row[], right: Row[]): Comparison {
  const pool = new Map<string, Row[]>();
  right.forEach(r => pool.set(matchKey(r.shift), [...(pool.get(matchKey(r.shift)) ?? []), r]));
  const rightFields = new Set(right.flatMap(r => Object.keys(flatten(r.shift))));
  const ignored = new Set<string>();
  const res: Comparison = { left: left.length, right: right.length, matched: 0, identical: 0, onlyLeft: 0, onlyRight: 0, fieldsDiffering: {}, cellKeys: [], onlyLeftRows: [], onlyRightRows: [], ignoredLeftFields: [] };
  const cellKeys = new Set<string>();
  left.forEach(a => {
    const b = pool.get(matchKey(a.shift))?.shift();
    if (!b) {
      res.onlyLeft++;
      res.onlyLeftRows.push(locate(a.shift));
      return;
    }
    res.matched++;
    const fa = flatten(a.shift);
    const fb = flatten(b.shift);
    let same = true;
    new Set([...Object.keys(fa), ...Object.keys(fb)]).forEach(f => {
      if (fa[f] === fb[f]) return;
      if (!rightFields.has(f)) {
        ignored.add(f);
        return;
      }
      same = false;
      res.fieldsDiffering[f] = (res.fieldsDiffering[f] ?? 0) + 1;
      if (b.cellKey) cellKeys.add(b.cellKey);
    });
    if (same) res.identical++;
  });
  pool.forEach(rest =>
    rest.forEach(r => {
      res.onlyRight++;
      res.onlyRightRows.push(locate(r.shift));
      if (r.cellKey) cellKeys.add(r.cellKey);
    }),
  );
  res.cellKeys = [...cellKeys].sort();
  res.ignoredLeftFields = [...ignored].sort();
  return res;
}

function describe(name: string, leftName: string, rightName: string, c: Comparison): string[] {
  const diff = c.onlyLeft + c.onlyRight + (c.matched - c.identical);
  const lines = [`  ${name}: ${leftName} ${c.left} rows, ${rightName} ${c.right} rows, ${c.matched} matched, ${c.identical} identical, ${diff} differing (${c.onlyLeft} only ${leftName}, ${c.onlyRight} only ${rightName}, ${c.matched - c.identical} field changes)`];
  const fields = Object.entries(c.fieldsDiffering).sort((a, b) => b[1] - a[1]);
  if (fields.length) lines.push(`    fields: ${fields.map(([f, n]) => `${f}×${n}`).join(', ')}`);
  if (c.cellKeys.length) {
    lines.push(`    cellKeys (${c.cellKeys.length}): ${c.cellKeys.slice(0, MAX_LISTED).join(' ; ')}${c.cellKeys.length > MAX_LISTED ? ' ...' : ''}`);
  }
  c.onlyLeftRows.slice(0, MAX_LISTED).forEach(l => lines.push(`    only ${leftName}: ${l}`));
  c.onlyRightRows.slice(0, MAX_LISTED).forEach(l => lines.push(`    only ${rightName}: ${l}`));
  if (c.ignoredLeftFields.length) lines.push(`    ignored ${leftName}-only fields: ${c.ignoredLeftFields.join(', ')}`);
  return lines;
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const input = args.find((a, i) => !a.startsWith('--') && i !== outIdx + 1);
  if (!input) throw new Error('usage: recompute-shifts.ts <weeks.json> [--out report.json] [--no-v40]');
  const withV40 = !args.includes('--no-v40');
  const parsed = JSON.parse(fs.readFileSync(input, 'utf8'));
  const weeks: WeekInput[] = Array.isArray(parsed.weeks) ? parsed.weeks : [parsed];
  const report = [];
  for (const w of weeks) {
    const stored: Row[] = w.shiftEntries.map(shift => ({ shift, cellKey: null }));
    const fresh = newRows(w);
    const v40 = withV40 ? await v40Rows(w) : null;
    const entry = {
      weekNo: w.weekNo,
      enrollment: w.enrollmentItems ? 'provided' : 'missing (treated as unreachable, R057)',
      storedVsNew: compare(stored, fresh),
      storedVsV40: v40 ? compare(stored, v40) : null,
      v40VsNew: v40 ? compare(v40, fresh) : null,
    };
    report.push(entry);
    console.log(`week ${w.weekNo} (enrollment ${entry.enrollment})`);
    describe('stored vs new', 'stored', 'new', entry.storedVsNew).forEach(l => console.log(l));
    if (entry.storedVsV40) describe('stored vs v40', 'stored', 'v40', entry.storedVsV40).forEach(l => console.log(l));
    if (entry.v40VsNew) describe('v40 vs new', 'v40', 'new', entry.v40VsNew).forEach(l => console.log(l));
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
