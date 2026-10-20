import type { ComparedMetric, EvalRunSummary } from '../core/api/api.types';

/** "83.3%", or "–" when there was nothing to divide by. */
export function formatRate(rate: number | null): string {
  if (rate === null) {
    return '–';
  }
  const percent = rate * 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;
}

/** "$0.0123": 4 decimals, enough to tell eval runs of a few cents apart. */
export function formatCost(costUsd: string | number): string {
  return `$${Number(costUsd).toFixed(4)}`;
}

/** A compared value as text, the same way the Markdown reports show it. */
export function formatComparedValue(
  format: ComparedMetric['format'],
  value: ComparedMetric['a'],
): string {
  if (value === null) {
    return '–';
  }
  switch (format) {
    case 'rate':
      return formatRate(Number(value));
    case 'usd':
      return formatCost(value);
    case 'ms':
      return `${(Number(value) / 1000).toFixed(1)} s`;
    case 'count':
      return Number(value).toLocaleString('en-US');
  }
}

/** B minus A with its sign: "+12.5 pp" for rates (percentage points), "-$0.0040" for costs. */
export function formatDelta(
  format: ComparedMetric['format'],
  delta: ComparedMetric['delta'],
): string {
  if (delta === null) {
    return '–';
  }
  const value = Number(delta);
  const sign = value > 0 ? '+' : value < 0 ? '−' : '±';
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

/** "quiz v2 · claude-haiku-5-5 · effort low", the way runs are named in the UI. */
export function runLabel(run: EvalRunSummary): string {
  return `${run.promptId} v${run.promptVersion} · ${run.model} · effort ${run.effort ?? 'default'}`;
}
