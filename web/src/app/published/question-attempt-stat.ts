import { Component, computed, input } from '@angular/core';
import type { QuestionAttemptStats } from '../core/api/api.types';

const FLAG_TEXT = {
  too_easy: 'Possibly too easy',
  possibly_wrong: 'Possibly wrong or unclear',
} as const;

/**
 * How students did on one question: "72% correct (18 attempts)", and a
 * flag with a text label once the API flags it. Nothing before any attempt.
 */
@Component({
  selector: 'app-question-attempt-stat',
  template: `
    @let s = stat();
    @if (s.attempts > 0) {
      <p class="stat">
        <!-- One text run: Angular drops whitespace between two elements, which would read "correct(18". -->
        <span
          >{{ percent() }} correct
          <span class="meta"
            >({{ s.attempts }} {{ s.attempts === 1 ? 'attempt' : 'attempts' }})</span
          ></span
        >
        @if (s.flag) {
          <span class="badge" [class]="'badge flag-' + s.flag">
            <span aria-hidden="true">⚑</span> {{ flagText() }}
          </span>
        }
      </p>
    }
  `,
  styles: `
    .stat {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
      margin: 0;
      font-weight: 600;
    }

    .meta {
      color: var(--color-text-muted);
      font-weight: 400;
    }

    .flag-too_easy {
      border-color: var(--color-accent);
      color: var(--color-accent);
    }

    .flag-possibly_wrong {
      border-color: var(--color-danger);
      background: var(--color-danger-bg);
      color: var(--color-danger);
    }
  `,
})
export class QuestionAttemptStat {
  readonly stat = input.required<QuestionAttemptStats>();

  protected readonly percent = computed(() => {
    const share = this.stat().percentCorrect;
    return share === null ? '–' : `${Math.round(share * 100)}%`;
  });
  protected readonly flagText = computed(() => {
    const flag = this.stat().flag;
    return flag ? FLAG_TEXT[flag] : '';
  });
}
