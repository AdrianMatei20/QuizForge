import type { UsageRow } from '../llm/llm-call.store.js';
import { buildUsageReport } from './usage-report.js';
import { resolveUsageRange } from './usage-range.js';

function row(overrides: Partial<UsageRow>): UsageRow {
  return {
    day: '2026-10-18',
    feature: 'quiz-generation',
    status: 'ok',
    calls: 1,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: '0.000000',
    cacheHits: 0,
    estimatedCalls: 0,
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    estimatedCostUsd: '0.000000',
    ...overrides,
  };
}

const RANGE = { from: '2026-10-18', to: '2026-10-19' };

describe('buildUsageReport', () => {
  // Day 1, quiz-generation: 3 ok (1 cache hit), 1 invalid_output.
  // Day 1, quiz-regeneration: 1 ok.
  // Day 2, quiz-generation-stream: 1 ok, 1 aborted (error) with estimated usage.
  const rows: UsageRow[] = [
    row({
      status: 'ok',
      calls: 3,
      inputTokens: 3_000,
      outputTokens: 1_500,
      costUsd: '0.100000',
      cacheHits: 1,
    }),
    row({
      status: 'invalid_output',
      calls: 1,
      inputTokens: 900,
      outputTokens: 400,
      costUsd: '0.200000',
    }),
    row({
      feature: 'quiz-regeneration',
      calls: 1,
      inputTokens: 100,
      outputTokens: 50,
      costUsd: '0.000300',
    }),
    row({
      day: '2026-10-19',
      feature: 'quiz-generation-stream',
      calls: 1,
      inputTokens: 500,
      outputTokens: 250,
      costUsd: '0.000600',
    }),
    row({
      day: '2026-10-19',
      feature: 'quiz-generation-stream',
      status: 'error',
      calls: 1,
      inputTokens: 1_234,
      outputTokens: 2,
      costUsd: '0.002488',
      estimatedCalls: 1,
      estimatedInputTokens: 1_234,
      estimatedOutputTokens: 2,
      estimatedCostUsd: '0.002488',
    }),
  ];

  const report = buildUsageReport(rows, RANGE);

  it('sums everything into the totals, with costs added exactly', () => {
    expect(report.totals).toMatchObject({
      calls: 7,
      inputTokens: 5_734,
      outputTokens: 2_202,
      // 0.1 + 0.2 is 0.30000000000000004 as floats; here it is exact.
      costUsd: '0.303388',
    });
  });

  it('computes the cache-hit and error rates from the sums', () => {
    expect(report.totals.cacheHitRate).toBeCloseTo(1 / 7, 12);
    // invalid_output + error, of 7 calls.
    expect(report.totals.errorRate).toBeCloseTo(2 / 7, 12);
  });

  it('counts calls per status, every status present', () => {
    expect(report.totals.byStatus).toEqual({
      ok: 5,
      invalid_output: 1,
      error: 1,
      budget_exceeded: 0,
      refused: 0,
      truncated: 0,
    });
  });

  it('reports the estimated part separately, while still counting it in the totals', () => {
    expect(report.totals.estimated).toEqual({
      calls: 1,
      inputTokens: 1_234,
      outputTokens: 2,
      costUsd: '0.002488',
    });
  });

  it('has one bucket per day and feature, ordered by day then feature', () => {
    expect(
      report.days.map((day) => [day.date, day.feature, day.calls]),
    ).toEqual([
      ['2026-10-18', 'quiz-generation', 4],
      ['2026-10-18', 'quiz-regeneration', 1],
      ['2026-10-19', 'quiz-generation-stream', 2],
    ]);
    expect(report.days[0]).toMatchObject({
      costUsd: '0.300000',
      cacheHitRate: 0.25,
      errorRate: 0.25,
      byStatus: expect.objectContaining({ ok: 3, invalid_output: 1 }),
    });
    expect(report.days[2]?.estimated.calls).toBe(1);
  });

  it('reports null rates, zero sums and no days when nothing happened', () => {
    const empty = buildUsageReport([], RANGE);

    expect(empty).toMatchObject({
      from: '2026-10-18',
      to: '2026-10-19',
      days: [],
      totals: {
        calls: 0,
        costUsd: '0.000000',
        cacheHitRate: null,
        errorRate: null,
        estimated: { calls: 0, costUsd: '0.000000' },
      },
    });
  });
});

describe('resolveUsageRange', () => {
  const NOW = new Date('2026-10-19T15:00:00.000Z');

  it('defaults to the last 7 UTC days, today included', () => {
    expect(resolveUsageRange({}, NOW)).toEqual({
      from: '2026-10-13',
      to: '2026-10-19',
      fromDate: new Date('2026-10-13T00:00:00.000Z'),
      toExclusive: new Date('2026-10-20T00:00:00.000Z'),
    });
  });

  it('accepts an explicit range, both ends inclusive', () => {
    expect(
      resolveUsageRange({ from: '2026-10-01', to: '2026-10-01' }, NOW),
    ).toMatchObject({
      fromDate: new Date('2026-10-01T00:00:00.000Z'),
      toExclusive: new Date('2026-10-02T00:00:00.000Z'),
    });
  });

  it.each([
    [{ from: '2026-13-01' }, 'from', 'from must be a date as YYYY-MM-DD'],
    [{ to: '2026-02-31' }, 'to', 'to must be a date as YYYY-MM-DD'],
    [{ from: '19-10-2026' }, 'from', 'from must be a date as YYYY-MM-DD'],
    [
      { from: '2026-10-20', to: '2026-10-19' },
      'from',
      'from must not be after to',
    ],
    [
      { from: '2025-01-01', to: '2026-10-19' },
      'from',
      'the range can be at most 366 days',
    ],
  ])(
    'rejects %j with a 400 naming the parameter',
    (query, parameter, detail) => {
      let thrown: unknown;
      try {
        resolveUsageRange(query, NOW);
      } catch (error) {
        thrown = error;
      }

      expect((thrown as { problem: unknown }).problem).toMatchObject({
        status: 400,
        errors: [{ parameter, detail }],
      });
    },
  );
});
