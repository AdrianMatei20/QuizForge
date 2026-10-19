import { Component, computed, input, output } from '@angular/core';
import type { QuestionStatus } from '../core/api/api.types';
import type { AppError } from '../core/errors/app-error';
import { ErrorMessage } from '../shared/error-message';

/** Counts by status, the edit rate, and the Publish button. Presentational. */
@Component({
  selector: 'app-review-header',
  imports: [ErrorMessage],
  template: `
    @if (generating()) {
      <div class="progress" role="status">
        <span class="spinner" aria-hidden="true"></span>
        <label for="generation-progress">Generating {{ received() }} of {{ expected() }}</label>
        <progress id="generation-progress" [value]="received()" [max]="expected()"></progress>
      </div>
    }
    <section class="review-header" aria-labelledby="review-summary-heading">
      <h2 id="review-summary-heading" class="visually-hidden">Review summary</h2>
      <dl class="stats">
        <div>
          <dt>Approved</dt>
          <dd>{{ counts().approved }}</dd>
        </div>
        <div>
          <dt>Rejected</dt>
          <dd>{{ counts().rejected }}</dd>
        </div>
        <div>
          <dt>To review</dt>
          <dd>{{ counts().draft }}</dd>
        </div>
        <div>
          <dt>Edit rate</dt>
          <dd>{{ editRateText() }}</dd>
        </div>
      </dl>
      <div class="publish">
        <button
          type="button"
          class="button primary"
          [disabled]="!canPublish()"
          [attr.aria-describedby]="canPublish() ? null : 'publish-hint'"
          (click)="publish.emit()"
        >
          {{ publishing() ? 'Publishing…' : 'Publish quiz' }}
        </button>
        @if (!canPublish() && !publishing()) {
          <p id="publish-hint" class="hint">Approve at least one question to publish.</p>
        }
      </div>
    </section>
    <app-error-message [error]="publishError()" />
  `,
  styleUrl: './review-header.scss',
})
export class ReviewHeader {
  readonly counts = input.required<Record<QuestionStatus, number>>();
  /** Approved questions that differ from the AI's version, as a share of approved; null if none approved. */
  readonly editRate = input<number | null>(null);
  readonly canPublish = input(false);
  readonly publishing = input(false);
  readonly publishError = input<AppError | null>(null);
  /** While generating: questions received so far, of how many asked for. */
  readonly generating = input(false);
  readonly received = input(0);
  readonly expected = input(0);

  readonly publish = output<void>();

  protected readonly editRateText = computed(() => {
    const rate = this.editRate();
    return rate === null ? '–' : `${Math.round(rate * 100)}%`;
  });
}
