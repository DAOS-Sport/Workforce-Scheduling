import { describe, expect, it } from 'vitest';
import golden from '../__fixtures__/v40-golden.json';
import { collectAssignments, collectShiftRows, rawEntriesFromDraft } from '../payload';
import { validateWeek } from '../validate';
import { applyDerivedCells } from '../week-model';
import { byKey, modelFrom, type PipelineFixture } from './golden';

type Shift = { notes: string; originalAssignment: { registeredCount: string; requiredCoaches: string } };
const p = golden.pipelines.find(x => x.name === 'week3-enrollment-failed') as unknown as {
  fx: PipelineFixture;
  core: { shifts: Shift[]; rawEntries: { key: string; value: string }[]; courseCells: { key: string; tone: string; text: string }[] };
};
const A = 'w3-新北高中-course-一般游泳_6足歲以上-A';
const B = 'w3-新北高中-course-一般游泳_6足歲以上-B';

describe('與 v40 不同：報名人數 API 失敗時人數視為未知，不把需教練改成 0（R057）', () => {
  it('v40 washed the needed counts to 0 and published 報名 0 人', () => {
    const v40 = Object.fromEntries(p.core.rawEntries.map(e => [e.key, e.value]));
    expect([v40[`${A}-needed`], v40[`${B}-needed`], v40[`${A}-enroll`]]).toStrictEqual(['0', '0', '0']);
    expect(p.core.shifts[0].notes).toBe('暑假課程｜一般游泳(6足歲以上)｜A｜報名 0 人｜需求 0 位');
  });

  it('keeps the stored needed counts and writes no enrollment cells', () => {
    const model = modelFrom(p.fx);
    const saved = byKey(rawEntriesFromDraft(applyDerivedCells(model.draft, model.derivedCells)));
    const expected = byKey(p.fx.rawEntries.map(e => ({ key: String(e.key), value: e.key === `${A}-weekday` ? '王偉12' : String(e.value), employees: [] })));
    expect(saved).toStrictEqual(expected);
  });

  it('publishes the same shifts with the unknown count left out of the notes', () => {
    const model = modelFrom(p.fx);
    const want = p.core.shifts.map(s => ({
      ...s,
      notes: '暑假課程｜一般游泳(6足歲以上)｜A｜需求 2 位',
      originalAssignment: { ...s.originalAssignment, registeredCount: '', requiredCoaches: '2' },
    }));
    expect(collectShiftRows(collectAssignments(model), model.week)).toStrictEqual(want);
  });

  it('validates against the real needed count instead of reporting 報名 0 人', () => {
    const v = validateWeek(modelFrom(p.fx));
    expect(p.core.courseCells.find(c => c.key === `${A}-weekday`)).toMatchObject({ tone: 'ok', text: '報名 0 人｜教練 0' });
    expect(v.statuses.get(`${A}-weekday`)).toStrictEqual({ tone: 'warn', text: '一不足1/2、二不足1/2、三不足0/2、四不足0/2、五不足0/2', conflict: false });
    expect(v.statuses.get(`${B}-weekday`)).toStrictEqual({ tone: 'warn', text: '教練不足：0/1', conflict: false });
  });
});
