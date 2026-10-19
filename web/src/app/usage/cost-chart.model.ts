import type { UsageReport } from '../core/api/api.types';

export interface ChartSeries {
  key: string;
  label: string;
  /** A CSS custom property set by the chart's styles (see cost-chart.scss). */
  color: string;
}

/**
 * Colour follows the feature, never its rank: each known feature has a fixed
 * slot of the validated categorical palette, so a date range that hides one
 * feature does not repaint the others. Anything else folds into "Other"
 * (a neutral, not a generated hue).
 */
export const FEATURE_SERIES: readonly (ChartSeries & { feature: string })[] = [
  {
    key: 'quiz-generation',
    feature: 'quiz-generation',
    label: 'Quiz generation',
    color: 'var(--series-1)',
  },
  {
    key: 'quiz-generation-stream',
    feature: 'quiz-generation-stream',
    label: 'Quiz generation (streamed)',
    color: 'var(--series-2)',
  },
  {
    key: 'quiz-regeneration',
    feature: 'quiz-regeneration',
    label: 'Question regeneration',
    color: 'var(--series-3)',
  },
];

export const OTHER_SERIES: ChartSeries = {
  key: 'other',
  label: 'Other',
  color: 'var(--series-other)',
};

export interface ChartDay {
  date: string;
  /** USD per series key; only keys with a cost appear. */
  values: Record<string, number>;
  total: number;
}

export interface CostChartData {
  /** Every day of the range, including days without calls. */
  days: ChartDay[];
  /** Series that have a cost somewhere in the range, in fixed order. */
  series: ChartSeries[];
  /** Top of the y axis: a round number at or above the highest day. */
  yMax: number;
  /** Grid lines and axis labels, from 0 to yMax. */
  ticks: number[];
  total: number;
}

const DAY_MS = 86_400_000;

function seriesFor(feature: string): ChartSeries {
  return FEATURE_SERIES.find((series) => series.feature === feature) ?? OTHER_SERIES;
}

/** A step of 1, 2 or 5 x 10^n, so ticks read 0, 0.002, 0.004 ... not 0, 0.0017 ... */
function niceStep(max: number, targetTicks: number): number {
  const raw = max / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

/**
 * The chart's data from the usage report: daily cost by feature, stacked.
 * Costs arrive as exact decimal strings; they become numbers here only to
 * be drawn (the table and totals show the API's own strings).
 */
export function buildCostChart(report: UsageReport): CostChartData {
  const byDate = new Map<string, Record<string, number>>();
  const present = new Set<string>();
  for (const bucket of report.days) {
    const cost = Number(bucket.costUsd);
    if (cost === 0) continue;
    const series = seriesFor(bucket.feature);
    const values = byDate.get(bucket.date) ?? {};
    values[series.key] = (values[series.key] ?? 0) + cost;
    byDate.set(bucket.date, values);
    present.add(series.key);
  }

  const days: ChartDay[] = [];
  const start = new Date(`${report.from}T00:00:00.000Z`).getTime();
  const end = new Date(`${report.to}T00:00:00.000Z`).getTime();
  for (let time = start; time <= end; time += DAY_MS) {
    const date = new Date(time).toISOString().slice(0, 10);
    const values = byDate.get(date) ?? {};
    const total = Object.values(values).reduce((sum, value) => sum + value, 0);
    days.push({ date, values, total });
  }

  const series = [...FEATURE_SERIES, OTHER_SERIES].filter((candidate) =>
    present.has(candidate.key),
  );
  const highest = Math.max(0, ...days.map((day) => day.total));
  const step = highest === 0 ? 1 : niceStep(highest, 4);
  const yMax = highest === 0 ? 1 : Math.ceil(highest / step) * step;
  const ticks: number[] = [];
  for (let tick = 0; tick <= yMax + step / 2; tick += step) {
    ticks.push(Number(tick.toPrecision(12)));
  }
  return {
    days,
    series,
    yMax,
    ticks,
    total: days.reduce((sum, day) => sum + day.total, 0),
  };
}

/** USD for display: cents for amounts of a dollar or more, otherwise 4 decimals. */
export function formatUsd(value: number): string {
  if (value === 0) return '$0';
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value < 0.0001) return '<$0.0001';
  return `$${value.toFixed(4)}`;
}

/** "2026-10-19" -> "Oct 19" (the dates are UTC days). */
export function formatDay(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
