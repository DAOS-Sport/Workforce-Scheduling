import { describe, expect, it } from 'vitest';
import golden from '../__fixtures__/v40-golden.json';
import { validateWeek } from '../validate';
import { coachPlaceholder, enrollCellView, renderedCellKeys } from '../week-model';
import { modelFrom, type PipelineFixture } from './golden';

interface RowCapture {
  venue: string;
  rowId: string;
  zeroEnroll: boolean;
  forceOpen: boolean;
  closed: boolean;
  hasIssue: boolean;
  enrollText: string;
  enrollClass: string;
  enrollTitle: string | null;
  neededText: string;
  placeholders: string[];
}
const pipelines = golden.pipelines as unknown as { name: string; fx: PipelineFixture; core: { rows: RowCapture[]; dataKeys: string[] } }[];
const sameAsV40 = pipelines.filter(p => p.name !== 'week3-enrollment-failed');

describe('course rows as rendered by v40 (R048, R052-R056, R063, R064, R070)', () => {
  it.each(pipelines.map(p => [p.name, p] as const))('%s: every rendered cell key is generated in the same order (R043, R070, R221, 4.2)', (_n, p) => {
    expect(renderedCellKeys(modelFrom(p.fx))).toStrictEqual(p.core.dataKeys);
  });

  it.each(sameAsV40.map(p => [p.name, p] as const))('%s: row flags, enrollment cell and needed count (R052-R056, R063, R064, R090)', (_n, p) => {
    const model = modelFrom(p.fx);
    const v = validateWeek(model);
    const mine = model.venues.flatMap(({ venue, courseRows }) =>
      courseRows.map(row => {
        const view = row.kind === 'manual' ? null : enrollCellView(row.enroll);
        return {
          venue: venue.name,
          rowId: row.rowId,
          zeroEnroll: row.kind !== 'manual' && row.zeroEnroll,
          forceOpen: row.kind !== 'manual' && row.forceOpen,
          closed: row.kind !== 'manual' && row.enroll.kind === 'closed',
          hasIssue: v.issueRows.has(`${venue.name}|${row.rowId}`),
          enrollText: row.enrollText,
          enrollClass: view ? view.className : '',
          enrollTitle: view ? view.title : null,
          neededText: row.neededText,
          placeholders: row.coachCells.map(c => coachPlaceholder(row, c)),
        };
      }),
    );
    expect(mine).toStrictEqual(p.core.rows);
  });
});
