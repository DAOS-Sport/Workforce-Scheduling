import { describe, expect, it } from 'vitest';
import golden from '../__fixtures__/v40-golden.json';
import { availabilityIntervals, availabilityRowsFromApi } from '../availability';
import { validateWeek } from '../validate';
import { modelFrom, type PipelineFixture } from './golden';

interface Captured {
  courseCells: { key: string; tone: string; text: string; conflict: boolean }[];
  dutyCells: { key: string; tone: string; text: string; conflict: boolean }[];
  issues: { venue: string; cells: string; text: string; type: string }[];
}
const pipelines = golden.pipelines as unknown as { name: string; fx: PipelineFixture & { availability: Record<string, unknown>[] }; core: Captured & { issueRowsWithIssue: number }; withAvailability: Captured }[];
const sameAsV40 = pipelines.filter(p => p.name !== 'week3-enrollment-failed');

function statusesOf(p: (typeof pipelines)[number], withAvailability: boolean) {
  const model = modelFrom(p.fx);
  const avails = withAvailability ? availabilityIntervals(availabilityRowsFromApi(p.fx.availability, model.ctx.roster), model.week) : [];
  return validateWeek(model, avails);
}

const asCaptured = (keys: string[], v: ReturnType<typeof statusesOf>) =>
  keys.map(key => ({ key, ...(v.statuses.get(key) ?? { tone: 'missing', text: '', conflict: false }) }));

describe('cell validation and issue list match v40 (R080-R092)', () => {
  it.each(sameAsV40.map(p => [p.name, p] as const))('%s: course coach cell statuses (R023, R080, R081, R082, R085, R088, R094)', (_n, p) => {
    const v = statusesOf(p, false);
    expect(asCaptured(p.core.courseCells.map(c => c.key), v)).toStrictEqual(p.core.courseCells);
  });

  it.each(sameAsV40.map(p => [p.name, p] as const))('%s: duty grid cell statuses (R083, R085)', (_n, p) => {
    const v = statusesOf(p, false);
    expect(asCaptured(p.core.dutyCells.map(c => c.key), v)).toStrictEqual(p.core.dutyCells);
  });

  it.each(sameAsV40.map(p => [p.name, p] as const))('%s: issue list with grouping type (R090, R091, R092)', (_n, p) => {
    const v = statusesOf(p, false);
    expect(v.issues).toStrictEqual(p.core.issues);
    expect(v.issueRows.size).toBe(p.core.issueRowsWithIssue);
  });

  it.each(sameAsV40.map(p => [p.name, p] as const))('%s: availability conflicts appended after work conflicts (R089, R094, R228)', (_n, p) => {
    const v = statusesOf(p, true);
    expect(asCaptured(p.withAvailability.courseCells.map(c => c.key), v)).toStrictEqual(p.withAvailability.courseCells);
    expect(asCaptured(p.withAvailability.dutyCells.map(c => c.key), v)).toStrictEqual(p.withAvailability.dutyCells);
    expect(v.issues).toStrictEqual(p.withAvailability.issues);
  });
});
