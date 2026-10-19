import {
  LLM_CALL_STATUSES,
  type LlmCallStatus,
} from '../llm/llm-call.entity.js';
import type { UsageRow } from '../llm/llm-call.store.js';
import { formatUsd, parseUsd } from '../llm/money.js';

export interface EstimatedUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Decimal USD string. */
  costUsd: string;
}

export interface UsageBucket {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Decimal USD string, summed exactly. Includes estimated rows. */
  costUsd: string;
  /** Cache hits / calls; null with no calls. */
  cacheHitRate: number | null;
  /** Calls whose status is not "ok" / calls; null with no calls. */
  errorRate: number | null;
  byStatus: Record<LlmCallStatus, number>;
  /** The part of the above that is estimated (streams that never got final usage). */
  estimated: EstimatedUsage;
}

export interface UsageReport {
  /** Inclusive UTC days, YYYY-MM-DD. */
  from: string;
  to: string;
  totals: UsageBucket;
  /** One entry per (day, feature) with calls, ordered by day then feature. */
  days: (UsageBucket & { date: string; feature: string })[];
}

/** Running sums for one bucket; cost in exact micro-dollars. */
interface Sums {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costMicros: bigint;
  cacheHits: number;
  byStatus: Record<LlmCallStatus, number>;
  estimatedCalls: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostMicros: bigint;
}

function emptySums(): Sums {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costMicros: 0n,
    cacheHits: 0,
    byStatus: Object.fromEntries(
      LLM_CALL_STATUSES.map((status) => [status, 0]),
    ) as Record<LlmCallStatus, number>,
    estimatedCalls: 0,
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    estimatedCostMicros: 0n,
  };
}

function add(sums: Sums, row: UsageRow): void {
  sums.calls += row.calls;
  sums.inputTokens += row.inputTokens;
  sums.outputTokens += row.outputTokens;
  sums.costMicros += parseUsd(row.costUsd);
  sums.cacheHits += row.cacheHits;
  sums.byStatus[row.status] += row.calls;
  sums.estimatedCalls += row.estimatedCalls;
  sums.estimatedInputTokens += row.estimatedInputTokens;
  sums.estimatedOutputTokens += row.estimatedOutputTokens;
  sums.estimatedCostMicros += parseUsd(row.estimatedCostUsd);
}

/** A ratio, or null when there is nothing to divide by (0 would read as "never"). */
function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function toBucket(sums: Sums): UsageBucket {
  return {
    calls: sums.calls,
    inputTokens: sums.inputTokens,
    outputTokens: sums.outputTokens,
    costUsd: formatUsd(sums.costMicros),
    cacheHitRate: rate(sums.cacheHits, sums.calls),
    errorRate: rate(sums.calls - sums.byStatus.ok, sums.calls),
    byStatus: sums.byStatus,
    estimated: {
      calls: sums.estimatedCalls,
      inputTokens: sums.estimatedInputTokens,
      outputTokens: sums.estimatedOutputTokens,
      costUsd: formatUsd(sums.estimatedCostMicros),
    },
  };
}

/**
 * The usage report from rows grouped by (UTC day, feature, status). Pure, so
 * the arithmetic is unit-tested without a database: sums per day and
 * feature, totals over everything, rates from the sums, and per-status counts.
 */
export function buildUsageReport(
  rows: readonly UsageRow[],
  range: { from: string; to: string },
): UsageReport {
  const totals = emptySums();
  const buckets = new Map<
    string,
    { date: string; feature: string; sums: Sums }
  >();
  for (const row of rows) {
    add(totals, row);
    const key = `${row.day} ${row.feature}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { date: row.day, feature: row.feature, sums: emptySums() };
      buckets.set(key, bucket);
    }
    add(bucket.sums, row);
  }
  const days = [...buckets.values()]
    .sort((a, b) =>
      a.date === b.date
        ? a.feature.localeCompare(b.feature)
        : a.date.localeCompare(b.date),
    )
    .map(({ date, feature, sums }) => ({ date, feature, ...toBucket(sums) }));
  return { from: range.from, to: range.to, totals: toBucket(totals), days };
}
