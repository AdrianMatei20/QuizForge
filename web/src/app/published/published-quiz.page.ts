import { DOCUMENT } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { AttemptStats, QuizResponse } from '../core/api/api.types';
import { QuizzesApi } from '../core/api/quizzes.api';
import { AppError, toAppError } from '../core/errors/app-error';
import { ErrorMessage } from '../shared/error-message';
import { QuestionContent } from '../shared/question-content';
import { QuestionAttemptStat } from './question-attempt-stat';

/**
 * /quizzes/:id/published: the published quiz, read-only (its approved
 * questions only), with the link students take it at and how they did.
 */
@Component({
  selector: 'app-published-quiz-page',
  imports: [ErrorMessage, QuestionAttemptStat, QuestionContent, RouterLink],
  templateUrl: './published-quiz.page.html',
  styleUrl: './published-quiz.page.scss',
})
export class PublishedQuizPage {
  /** The quiz id, from the route. */
  readonly id = input.required<string>();

  private readonly quizzesApi = inject(QuizzesApi);
  private readonly document = inject(DOCUMENT);

  protected readonly quiz = signal<QuizResponse | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<AppError | null>(null);
  protected readonly stats = signal<AttemptStats | null>(null);
  protected readonly statsError = signal<AppError | null>(null);
  protected readonly copied = signal(false);

  /** The student's link: absolute, so it can be pasted anywhere. */
  protected readonly studentLink = computed(
    () => `${this.document.location.origin}/q/${this.id()}`,
  );

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
      const quiz = await firstValueFrom(this.quizzesApi.get(id));
      this.quiz.set(quiz);
      if (quiz.status === 'published') {
        await this.loadStats(id);
      }
    } catch (error) {
      this.error.set(toAppError(error));
    } finally {
      this.loading.set(false);
    }
  }

  /** Separate from the quiz: if the stats fail, the quiz is still shown. */
  protected async loadStats(id: string): Promise<void> {
    this.statsError.set(null);
    try {
      this.stats.set(await firstValueFrom(this.quizzesApi.attemptStats(id)));
    } catch (error) {
      this.statsError.set(toAppError(error));
    }
  }

  protected statFor(questionId: string) {
    return this.stats()?.questions.find((stat) => stat.questionId === questionId);
  }

  protected percent(share: number | null | undefined): string {
    return share === null || share === undefined ? '–' : `${Math.round(share * 100)}%`;
  }

  protected async copyLink(): Promise<void> {
    try {
      await this.document.defaultView?.navigator.clipboard.writeText(this.studentLink());
      this.copied.set(true);
    } catch {
      // No clipboard access (e.g. an insecure origin): the link is still there to select.
      this.copied.set(false);
    }
  }
}
