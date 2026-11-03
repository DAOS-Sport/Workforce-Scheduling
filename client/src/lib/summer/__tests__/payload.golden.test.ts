import { describe, expect, it } from 'vitest';
import golden from '../__fixtures__/v40-golden.json';
import { applyDerivedCells } from '../week-model';
import { collectAssignments, collectShiftRows, rawEntriesFromDraft } from '../payload';
import { byKey, modelFrom, type PipelineFixture } from './golden';

const pipelines = golden.pipelines as unknown as { name: string; fx: PipelineFixture; core: { shifts: unknown[]; assignments: unknown[]; rawEntries: { key: string }[] } }[];
const sameAsV40 = pipelines.filter(p => p.name !== 'week3-enrollment-failed');

describe('publish contract: shifts and assignments match v40 field by field (R104-R109, R025-R047)', () => {
  it.each(sameAsV40.map(p => [p.name, p] as const))('%s: assignments (R105, R106)', (_n, p) => {
    expect(collectAssignments(modelFrom(p.fx))).toStrictEqual(p.core.assignments);
  });

  it.each(sameAsV40.map(p => [p.name, p] as const))('%s: shifts (R107, R108, R109)', (_n, p) => {
    const model = modelFrom(p.fx);
    expect(collectShiftRows(collectAssignments(model), model.week)).toStrictEqual(p.core.shifts);
  });

  it.each(sameAsV40.map(p => [p.name, p] as const))('%s: rawEntries after derived writes (R104, R014, R053, R056, R064)', (_n, p) => {
    const model = modelFrom(p.fx);
    expect(byKey(rawEntriesFromDraft(applyDerivedCells(model.draft, model.derivedCells)))).toStrictEqual(byKey(p.core.rawEntries));
  });
});
