import { computeMetrics } from './eval-metrics.js';
import { CLEAN_LESSON, LESSONS } from '../../test/support/eval-report.js';
import { compareMetrics, formatComparedValue, formatDelta } from './compare.js';

describe('compareMetrics', () => {
  const a = computeMetrics(LESSONS);
  const b = computeMetrics([CLEAN_LESSON]);
  const row = (key: string) => {
    const found = compareMetrics(a, b).find((metric) => metric.key === key);
    if (!found) throw new Error(`no ${key}`);
    return found;
  };

  it('gives B minus A in percentage points for rates, with the right verdict', () => {
    // Rule-pass: 1/3 -> 1, higher is better.
    expect(row('rulePassBeforeRepairRate')).toMatchObject({
      a: 1 / 3,
      b: 1,
      verdict: 'better',
    });
    expect(row('rulePassBeforeRepairRate').delta).toBeCloseTo(66.667, 3);
    // Quote copy: 1/7 -> 0, lower is better.
    expect(row('quoteCopyRate')).toMatchObject({ b: 0, verdict: 'better' });
  });

  it('subtracts costs exactly, as decimal strings', () => {
    expect(row('totalCostUsd')).toMatchObject({
      a: '0.012540',
      b: '0.004850',
      delta: '-0.007690',
      verdict: 'better',
    });
  });

  it('calls a worse value worse, and an equal one the same', () => {
    expect(
      compareMetrics(b, a).find((m) => m.key === 'answerCorrectRate')?.verdict,
    ).toBe('worse');
    expect(
      compareMetrics(a, a).every(
        (m) => m.verdict === 'same' || m.verdict === 'n/a',
      ),
    ).toBe(true);
  });

  it('gives no verdict for the judge cost, or when a side has nothing to measure', () => {
    expect(row('judgeCostUsd').verdict).toBe('n/a');
    const empty = computeMetrics([]);
    const quoteCopy = compareMetrics(empty, b).find(
      (m) => m.key === 'quoteCopyRate',
    );
    expect(quoteCopy).toMatchObject({ a: null, delta: null, verdict: 'n/a' });
  });
});

describe('formatting compared values', () => {
  it('formats each kind of value and difference', () => {
    expect(formatComparedValue('rate', 0.125)).toBe('12.5%');
    expect(formatComparedValue('usd', '0.004850')).toBe('$0.0049');
    expect(formatComparedValue('ms', 12_500)).toBe('12.5 s');
    expect(formatComparedValue('count', 3000)).toBe('3,000');
    expect(formatComparedValue('rate', null)).toBe('–');
    expect(formatDelta('rate', 12.5)).toBe('+12.5 pp');
    expect(formatDelta('usd', '-0.007690')).toBe('-$0.0077');
    expect(formatDelta('count', 0)).toBe('±0');
  });
});
