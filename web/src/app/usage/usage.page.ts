import { Component, computed, inject, type OnInit, signal } from '@angular/core';
import { type FieldTree, form, FormField, validate } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import type { UsageReport } from '../core/api/api.types';
import { UsageApi } from '../core/api/usage.api';
import { AppError, toAppError } from '../core/errors/app-error';
import { ErrorMessage } from '../shared/error-message';
import { CostChart } from './cost-chart';
import { formatUsd } from './cost-chart.model';

const DAY_MS = 86_400_000;
const MAX_DAYS = 366;

const STATUS_LABEL: Record<string, string> = {
  ok: 'OK',
  invalid_output: 'Invalid output',
  error: 'Error',
  budget_exceeded: 'Budget exceeded',
  refused: 'Refused',
  truncated: 'Truncated',
};

const today = () => new Date().toISOString().slice(0, 10);
const daysBefore = (date: string, days: number) =>
  new Date(new Date(`${date}T00:00:00.000Z`).getTime() - days * DAY_MS).toISOString().slice(0, 10);
const dayCount = (from: string, to: string) =>
  (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / DAY_MS + 1;

/** /usage: LLM calls, tokens and cost over a date range (UTC days), from GET /api/usage. */
@Component({
  selector: 'app-usage-page',
  imports: [CostChart, ErrorMessage, FormField],
  templateUrl: './usage.page.html',
  styleUrl: './usage.page.scss',
})
export class UsagePage implements OnInit {
  private readonly usageApi = inject(UsageApi);

  protected readonly model = signal({ from: daysBefore(today(), 6), to: today() });

  protected readonly rangeForm = form(this.model, (path) => {
    validate(path.from, ({ value }) =>
      value() === '' ? { kind: 'required', message: 'Choose a start day.' } : undefined,
    );
    validate(path.to, ({ value }) =>
      value() === '' ? { kind: 'required', message: 'Choose an end day.' } : undefined,
    );
    validate(path.from, ({ value, valueOf }) => {
      const to = valueOf(path.to);
      if (value() === '' || to === '') return undefined;
      const days = dayCount(value(), to);
      if (days < 1) return { kind: 'order', message: 'The start must not be after the end.' };
      if (days > MAX_DAYS) {
        return { kind: 'too-long', message: `Choose at most ${MAX_DAYS} days.` };
      }
      return undefined;
    });
  });

  protected readonly report = signal<UsageReport | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<AppError | null>(null);
  protected readonly formatUsd = formatUsd;

  protected readonly statuses = computed(() =>
    Object.entries(this.report()?.totals.byStatus ?? {})
      .filter(([, count]) => count > 0)
      .map(([status, count]) => ({ label: STATUS_LABEL[status] ?? status, count })),
  );

  ngOnInit(): void {
    void this.load();
  }

  protected messages(field: FieldTree<unknown>): string[] {
    const state = field();
    return state.touched()
      ? state.errors().flatMap((error) => (error.message ? [error.message] : []))
      : [];
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.rangeForm().invalid()) {
      this.rangeForm().markAsTouched();
      return;
    }
    await this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.report.set(await firstValueFrom(this.usageApi.report(this.model())));
    } catch (error) {
      this.error.set(toAppError(error));
    } finally {
      this.loading.set(false);
    }
  }

  /** A share as a percentage, or "–" when there is nothing to divide by. */
  protected percent(rate: number | null | undefined): string {
    return rate === null || rate === undefined ? '–' : `${(rate * 100).toFixed(1)}%`;
  }

  protected count(value: number): string {
    return value.toLocaleString('en-US');
  }
}
