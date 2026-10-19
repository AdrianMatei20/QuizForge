import {
  afterNextRender,
  Component,
  computed,
  effect,
  type ElementRef,
  inject,
  Injector,
  input,
  output,
  viewChild,
} from '@angular/core';
import type { ProblemFieldError, QuestionResponse, QuestionStatus } from '../core/api/api.types';
import type { AppError } from '../core/errors/app-error';
import { ErrorMessage } from '../shared/error-message';
import { QuestionContent } from '../shared/question-content';
import { type OtherStem, QuestionEditForm } from './question-edit-form';
import type { CardBusy, QuestionEdit } from './quiz-review.store';

const STATUS_LABEL: Record<QuestionStatus, string> = {
  draft: 'Draft',
  approved: 'Approved',
  rejected: 'Rejected',
};

/**
 * One question on the review board. Presentational: it shows what it is
 * given and reports what the teacher clicked; QuizReviewStore does the rest.
 *
 * Approve and Reject are toggle buttons (aria-pressed). Pressing the active
 * one moves the question back to draft. Switching straight from approved to
 * rejected is not allowed by the API, so the other button is disabled until
 * the decision is undone.
 */
@Component({
  selector: 'app-question-card',
  imports: [ErrorMessage, QuestionContent, QuestionEditForm],
  templateUrl: './question-card.html',
  styleUrl: './question-card.scss',
})
export class QuestionCard {
  readonly question = input.required<QuestionResponse>();
  readonly busy = input<CardBusy | undefined>(undefined);
  readonly error = input<AppError | undefined>(undefined);
  readonly retryable = input(false);
  readonly fieldErrors = input<readonly ProblemFieldError[]>([]);
  readonly editing = input(false);
  readonly otherStems = input<readonly OtherStem[]>([]);

  readonly statusChange = output<QuestionStatus>();
  readonly editStart = output<void>();
  readonly editCancel = output<void>();
  readonly save = output<QuestionEdit>();
  readonly regenerate = output<void>();
  readonly retry = output<void>();

  private readonly editButton = viewChild<ElementRef<HTMLButtonElement>>('editButton');
  private readonly injector = inject(Injector);

  protected readonly status = computed(() => this.question().status);
  protected readonly statusLabel = computed(() => STATUS_LABEL[this.status()]);
  protected readonly headingId = computed(() => `question-${this.question().position}-heading`);
  protected readonly isBusy = computed(() => this.busy() !== undefined);
  protected readonly typeLabel = computed(() =>
    this.question().type === 'multiple_choice' ? 'Multiple choice' : 'True/false',
  );

  constructor() {
    // When the editor closes, put focus back on the Edit button it came from.
    let wasEditing = false;
    effect(() => {
      const editing = this.editing();
      if (wasEditing && !editing) {
        afterNextRender(() => this.editButton()?.nativeElement.focus(), {
          injector: this.injector,
        });
      }
      wasEditing = editing;
    });
  }

  protected toggle(target: 'approved' | 'rejected'): void {
    this.statusChange.emit(this.status() === target ? 'draft' : target);
  }
}
