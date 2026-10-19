import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { QuizResponse } from '../core/api/api.types';
import { QuizzesApi } from '../core/api/quizzes.api';
import { AppError, toAppError } from '../core/errors/app-error';
import { ErrorMessage } from '../shared/error-message';
import { QuestionContent } from '../shared/question-content';

/** /quizzes/:id/published: the published quiz, read-only (its approved questions only). */
@Component({
  selector: 'app-published-quiz-page',
  imports: [ErrorMessage, QuestionContent, RouterLink],
  template: `
    <h1>Published quiz</h1>

    @if (loading()) {
      <p role="status"><span class="spinner" aria-hidden="true"></span> Loading the quiz…</p>
    }
    <app-error-message [error]="error()" [retryable]="true" (retry)="load(id())" />

    @if (quiz(); as quiz) {
      @if (quiz.status === 'published') {
        <p class="lead">
          {{ quiz.questions.length }} {{ quiz.questions.length === 1 ? 'question' : 'questions' }} ·
          {{ quiz.settings.difficulty }}
        </p>
        <ol class="question-list">
          @for (question of quiz.questions; track question.id; let i = $index) {
            <li class="card">
              <h2 class="card-title">Question {{ i + 1 }}</h2>
              <app-question-content [question]="question" />
            </li>
          }
        </ol>
      } @else {
        <div class="notice" role="status">
          <p>This quiz is not published yet.</p>
          <a [routerLink]="['/quizzes', quiz.id, 'review']">Go to the review board</a>
        </div>
      }
    }
  `,
  styleUrl: './published-quiz.page.scss',
})
export class PublishedQuizPage {
  /** The quiz id, from the route. */
  readonly id = input.required<string>();

  private readonly quizzesApi = inject(QuizzesApi);

  protected readonly quiz = signal<QuizResponse | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<AppError | null>(null);

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
  }

  protected async load(id: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.quiz.set(await firstValueFrom(this.quizzesApi.get(id)));
    } catch (error) {
      this.error.set(toAppError(error));
    } finally {
      this.loading.set(false);
    }
  }
}
