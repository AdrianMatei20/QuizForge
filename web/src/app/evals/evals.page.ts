import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { EvalRunSummary } from '../core/api/api.types';
import { EvalsApi } from '../core/api/evals.api';
import { AppError, toAppError } from '../core/errors/app-error';
import { ErrorMessage } from '../shared/error-message';
import { formatCost, formatRate } from './eval-format';

/**
 * /evals: every eval run (`npm run eval` in api/) with its headline metrics.
 * Pick two runs to compare them; the older one is the baseline (A).
 */
@Component({
  selector: 'app-evals-page',
  imports: [DatePipe, ErrorMessage, RouterLink],
  templateUrl: './evals.page.html',
  styleUrl: './evals.page.scss',
})
export class EvalsPage {
  private readonly evalsApi = inject(EvalsApi);

  protected readonly runs = signal<EvalRunSummary[] | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<AppError | null>(null);
  /** Dry runs use the fake provider, so their numbers mean nothing: hidden unless asked for. */
  protected readonly showDryRuns = signal(false);
  protected readonly selected = signal<readonly string[]>([]);

  protected readonly formatRate = formatRate;
  protected readonly formatCost = formatCost;

  /** The two selected runs, older first, as the compare view's query parameters. */
  protected readonly comparison = computed(() => {
    const ids = this.selected();
    const runs = this.runs() ?? [];
    if (ids.length !== 2) {
      return null;
    }
    const [newer, older] = runs.filter((run) => ids.includes(run.id));
    return newer && older ? { a: older.id, b: newer.id } : null;
  });

  constructor() {
    effect(() => {
      const includeDryRuns = this.showDryRuns();
      untracked(() => void this.load(includeDryRuns));
    });
  }

  protected async load(includeDryRuns: boolean): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const { items } = await firstValueFrom(this.evalsApi.list({ includeDryRuns }));
      this.runs.set(items);
      // Keep only selections that are still listed.
      this.selected.update((ids) => ids.filter((id) => items.some((run) => run.id === id)));
    } catch (error) {
      this.error.set(toAppError(error));
    } finally {
      this.loading.set(false);
    }
  }

  protected isSelected(id: string): boolean {
    return this.selected().includes(id);
  }

  /** At most two: picking a third replaces the earliest pick. */
  protected toggle(id: string): void {
    this.selected.update((ids) =>
      ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id].slice(-2),
    );
  }
}
