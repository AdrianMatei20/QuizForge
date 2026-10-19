import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { LessonList, QuizStatusCounts } from '../core/api/api.types';
import { LessonsApi } from '../core/api/lessons.api';
import { AppError, toAppError } from '../core/errors/app-error';
import { ErrorMessage } from '../shared/error-message';
import { QUIZ_STATUSES_IN_ORDER } from '../shared/quiz-labels';

export const LESSONS_PAGE_SIZE = 20;

/** "2 draft · 1 published", or "No quizzes yet". Statuses with no quizzes are left out. */
export function quizCountsSummary(counts: QuizStatusCounts): string {
  const parts = QUIZ_STATUSES_IN_ORDER.filter((status) => counts[status] > 0).map(
    (status) => `${counts[status]} ${status}`,
  );
  return parts.length > 0 ? parts.join(' · ') : 'No quizzes yet';
}

/** /: every lesson, newest first, a page at a time; the offset lives in the URL (?offset=20). */
@Component({
  selector: 'app-lessons-list-page',
  imports: [DatePipe, ErrorMessage, RouterLink],
  templateUrl: './lessons-list.page.html',
  styleUrl: './lessons-list.page.scss',
})
export class LessonsListPage {
  /** From the query string; anything that is not a whole number counts as 0. */
  readonly offset = input<string | undefined>(undefined);

  private readonly lessonsApi = inject(LessonsApi);

  protected readonly pageOffset = computed(() => {
    const offset = Number(this.offset() ?? 0);
    return Number.isInteger(offset) && offset > 0 ? offset : 0;
  });
  protected readonly page = signal<LessonList | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<AppError | null>(null);
  protected readonly countsSummary = quizCountsSummary;

  protected readonly newerOffset = computed(() => {
    const offset = this.pageOffset();
    return offset > 0 ? Math.max(0, offset - LESSONS_PAGE_SIZE) : null;
  });
  protected readonly olderOffset = computed(() => {
    const page = this.page();
    const next = this.pageOffset() + LESSONS_PAGE_SIZE;
    return page && next < page.total ? next : null;
  });

  constructor() {
    effect(() => {
      const offset = this.pageOffset();
      untracked(() => void this.load(offset));
    });
  }

  protected async load(offset: number): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.page.set(
        await firstValueFrom(this.lessonsApi.list({ limit: LESSONS_PAGE_SIZE, offset })),
      );
    } catch (error) {
      this.error.set(toAppError(error));
    } finally {
      this.loading.set(false);
    }
  }
}
