import { Component, computed, input, signal } from '@angular/core';
import type { UsageReport } from '../core/api/api.types';
import {
  buildCostChart,
  type ChartDay,
  type ChartSeries,
  formatDay,
  formatUsd,
} from './cost-chart.model';

const WIDTH = 720;
const HEIGHT = 260;
const MARGIN = { top: 12, right: 8, bottom: 28, left: 64 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;
/** Surface-coloured gap between stacked segments (the spacer). */
const GAP = 2;
const RADIUS = 4;

interface Segment {
  key: string;
  color: string;
  /** SVG path: a rectangle, rounded at the top for the topmost segment. */
  path: string;
}

interface Column {
  day: ChartDay;
  x: number;
  width: number;
  segments: Segment[];
  label?: string;
}

/** A rectangle with only its top corners rounded (data ends rounded, baseline square). */
function barPath(x: number, y: number, width: number, height: number, rounded: boolean): string {
  const r = rounded ? Math.min(RADIUS, width / 2, height) : 0;
  return [
    `M${x},${y + height}`,
    `V${y + r}`,
    r ? `Q${x},${y} ${x + r},${y}` : '',
    `H${x + width - r}`,
    r ? `Q${x + width},${y} ${x + width},${y + r}` : '',
    `V${y + height}`,
    'Z',
  ].join(' ');
}

/**
 * Daily LLM cost by feature, as stacked bars in plain SVG. Presentational:
 * the numbers come from GET /api/usage. Identity is never colour alone (a
 * legend names every series, and a table shows the same numbers); hovering a
 * day shows its breakdown.
 */
@Component({
  selector: 'app-cost-chart',
  templateUrl: './cost-chart.html',
  styleUrl: './cost-chart.scss',
})
export class CostChart {
  readonly report = input.required<UsageReport>();

  protected readonly width = WIDTH;
  protected readonly height = HEIGHT;
  protected readonly margin = MARGIN;
  protected readonly plotWidth = PLOT_WIDTH;
  protected readonly formatUsd = formatUsd;
  protected readonly formatDay = formatDay;

  protected readonly data = computed(() => buildCostChart(this.report()));
  protected readonly showTable = signal(false);
  /** Index of the hovered day, for the tooltip. */
  protected readonly hovered = signal<number | null>(null);

  protected readonly y = (value: number) =>
    MARGIN.top + PLOT_HEIGHT - (value / this.data().yMax) * PLOT_HEIGHT;

  protected readonly columns = computed((): Column[] => {
    const { days, series, yMax } = this.data();
    const band = PLOT_WIDTH / Math.max(days.length, 1);
    const width = Math.max(4, Math.min(28, band * 0.6));
    // At most ~8 date labels, so they never collide.
    const labelEvery = Math.ceil(days.length / 8);
    return days.map((day, index) => {
      const x = MARGIN.left + band * index + (band - width) / 2;
      const present = series.filter((candidate) => (day.values[candidate.key] ?? 0) > 0);
      let base = 0;
      const segments = present.map((candidate: ChartSeries, i): Segment => {
        const value = day.values[candidate.key] ?? 0;
        const bottom = MARGIN.top + PLOT_HEIGHT - (base / yMax) * PLOT_HEIGHT;
        base += value;
        const top = MARGIN.top + PLOT_HEIGHT - (base / yMax) * PLOT_HEIGHT;
        // Leave a gap under every segment but the first, so the stack reads as parts.
        const gap = i === 0 ? 0 : GAP;
        const height = Math.max(0, bottom - top - gap);
        return {
          key: candidate.key,
          color: candidate.color,
          path: barPath(x, top, width, height, i === present.length - 1),
        };
      });
      return {
        day,
        x,
        width,
        segments,
        ...(index % labelEvery === 0 ? { label: formatDay(day.date) } : {}),
      };
    });
  });

  protected readonly summary = computed(() => {
    const { days, total } = this.data();
    const report = this.report();
    if (total === 0) {
      return `Daily LLM cost by feature, ${formatDay(report.from)} to ${formatDay(report.to)}: no cost in this range.`;
    }
    const peak = days.reduce((best, day) => (day.total > best.total ? day : best));
    return (
      `Daily LLM cost by feature, ${formatDay(report.from)} to ${formatDay(report.to)}. ` +
      `Total ${formatUsd(total)}; highest on ${formatDay(peak.date)} at ${formatUsd(peak.total)}. ` +
      'The table below has every value.'
    );
  });

  /** Tooltip position as a percentage of the chart width, so it scales with the SVG. */
  protected tooltipLeft(column: Column): number {
    return ((column.x + column.width / 2) / WIDTH) * 100;
  }
}
