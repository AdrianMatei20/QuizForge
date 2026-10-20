import { formatUsd, parseUsd } from '../llm/money.js';
import { formatCost, formatRate, formatSeconds } from './eval-report.js';
import type { EvalMetrics } from './eval.types.js';

/** Which way is good for a metric; "neutral" ones are shown without a verdict. */
export type Direction = 'higher' | 'lower' | 'neutral';
export type MetricFormat = 'rate' | 'count' | 'usd' | 'ms';
export type Verdict = 'better' | 'worse' | 'same' | 'n/a';

export interface ComparedMetric {
  key: string;
  label: string;
  format: MetricFormat;
  direction: Direction;
  /** Rates are 0..1 (null when nothing to divide by); costs are decimal strings. */
  a: number | string | null;
  b: number | string | null;
  /** b - a; for rates, in percentage points. Null when either side is null. */
  delta: number | string | null;
  verdict: Verdict;
}

interface MetricDefinition {
  key: string;
  label: string;
  format: MetricFormat;
  direction: Direction;
  read: (metrics: EvalMetrics) => number | string | null;
}

/** The metrics a comparison shows, in report order. */
export const COMPARED_METRICS: readonly MetricDefinition[] = [
  {
    key: 'schemaValidRate',
    label: 'Schema-valid (first answer)',
    format: 'rate',
    direction: 'higher',
    read: (m) => m.schemaValidRate,
  },
  {
    key: 'rulePassBeforeRepairRate',
    label: 'Rule-pass before repair',
    format: 'rate',
    direction: 'higher',
    read: (m) => m.rulePassBeforeRepairRate,
  },
  {
    key: 'repairRate',
    label: 'Repair rate',
    format: 'rate',
    direction: 'lower',
    read: (m) => m.repairRate,
  },
  {
    key: 'sourceQuoteFoundRate',
    label: 'sourceQuote found',
    format: 'rate',
    direction: 'higher',
    read: (m) => m.sourceQuoteFoundRate,
  },
  {
    key: 'duplicateStemRate',
    label: 'Duplicate stems',
    format: 'rate',
    direction: 'lower',
    read: (m) => m.duplicateStemRate,
  },
  {
    key: 'quoteCopyRate',
    label: 'Quote copy',
    format: 'rate',
    direction: 'lower',
    read: (m) => m.quoteCopyRate,
  },
  {
    key: 'sharedQuoteRate',
    label: 'Shared quote',
    format: 'rate',
    direction: 'lower',
    read: (m) => m.sharedQuoteRate,
  },
  {
    key: 'questionsDropped',
    label: 'Questions dropped',
    format: 'count',
    direction: 'lower',
    read: (m) => m.questionsDropped,
  },
  {
    key: 'answerCorrectRate',
    label: 'Judge: answer correct',
    format: 'rate',
    direction: 'higher',
    read: (m) => m.answerCorrectRate,
  },
  {
    key: 'answerableFromLessonRate',
    label: 'Judge: answerable from lesson',
    format: 'rate',
    direction: 'higher',
    read: (m) => m.answerableFromLessonRate,
  },
  {
    key: 'testsUnderstandingRate',
    label: 'Judge: tests understanding',
    format: 'rate',
    direction: 'higher',
    read: (m) => m.testsUnderstandingRate,
  },
  {
    key: 'judgeErrors',
    label: 'Questions not judged',
    format: 'count',
    direction: 'lower',
    read: (m) => m.judgeErrors,
  },
  {
    key: 'generationOutputTokens',
    label: 'Generation output tokens',
    format: 'count',
    direction: 'lower',
    read: (m) => m.generation.outputTokens,
  },
  {
    key: 'generationLatencyMs',
    label: 'Generation time (total)',
    format: 'ms',
    direction: 'lower',
    read: (m) => m.generation.latencyMsTotal,
  },
  {
    key: 'generationCostUsd',
    label: 'Generation cost',
    format: 'usd',
    direction: 'lower',
    read: (m) => m.generation.costUsd,
  },
  // Judge cost depends on the judge model and its cache, not on the prompt under test.
  {
    key: 'judgeCostUsd',
    label: 'Judge cost',
    format: 'usd',
    direction: 'neutral',
    read: (m) => m.judge.costUsd,
  },
  {
    key: 'totalCostUsd',
    label: 'Total cost',
    format: 'usd',
    direction: 'lower',
    read: (m) => m.totalCostUsd,
  },
];

function difference(
  a: number | string,
  b: number | string,
  format: MetricFormat,
): number | string {
  if (format === 'usd') {
    // Exact, in micro-dollars; formatUsd only takes amounts of 0 or more.
    const micros = parseUsd(String(b)) - parseUsd(String(a));
    return micros < 0n ? `-${formatUsd(-micros)}` : formatUsd(micros);
  }
  const delta = Number(b) - Number(a);
  return format === 'rate' ? delta * 100 : delta;
}

function verdictOf(
  delta: number | string | null,
  direction: Direction,
): Verdict {
  if (delta === null || direction === 'neutral') {
    return 'n/a';
  }
  const value = Number(delta);
  // Rates are compared in percentage points; a hair's difference is "same".
  if (Math.abs(value) < 1e-9) {
    return 'same';
  }
  return value > 0 === (direction === 'higher') ? 'better' : 'worse';
}

/** Run B against run A, metric by metric: B - A, and whether that is an improvement. */
export function compareMetrics(
  a: EvalMetrics,
  b: EvalMetrics,
): ComparedMetric[] {
  return COMPARED_METRICS.map((metric) => {
    const valueA = metric.read(a);
    const valueB = metric.read(b);
    const delta =
      valueA === null || valueB === null
        ? null
        : difference(valueA, valueB, metric.format);
    return {
      key: metric.key,
      label: metric.label,
      format: metric.format,
      direction: metric.direction,
      a: valueA,
      b: valueB,
      delta,
      verdict: verdictOf(delta, metric.direction),
    };
  });
}

/** A compared value as text, the same way the reports show it. */
export function formatComparedValue(
  format: MetricFormat,
  value: number | string | null,
): string {
  if (value === null) {
    return '–';
  }
  switch (format) {
    case 'rate':
      return formatRate(Number(value));
    case 'usd':
      return formatCost(String(value));
    case 'ms':
      return formatSeconds(Number(value));
    case 'count':
      return Number(value).toLocaleString('en-US');
  }
}

/** b - a with its sign: "+12.5 pp" for rates, "-$0.0040" for costs. */
export function formatDelta(
  format: MetricFormat,
  delta: number | string | null,
): string {
  if (delta === null) {
    return '–';
  }
  const value = Number(delta);
  const sign = value > 0 ? '+' : value < 0 ? '-' : '±';
  const size = Math.abs(value);
  switch (format) {
    case 'rate':
      return `${sign}${size.toFixed(1)} pp`;
    case 'usd':
      return `${sign}$${size.toFixed(4)}`;
    case 'ms':
      return `${sign}${(size / 1000).toFixed(1)} s`;
    case 'count':
      return `${sign}${size.toLocaleString('en-US')}`;
  }
}
