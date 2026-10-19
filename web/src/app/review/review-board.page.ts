import { Component, computed, effect, inject, input, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { QuizFailureReason } from '../core/api/api.types';
import { ErrorMessage } from '../shared/error-message';
import { QuestionCard } from './question-card';
import type { OtherStem } from './question-edit-form';
import { type QuestionEdit, QuizReviewStore } from './quiz-review.store';
import { ReviewHeader } from './review-header';

/** Typed by the API's reasons, so a new reason is a compile error here. */
const FAILURE_TEXT: Record<QuizFailureReason, string> = {
  invalid_output: 'the AI kept returning answers that could not be used',
  refusal: 'the AI declined to write questions for this lesson',
  truncated: 'the AI answer was cut off',
  budget_exceeded: "today's AI budget was used up",
  timeout: 'the AI service took too long',
  rate_limited: 'the AI service was busy',
  provider_error: 'the AI service had a problem',
  cancelled: 'the request was cancelled',
  internal_error: 'of an unexpected error',
};

/** /quizzes/:id/review: the container that connects QuizReviewStore to the cards. */
@Component({
  selector: 'app-review-board-page',
  imports: [ErrorMessage, QuestionCard, ReviewHeader, RouterLink],
  providers: [QuizReviewStore],
  templateUrl: './review-board.page.html',
  styleUrl: './review-board.page.scss',
})
export class ReviewBoardPage {
  /** The quiz id, from the route. */
  readonly id = input.required<string>();

  protected readonly store = inject(QuizReviewStore);
  private readonly router = inject(Router);

  protected readonly failureText = computed(() => {
    const reason = this.store.quiz()?.failureReason;
    return reason ? FAILURE_TEXT[reason] : '';
  });

  constructor() {
    // Reload when the route id changes, and only then: untracked keeps the
    // signals load() reads from becoming dependencies of this effect.
    effect(() => {
      const id = this.id();
      untracked(() => void this.store.load(id));
    });
    // A published quiz can no longer be reviewed; show it read-only instead.
    effect(() => {
      const quiz = this.store.quiz();
      if (quiz?.status === 'published') {
        void this.router.navigate(['/quizzes', quiz.id, 'published'], { replaceUrl: true });
      }
    });
  }

  protected otherStems(position: number): OtherStem[] {
    return this.store
      .questions()
      .filter((question) => question.position !== position)
      .map(({ position: other, stem }) => ({ position: other, stem }));
  }

  protected save(position: number, edit: QuestionEdit): void {
    void this.store.saveEdit(position, edit);
  }

  protected retry(position: number): void {
    this.store.card(position).retry?.();
  }

  protected publish(): void {
    void this.store.publish();
  }
}
