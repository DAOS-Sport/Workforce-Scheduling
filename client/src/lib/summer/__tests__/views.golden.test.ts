import { describe, expect, it } from 'vitest';
import golden from '../__fixtures__/v40-golden.json';
import { availabilityIntervals, availabilityReport, availabilityRowsFromApi } from '../availability';
import { VENUES } from '../config';
import { dayName } from '../dates';
import { mobileDays, mobileEmployees, mobileIssueGroups, mobileSummary } from '../mobile';
import { parseTimeRange } from '../parse';
import { collectAssignments } from '../payload';
import {
  coachDetail,
  coachFilter,
  courseTypeMap,
  cramSchools,
  EMPTY_PAYROLL_CONFIG,
  expandPayrollRows,
  filterHint,
  hourlyRates,
  kpis,
  matchesCoach,
  moneyText,
  NAME_AUDIT_EMPTY,
  nameAudit,
  PAYROLL_EMPTY,
  parsePayrollConfig,
  payrollCsv,
  priceRows,
  roleBadge,
  slotBadge,
  staffStats,
  staffTable,
  typeSummary,
  typeSummaryCells,
  weekDetail,
  type PayrollConfig,
  type PricedRow,
} from '../payroll';
import { lineBadgeText } from '../roster';
import {
  courseLane,
  coursesView,
  coverageMatrix,
  courseState,
  courseSummary,
  courseSummaryText,
  dutySegs,
  roleGapCount,
  roleLane,
  segCoverage,
  shiftsFor,
  stageControls,
  stageCourses,
  timelineHeader,
  type PublishedDutyShift,
  type StageContext,
} from '../stage';
import type { DayNo, DutyRole } from '../types';
import { validateWeek, venueRule } from '../validate';
import { workEntries } from '../validate';
import { modelFrom, type PipelineFixture } from './golden';

type Fx = PipelineFixture & { availability: Record<string, unknown>[]; dutyShifts: PublishedDutyShift[]; salaryRates: Record<string, unknown>[]; payrollConfig: Record<string, unknown> | null };
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const pipelines = (golden.pipelines as unknown as { name: string; fx: Fx; stage: Any[]; payroll: Any; mobile: Any; availability: Any }[]).filter(p => p.name !== 'week3-enrollment-failed');

const ctxFor = (p: (typeof pipelines)[number], dayNo: DayNo): StageContext => ({ model: modelFrom(p.fx), dayNo, published: p.fx.dutyShifts });
const pct = (n: number) => `${n}%`;
const norm = (rows: string[][]) => rows.map(r => r.map(c => c.replace(/\s+/g, ' ').trim()));
const ROLES: DutyRole[] = ['lifeguard', 'frontdesk'];

function configOf(p: (typeof pipelines)[number]): PayrollConfig {
  const r = parsePayrollConfig({ data: { value: p.fx.payrollConfig ? JSON.stringify(p.fx.payrollConfig) : null } });
  return r.kind === 'loaded' ? r.config : EMPTY_PAYROLL_CONFIG;
}

function priced(p: (typeof pipelines)[number]): PricedRow[] {
  const model = modelFrom(p.fx);
  return priceRows(expandPayrollRows(collectAssignments(model), model.week), configOf(p), hourlyRates(configOf(p), p.fx.salaryRates));
}

const stageDays = pipelines.flatMap(p => p.stage.map((d: Any) => [`${p.name} day ${d.dayNo}`, p, d] as const));

describe('stage: shifts, coverage and courses per day (R170-R192)', () => {
  it.each(stageDays)('%s: shifts, gaps and segment coverage per venue and role (R175-R179)', (_n, p, d) => {
    const c = ctxFor(p, d.dayNo);
    VENUES.forEach(v =>
      ROLES.forEach(role => {
        const list = shiftsFor(c, v, role);
        expect(
          list.map(s => ({
            name: s.name,
            a: s.a,
            b: s.b,
            employeeId: s.employeeId,
            lineBound: s.lineBound,
            raw: s.raw,
            key: s.source === 'draft' ? s.key : `published-${s.id}`,
            isPublished: s.source === 'published',
          })),
        ).toStrictEqual(d.venues[v.name].roles[role].shifts);
        expect(roleGapCount(list, v, role)).toBe(d.venues[v.name].roles[role].gaps);
        expect(dutySegs(v).map(seg => segCoverage(list, seg, venueRule(v, role)))).toStrictEqual(d.venues[v.name].roles[role].segs);
      }),
    );
  });

  it.each(stageDays)('%s: course list, states and summary (R184-R186)', (_n, p, d) => {
    const c = ctxFor(p, d.dayNo);
    VENUES.forEach(v => {
      const list = stageCourses(c, v);
      expect(list.map(x => ({ ...x, state: courseState(x) }))).toStrictEqual(d.venues[v.name].courses);
      expect(courseSummary(list)).toStrictEqual(d.venues[v.name].summary);
      expect(courseSummaryText(courseSummary(list))).toBe(d.venues[v.name].summaryText);
    });
  });

  it.each(stageDays)('%s: control badges (R192)', (_n, p, d) => {
    const ctl = stageControls(ctxFor(p, d.dayNo));
    expect([ctl.coverageBadge, ctl.coursesBadge]).toStrictEqual([d.coverageBadge, d.coursesBadge]);
    expect(ctl.days.filter(x => x.selected).map(x => x.dayNo)).toStrictEqual([d.dayNo]);
  });

  it.each(stageDays)('%s: timeline lanes, tips and header (R170-R172, R180-R183, R187)', (_n, p, d) => {
    const c = ctxFor(p, d.dayNo);
    VENUES.forEach(v => {
      const lanes = ROLES.map(role => roleLane(c, v, role));
      const course = courseLane(c, v);
      const head = timelineHeader(c, v);
      const want = d.timeline[v.name];
      expect([...lanes.flatMap(l => [...l.rows.flatMap(r => r.bars.map(b => b.tip)), ...l.chips.map(ch => ch.tip)]), ...course.bars.map(b => b.tip)]).toStrictEqual(want.tips);
      expect([...lanes.map(l => l.statusText), course.summaryText]).toStrictEqual(want.rstat);
      expect([...lanes.map(l => l.needText), course.headText]).toStrictEqual(want.rneed);
      expect([head.sub, head.tags]).toStrictEqual([want.sub, want.tags]);
      expect(lanes.flatMap(l => l.rows.flatMap(r => r.bars.map(b => ({ label: b.label, hours: b.hours, removable: !!b.removable, left: pct(b.left), width: pct(b.width) }))))).toStrictEqual(want.bars);
      expect(lanes.flatMap(l => l.chips.map(ch => ({ state: ch.coverage.state, gap: ch.gap, glyph: ch.glyph, fill: ch.seg.label })))).toStrictEqual(want.chips);
      expect(course.bars.map(b => ({ state: b.state, code: b.course.code, tail: b.tail || null }))).toStrictEqual(want.courseBars);
      expect([...lanes.filter(l => !l.rows.length).map(() => '— 未排 —'), '課程']).toStrictEqual(want.emptyLane);
    });
  });

  it.each(stageDays)('%s: course coach view (R191)', (_n, p, d) => {
    const c = ctxFor(p, d.dayNo);
    VENUES.forEach(v => {
      const view = coursesView(c, v);
      const want = d.courses[v.name];
      expect(view.title).toBe(want.title);
      expect([
        { cls: 'sv-sum mute', text: view.countText },
        { cls: view.needsWork ? 'sv-sum warn' : 'sv-sum ok', text: view.summaryText },
      ]).toStrictEqual(want.sums);
      expect(view.rows.length ? null : view.emptyText).toBe(want.empty);
      expect(
        view.rows.map(r => ({
          state: r.state,
          progress: r.course.enrolled ? pct(r.progress) : null,
          need: r.needText,
          chips: r.course.coaches,
          button: r.buttonLabel,
          buttonKey: r.cellKey,
          pill: r.pill,
        })),
      ).toStrictEqual(want.rows);
    });
  });

  it.each(stageDays)('%s: coverage matrix numbers, members and tips (R188, R189)', (_n, p, d) => {
    const c = ctxFor(p, d.dayNo);
    ROLES.forEach(role => {
      const m = coverageMatrix(c, role);
      const want = d.matrix[role];
      expect(m.hint).toBe(want.hint);
      expect(m.headers.map(h => h.text)).toStrictEqual(want.headers);
      const v40Fixed = want.cells.map((row: Any[], bi: number) =>
        row.map((cell: Any, vi: number) => {
          if (cell.state === 'closed') return cell;
          const venue = VENUES[vi];
          const published = d.venues[venue.name].roles[role].shifts.some((s: Any) => s.isPublished);
          const band = parseTimeRange(cell.fill)!;
          const segs = dutySegs(venue);
          const clip = (x: number) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
          const fill = `${clip(Math.max(band.start, segs[0].a))}-${clip(Math.min(band.end, segs[segs.length - 1].b))}`;
          return { ...cell, fill, who: cell.who.map((w: Any) => ({ ...w, removable: !published })) };
        }),
      );
      const mine = m.rows.map(r =>
        r.cells.map(cell =>
          cell.kind === 'closed'
            ? { state: 'closed', num: '–', need: null, flag: null, who: [], fill: null, tip: null }
            : {
                state: cell.coverage.state,
                num: String(cell.coverage.count),
                need: cell.needText,
                flag: cell.flag || null,
                who: cell.members.map(x => ({ name: x.name, removable: !!x.removable })),
                fill: cell.fill.segLabel,
                tip: cell.tip,
              },
        ),
      );
      expect(mine).toStrictEqual(v40Fixed);
    });
  });

  it('與 v40 不同：覆蓋總覽的已發布班次沒有 ✕，排班時段裁到營業時間（R190）', () => {
    const p = pipelines.find(x => x.name === 'week2-full')!;
    const monday = p.stage.find((d: Any) => d.dayNo === 1);
    const sanchong = VENUES.findIndex(v => v.name === '三重商工');
    const v40Early = monday.matrix.lifeguard.cells[0][sanchong];
    expect(v40Early.fill).toBe('05:30-08:00');
    expect(v40Early.who.map((w: Any) => w.removable)).toStrictEqual([true]);
    const cell = coverageMatrix(ctxFor(p, 1), 'lifeguard').rows[0].cells[sanchong];
    expect(cell.kind === 'open' && cell.fill.segLabel).toBe('07:30-08:00');
    expect(cell.kind === 'open' && cell.members.map(x => x.removable)).toStrictEqual([null]);
  });
});

describe('payroll report (R136-R163)', () => {
  it.each(pipelines.map(p => [p.name, p] as const))('%s: priced rows equal v40 (R136, R137, R141, R150-R152)', (_n, p) => {
    const v40 = p.payroll.priced.map((r: Any) => ({ ...r, payCalc: { unit: r.payCalc.unit, rate: r.payCalc.rate, amount: r.payCalc.amount, formula: r.payCalc.formula }, courseType: r.courseType ?? null, courseHours: r.courseHours ?? 0 }));
    expect(JSON.parse(JSON.stringify(priced(p)))).toStrictEqual(v40);
  });

  it.each(pipelines.map(p => [p.name, p] as const))('%s: KPIs, type summary and staff table (R157-R159, R242)', (_n, p) => {
    const rows = priced(p);
    const config = configOf(p);
    const stats = staffStats(rows, config);
    expect(kpis(stats).map(k => [k.label, k.value, k.sub])).toStrictEqual(p.payroll.all.kpis);
    const ts = typeSummary(rows, config);
    expect([...ts.rows.map(r => typeSummaryCells(r, false)), typeSummaryCells(ts.total, true)]).toStrictEqual(p.payroll.all.typeRows);
    const table = staffTable(stats, config);
    const cells = table.total
      ? [
          ...table.rows.map(r => [`${r.name}${r.star ? ' ★' : ''}`, ...r.counts.map(n => (n ? String(n) : '·')), r.memo, r.hours, r.pay]),
          ['合計帶出', ...table.total.counts.map(String), table.total.memo, table.total.hours, table.total.pay],
        ]
      : [[PAYROLL_EMPTY.staff]];
    expect(norm(cells)).toStrictEqual(p.payroll.all.staffRows);
  });

  const coachCells = (p: (typeof pipelines)[number], input: string) => {
    const rows = priced(p);
    const config = configOf(p);
    const stats = staffStats(rows, config);
    const f = coachFilter(input, stats);
    const detail = coachDetail(stats, f, config);
    if (!detail.length) return [[f.kind === 'all' ? PAYROLL_EMPTY.coach : PAYROLL_EMPTY.coachFiltered]];
    return detail.flatMap(c => [
      ...c.groups.map((g, i) => [
        ...(i === 0 ? [`${c.staff.employeeName}${c.staff.inRoster ? '' : ' ★'}`] : []),
        g.name,
        g.type,
        roleBadge(g.role).text,
        `${slotBadge(g).text}${g.dayChips.map(d => dayName(d)).join('')}`,
        String(g.n),
        g.hours.toFixed(1),
        moneyText(g.amount),
      ]),
      ['小計', '', '', '', `${c.subtotal.n} 堂`, `${c.subtotal.h.toFixed(1)} h`, moneyText(c.subtotal.amount)],
    ]);
  };
  const detailCells = (p: (typeof pipelines)[number], input: string) => {
    const rows = priced(p);
    const f = coachFilter(input, staffStats(rows, configOf(p)));
    const visible = rows.filter(r => matchesCoach(r, f));
    if (!visible.length) return [[f.kind === 'all' ? PAYROLL_EMPTY.detail : PAYROLL_EMPTY.detailFiltered]];
    return weekDetail(visible).map(d => [
      `${d.dateText}${d.weekdayText}`,
      `${d.row.employeeName || '未指定員工'}${d.star ? ' ★' : ''}`,
      d.row.venueName || '',
      d.row.typeLabel,
      `${d.row.workName}${d.slotText ? ` ${d.slotText}` : ''}${d.row.roleType === 'course' ? ` ${roleBadge(d.row.coachRole).text}` : ''}`,
      d.courseTypeText,
      d.timeText,
      d.hoursText,
      `${d.row.payCalc.formula}${d.amountText}`,
    ]);
  };
  const filters = [['all', ''], ['exact', '王偉'], ['fuzzy', '王']] as const;

  it.each(pipelines.flatMap(p => filters.map(([k, input]) => [`${p.name} ${k}`, p, k, input] as const)))(
    '%s: coach detail, week detail and filter hint (R160-R162)',
    (_n, p, k, input) => {
      const want = p.payroll[k];
      expect(norm(coachCells(p, input))).toStrictEqual(want.coachRows);
      expect(norm(detailCells(p, input))).toStrictEqual(want.detailRows);
      const rows = priced(p);
      const f = coachFilter(input, staffStats(rows, configOf(p)));
      expect(filterHint(f, rows.filter(r => matchesCoach(r, f)).length) || null).toBe(want.hint || null);
    },
  );

  it.each(pipelines.map(p => [p.name, p] as const))('%s: name audit, course type map and cram list (R144, R154, R156)', (_n, p) => {
    const model = modelFrom(p.fx);
    const rows = expandPayrollRows(collectAssignments(model), model.week);
    const config = configOf(p);
    const audit = nameAudit(rows, config, model.ctx.roster);
    expect(audit.length ? audit.map(a => ({ cells: [a.name, String(a.sessions), a.statusText, ''], alias: a.alias })) : [{ cells: [NAME_AUDIT_EMPTY], alias: null }]).toStrictEqual(p.payroll.all.audit);
    const map = courseTypeMap(rows, config);
    expect(map.map(m => ({ cells: [m.name, String(m.sessions), m.guess, m.hoursText], selected: m.override, highlighted: m.differs }))).toStrictEqual(
      p.payroll.all.typeMap.map((t: Any) => ({ cells: [t.cells[0], t.cells[1], t.cells[2], t.cells[4]], selected: t.selected, highlighted: t.highlighted })),
    );
    expect(cramSchools(config).join('、')).toBe(p.payroll.all.cram);
  });

  it.each(pipelines.map(p => [p.name, p] as const))('%s: CSV for all rows and an exact coach filter (R163)', (_n, p) => {
    const rows = priced(p);
    const stats = staffStats(rows, configOf(p));
    expect(payrollCsv(rows, coachFilter('', stats)).csv).toBe(p.payroll.csv.all);
    expect(payrollCsv(rows, coachFilter('王偉', stats)).csv).toBe(p.payroll.csv.exact);
  });

  it('與 v40 不同：姓名模糊篩選時 CSV 匯出畫面上那些列，不再是 0 筆（R163）', () => {
    const p = pipelines.find(x => x.name === 'week2-full')!;
    const rows = priced(p);
    const f = coachFilter('王', staffStats(rows, configOf(p)));
    expect(p.payroll.csv.fuzzy.split('\n')).toHaveLength(1);
    const out = payrollCsv(rows, f);
    expect(out.count).toBe(p.payroll.fuzzy.detailRows.length);
    expect(out.csv.split('\n')).toHaveLength(out.count + 1);
    expect(out.note).toBe(`（篩選中：僅 ${out.count} 筆）`);
  });
});

describe('mobile view (R199-R203)', () => {
  it.each(pipelines.map(p => [p.name, p] as const))('%s: summary, issues, day cards and employee cards', (_n, p) => {
    const model = modelFrom(p.fx);
    const rows = expandPayrollRows(collectAssignments(model), model.week);
    const issues = validateWeek(model, availabilityIntervals(availabilityRowsFromApi(p.fx.availability, model.ctx.roster), model.week)).issues;
    expect(mobileSummary(rows, issues).map(s => [s.label, s.value])).toStrictEqual(p.mobile.summary);
    expect(mobileIssueGroups(issues).map(g => ({ head: [g.label, `${g.total} 項`], items: g.items.map(i => `${i.venue}${i.cells ? '｜' + i.cells : ''}${i.text}`) }))).toStrictEqual(p.mobile.issueGroups);
    const card = (items: ReturnType<typeof mobileDays>[number]['items'], withEmployee: boolean) =>
      items.map(w => ({ pill: w.pill.className, pillText: w.pill.label, title: w.title, small: withEmployee ? [w.detail, w.calc, w.employee] : [w.detail, w.calc] }));
    expect(mobileDays(rows).map(d => ({ title: d.title, items: card(d.items, true) }))).toStrictEqual(p.mobile.days);
    expect(mobileEmployees(rows).map(e => ({ title: `${e.name} ${lineBadgeText(e)}`, items: card(e.items, false) }))).toStrictEqual(p.mobile.employees);
  });
});

describe('availability page (R126-R128, R132-R135)', () => {
  it.each(pipelines.map(p => [p.name, p] as const))('%s: rows read from the API and the open-time report', (_n, p) => {
    const model = modelFrom(p.fx);
    const rows = availabilityRowsFromApi(p.fx.availability, model.ctx.roster);
    expect(rows.filter(r => r.name.trim()).map(r => ({ employeeId: String(r.employeeId), name: r.name, venues: r.venues, weekday: r.weekday, sat: r.sat, sun: r.sun }))).toStrictEqual(p.availability.staff);
    const report = availabilityReport(availabilityIntervals(rows, model.week), workEntries(model));
    const want = p.availability.report;
    expect(
      report.length
        ? report.map(r => ({ name: r.name, day: r.day, time: r.timeLabel, busy: r.busy.map(b => ({ cls: b.kind, text: b.text })), busyEmpty: r.busy.length ? null : '尚未排工作', open: r.open }))
        : [{ empty: '目前沒有未排到工作的可用時段，或尚未輸入員工可上課時間。' }],
    ).toStrictEqual(want);
  });
});
