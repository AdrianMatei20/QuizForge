import type { UsageBucket, UsageReport } from '../core/api/api.types';
import { buildCostChart, formatDay, formatUsd } from './cost-chart.model';

const EMPTY_BUCKET: UsageBucket = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: '0.000000',
  cacheHitRate: null,
  errorRate: null,
  byStatus: { ok: 0, invalid_output: 0, error: 0, budget_exceeded: 0, refused: 0, truncated: 0 },
  estimated: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: '0.000000' },
};

const day = (date: string, feature: string, costUsd: string) => ({
  ...EMPTY_BUCKET,
  date,
  feature,
  calls: 1,
  costUsd,
});

function report(days: UsageReport['days'], from = '2026-10-17', to = '2026-10-19'): UsageReport {
  return { from, to, totals: EMPTY_BUCKET, days };
}

describe('buildCostChart', () => {
  it('has every day of the range, including days without calls', () => {
    const chart = buildCostChart(report([day('2026-10-18', 'quiz-generation', '0.002000')]));

    expect(chart.days.map((d) => [d.date, d.total])).toEqual([
      ['2026-10-17', 0],
      ['2026-10-18', 0.002],
      ['2026-10-19', 0],
    ]);
  });

  it('stacks features per day and totals them', () => {
    const chart = buildCostChart(
      report([
        day('2026-10-19', 'quiz-generation', '0.003000'),
        day('2026-10-19', 'quiz-regeneration', '0.001000'),
      ]),
    );

    expect(chart.days[2]).toEqual({
      date: '2026-10-19',
      values: { 'quiz-generation': 0.003, 'quiz-regeneration': 0.001 },
      total: 0.004,
    });
    expect(chart.total).toBeCloseTo(0.004, 12);
  });

  it('keeps each feature on its own colour, in a fixed order, whatever is present', () => {
    const onlyRegeneration = buildCostChart(
      report([day('2026-10-19', 'quiz-regeneration', '0.001000')]),
    );
    const both = buildCostChart(
      report([
        day('2026-10-19', 'quiz-regeneration', '0.001000'),
        day('2026-10-19', 'quiz-generation', '0.001000'),
      ]),
    );

    // Colour follows the feature, not its rank among the features shown.
    expect(onlyRegeneration.series.map((s) => [s.key, s.color])).toEqual([
      ['quiz-regeneration', 'var(--series-3)'],
    ]);
    expect(both.series.map((s) => s.key)).toEqual(['quiz-generation', 'quiz-regeneration']);
  });

  it('folds unknown features into Other', () => {
    const chart = buildCostChart(
      report([
        day('2026-10-19', 'eval-judge', '0.001000'),
        day('2026-10-19', 'something-else', '0.002000'),
      ]),
    );

    expect(chart.series.map((s) => s.label)).toEqual(['Other']);
    expect(chart.days[2]?.values).toEqual({ other: 0.003 });
  });

  it('rounds the y axis up to a 1-2-5 step', () => {
    const chart = buildCostChart(report([day('2026-10-19', 'quiz-generation', '0.0073')]));

    expect(chart.yMax).toBe(0.008);
    expect(chart.ticks).toEqual([0, 0.002, 0.004, 0.006, 0.008]);
  });

  it('still draws an axis when there is no cost at all', () => {
    const chart = buildCostChart(report([]));

    expect(chart.series).toEqual([]);
    expect(chart.yMax).toBe(1);
    expect(chart.total).toBe(0);
  });
});

describe('formatting', () => {
  it('formats small and large USD amounts readably', () => {
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(0.00004)).toBe('<$0.0001');
    expect(formatUsd(0.0123)).toBe('$0.0123');
    expect(formatUsd(12.5)).toBe('$12.50');
  });

  it('formats a UTC day without shifting it to the local time zone', () => {
    expect(formatDay('2026-10-19')).toBe('Oct 19');
  });
});
