import { DatePipe } from '@angular/common';
import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { apply, form } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { LessonResponse, ProblemFieldError, QuizListItem } from '../core/api/api.types';
import { LessonsApi } from '../core/api/lessons.api';
import { QuizzesApi } from '../core/api/quizzes.api';
import { AppError, toAppError } from '../core/errors/app-error';
import { ErrorMessage } from '../shared/error-message';
import { QuizSettingsFields } from '../shared/quiz-settings-fields';
import {
  defaultQuizSettings,
  quizSettingsSchema,
  toQuizRequest,
} from '../shared/quiz-settings.model';
import { QuizHistoryItem } from './quiz-history-item';

/**
 * /lessons/:id: the lesson, its quizzes newest first, and a way to generate
 * another one with the same settings form as /lessons/new.
 */
@Component({
  selector: 'app-lesson-page',
  imports: [DatePipe, ErrorMessage, QuizHistoryItem, QuizSettingsFields, RouterLink],
  templateUrl: './lesson.page.html',
  styleUrl: './lesson.page.scss',
})
export class LessonPage {
  /** The lesson id, from the route. */
  readonly id = input.required<string>();

  private readonly lessonsApi = inject(LessonsApi);
  private readonly quizzesApi = inject(QuizzesApi);
  private readonly router = inject(Router);

  protected readonly lesson = signal<LessonResponse | null>(null);
  protected readonly quizzes = signal<QuizListItem[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<AppError | null>(null);

  protected readonly showGenerate = signal(false);
  protected readonly settingsModel = signal(defaultQuizSettings());
  protected readonly settingsForm = form(this.settingsModel, (path) => {
    apply(path, quizSettingsSchema);
  });
  protected readonly generating = signal(false);
  protected readonly generateError = signal<AppError | null>(null);
  protected readonly serverErrors = signal<readonly ProblemFieldError[]>([]);

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
      const [lesson, quizzes] = await Promise.all([
        firstValueFrom(this.lessonsApi.get(id)),
        firstValueFrom(this.quizzesApi.listForLesson(id)),
      ]);
      this.lesson.set(lesson);
      this.quizzes.set(quizzes);
    } catch (error) {
      this.error.set(toAppError(error));
    } finally {
      this.loading.set(false);
    }
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.generating()) {
      return;
    }
    if (this.settingsForm().invalid()) {
      this.settingsForm().markAsTouched();
      return;
    }
    await this.generate();
  }

  /** Also the Retry action. Streams, like /lessons/new: the review board shows the questions as they arrive. */
  protected async generate(): Promise<void> {
    this.generating.set(true);
    this.generateError.set(null);
    this.serverErrors.set([]);
    try {
      const { quizId } = await firstValueFrom(
        this.quizzesApi.startStreaming(this.id(), toQuizRequest(this.settingsModel())),
      );
      await this.router.navigate(['/quizzes', quizId, 'review']);
    } catch (error) {
      const appError = toAppError(error);
      this.generateError.set(appError);
      this.serverErrors.set(appError.kind === 'validation' ? appError.fieldErrors : []);
    } finally {
      this.generating.set(false);
    }
  }
}
