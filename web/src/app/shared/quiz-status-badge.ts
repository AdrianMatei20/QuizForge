import { Component, computed, input } from '@angular/core';
import type { QuizStatus } from '../core/api/api.types';
import { QUIZ_STATUS_LABEL } from './quiz-labels';

/** A quiz's status as a labelled badge: the word carries the meaning, the colour only helps. */
@Component({
  selector: 'app-quiz-status-badge',
  template: `<span [class]="'badge quiz-' + status()">{{ label() }}</span>`,
  styles: `
    .quiz-generating {
      border-color: var(--color-accent);
      color: var(--color-accent);
    }

    .quiz-published {
      border-color: var(--color-success);
      background: var(--color-success-bg);
      color: var(--color-success);
    }

    .quiz-failed {
      border-color: var(--color-danger);
      background: var(--color-danger-bg);
      color: var(--color-danger);
    }
  `,
})
export class QuizStatusBadge {
  readonly status = input.required<QuizStatus>();

  protected readonly label = computed(() => QUIZ_STATUS_LABEL[this.status()]);
}
