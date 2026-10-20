import { evalReport } from '../../test/support/eval-report.js';
import {
  computeAgreement,
  parseVerdict,
  SAMPLE_COLUMNS,
  sampleRows,
} from './agreement.js';

const header = ['judge_verdict', 'my_verdict'];
const rowsOf = (pairs: [string, string][]) => [header, ...pairs];

describe('computeAgreement', () => {
  it('counts agreement and the 2x2 table, and computes Cohen’s kappa', () => {
    // 10 rows: judge pass/me pass 6, pass/fail 1, fail/pass 1, fail/fail 2.
    const report = computeAgreement(
      rowsOf([
        ...Array.from({ length: 6 }, (): [string, string] => ['pass', 'pass']),
        ['pass', 'fail'],
        ['fail', 'pass'],
        ['fail', 'fail'],
        ['fail', 'FAIL '],
      ]),
    );

    expect(report.matrix).toEqual({
      passPass: 6,
      passFail: 1,
      failPass: 1,
      failFail: 2,
    });
    expect(report.agreement).toBe(0.8);
    // Chance agreement: 0.7 * 0.7 + 0.3 * 0.3 = 0.58; kappa = (0.8 - 0.58) / 0.42.
    expect(report.kappa).toBeCloseTo(0.5238, 4);
  });

  it('skips empty verdicts and reports ones it cannot read', () => {
    const report = computeAgreement(
      rowsOf([
        ['pass', ''],
        ['pass', 'maybe'],
        ['fail', 'n'],
      ]),
    );

    expect(report).toMatchObject({
      compared: 1,
      empty: 1,
      invalidRows: [2],
      agreed: 1,
    });
  });

  it('leaves kappa undefined when both sides always said the same thing', () => {
    const report = computeAgreement(
      rowsOf([
        ['pass', 'pass'],
        ['pass', 'yes'],
      ]),
    );
    expect(report.agreement).toBe(1);
    expect(report.kappa).toBeNull();
  });

  it('names a missing column', () => {
    expect(() => computeAgreement([['judge_verdict']])).toThrow('"my_verdict"');
  });
});

describe('parseVerdict', () => {
  it('accepts the usual ways of writing pass and fail', () => {
    expect(['pass', 'Y', 'true', 'ok'].map(parseVerdict)).toEqual([
      'pass',
      'pass',
      'pass',
      'pass',
    ]);
    expect(['fail', 'N', 'no'].map(parseVerdict)).toEqual([
      'fail',
      'fail',
      'fail',
    ]);
    expect(parseVerdict('  ')).toBe('empty');
  });
});

describe('sampleRows', () => {
  it('samples judged questions only, with an empty my_verdict, the same way for the same random numbers', () => {
    const report = evalReport();
    const random = () => 0.5;
    const rows = sampleRows(report, 4, random);

    expect(rows[0]).toEqual([...SAMPLE_COLUMNS]);
    // 6 judged questions in the fixed report; 4 asked for.
    expect(rows).toHaveLength(5);
    expect(rows.slice(1).every((row) => row.at(-1) === '')).toBe(true);
    expect(sampleRows(report, 4, random)).toEqual(rows);
  });

  it('returns every judged question when there are fewer than asked for', () => {
    expect(sampleRows(evalReport(), 20)).toHaveLength(7);
  });

  it('writes the judge’s overall verdict as pass only when all three checks pass', () => {
    const rows = sampleRows(evalReport(), 20, () => 0);
    const verdictColumn = SAMPLE_COLUMNS.indexOf('judge_verdict');
    expect(
      rows
        .slice(1)
        .map((row) => row[verdictColumn])
        .sort(),
    ).toEqual(['fail', 'fail', 'pass', 'pass', 'pass', 'pass']);
  });
});
