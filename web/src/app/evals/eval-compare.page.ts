import { DatePipe } from '@angular/common';
import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { ComparedMetric, EvalComparison } from '../core/api/api.types';
import { EvalsApi } from '../core/api/evals.api';
import { AppError, toAppError } from '../core/errors/app-error';
import { ErrorMessage } from '../shared/error-message';
import { formatComparedValue, formatDelta, runLabel } from './eval-format';

const VERDICT_TEXT: Record<ComparedMetric['verdict'], string> = {
  better: 'better',
  worse: 'worse',
  same: 'same',
  'n/a': '',
};

/** /evals/compare?a=&b=: run B against baseline run A, metric by metric. */
@Component({
  selector: 'app-eval-compare-page',
  imports: [DatePipe, ErrorMessage, RouterLink],
  templateUrl: './eval-compare.page.html',
  styleUrl: './eval-compare.page.scss',
})
export class EvalComparePage {
  /** Run ids, from the query string. */
  readonly a = input<string>();
  readonly b = input<string>();

  private readonly evalsApi = inject(EvalsApi);

  protected readonly comparison = signal<EvalComparison | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<AppError | null>(null);

  protected readonly runLabel = runLabel;
  protected readonly value = formatComparedValue;
  protected readonly delta = formatDelta;
  protected readonly verdictText = VERDICT_TEXT;

  constructor() {
    effect(() => {
      const a = this.a();
      const b = this.b();
      untracked(() => void this.load(a, b));
    });
  }

  protected async load(a: string | undefined, b: string | undefined): Promise<void> {
    this.comparison.set(null);
    if (!a || !b) {
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      this.comparison.set(await firstValueFrom(this.evalsApi.compare(a, b)));
    } catch (error) {
      this.error.set(toAppError(error));
    } finally {
      this.loading.set(false);
    }
  }
}
