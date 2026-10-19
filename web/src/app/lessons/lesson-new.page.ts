import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import {
  type FieldTree,
  form,
  FormField,
  max,
  maxLength,
  min,
  validate,
} from '@angular/forms/signals';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { Difficulty, ProblemFieldError, QuestionType } from '../core/api/api.types';
import { LessonsApi } from '../core/api/lessons.api';
import { QuizzesApi } from '../core/api/quizzes.api';
import { AppError, toAppError } from '../core/errors/app-error';
import { LIMITS, textLength } from '../core/limits';
import { ErrorMessage } from '../shared/error-message';

interface LessonFormModel {
  title: string;
  content: string;
  count: number;
  difficulty: Difficulty;
  multipleChoice: boolean;
  trueFalse: boolean;
}

/** The lesson this page already created, so a retry does not create a duplicate. */
interface CreatedLesson {
  id: string;
  title: string;
  content: string;
}

/**
 * /lessons/new: write a lesson, pick quiz settings, generate. Creating the
 * lesson and generating the quiz are two API calls behind one button; if
 * generation fails, Retry only repeats the second one.
 */
@Component({
  selector: 'app-lesson-new-page',
  imports: [ErrorMessage, FormField],
  templateUrl: './lesson-new.page.html',
  styleUrl: './lesson-new.page.scss',
})
export class LessonNewPage {
  private readonly lessonsApi = inject(LessonsApi);
  private readonly quizzesApi = inject(QuizzesApi);
  private readonly router = inject(Router);

  protected readonly limits = LIMITS;
  /** Short labels fit the dropdown; the selected level's description is shown under it. */
  protected readonly difficulties: readonly {
    value: Difficulty;
    label: string;
    description: string;
  }[] = [
    { value: 'easy', label: 'Easy', description: 'Recall facts stated in the lesson.' },
    {
      value: 'medium',
      label: 'Medium',
      description: 'Understand or apply an idea from the lesson.',
    },
    { value: 'hard', label: 'Hard', description: 'Combine several parts of the lesson.' },
  ];

  protected readonly model = signal<LessonFormModel>({
    title: '',
    content: '',
    count: 5,
    difficulty: 'medium',
    multipleChoice: true,
    trueFalse: true,
  });

  protected readonly lessonForm = form(this.model, (path) => {
    validate(path.title, ({ value }) =>
      value().trim() === '' ? { kind: 'blank', message: 'Enter a title.' } : undefined,
    );
    maxLength(path.title, LIMITS.lessonTitleMax, {
      message: `Use at most ${LIMITS.lessonTitleMax} characters.`,
    });
    validate(path.content, ({ value }) => {
      const length = textLength(value());
      if (length < LIMITS.lessonContentMin) {
        return {
          kind: 'too-short',
          message: `The lesson needs at least ${LIMITS.lessonContentMin} characters.`,
        };
      }
      if (length > LIMITS.lessonContentMax) {
        return {
          kind: 'too-long',
          message: `The lesson can have at most ${LIMITS.lessonContentMax.toLocaleString('en-US')} characters.`,
        };
      }
      return undefined;
    });
    min(path.count, LIMITS.quizCountMin, {
      message: `Ask for at least ${LIMITS.quizCountMin} questions.`,
    });
    max(path.count, LIMITS.quizCountMax, {
      message: `Ask for at most ${LIMITS.quizCountMax} questions.`,
    });
    validate(path.count, ({ value }) =>
      Number.isInteger(value()) ? undefined : { kind: 'integer', message: 'Enter a whole number.' },
    );
    validate(path.multipleChoice, ({ value, valueOf }) =>
      value() || valueOf(path.trueFalse)
        ? undefined
        : { kind: 'no-type', message: 'Choose at least one question type.' },
    );
  });

  protected readonly contentLength = computed(() => textLength(this.model().content));
  protected readonly contentLengthState = computed(() => {
    const length = this.contentLength();
    if (length > LIMITS.lessonContentMax) return 'over';
    if (length < LIMITS.lessonContentMin) return 'under';
    return 'ok';
  });
  protected readonly titleLength = computed(() => textLength(this.model().title));
  protected readonly difficultyDescription = computed(
    () => this.difficulties.find((option) => option.value === this.model().difficulty)?.description,
  );

  protected readonly generating = signal(false);
  protected readonly error = signal<AppError | null>(null);
  /** API validation errors from the last attempt, until the teacher edits something. */
  private readonly serverErrors = linkedSignal<AppError | null, readonly ProblemFieldError[]>({
    source: this.error,
    computation: (error) => (error?.kind === 'validation' ? error.fieldErrors : []),
  });
  private createdLesson: CreatedLesson | null = null;

  protected messages(field: FieldTree<unknown>, pointer: string): string[] {
    const state = field();
    const client = state.touched()
      ? state.errors().flatMap((error) => (error.message ? [error.message] : []))
      : [];
    const server = this.serverErrors()
      .filter((error) => error.pointer === pointer)
      .map((error) => error.detail);
    return [...client, ...server];
  }

  protected dismissServerErrors(): void {
    if (this.serverErrors().length > 0) {
      this.serverErrors.set([]);
    }
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.generating()) {
      return;
    }
    if (this.lessonForm().invalid()) {
      this.lessonForm().markAsTouched();
      return;
    }
    await this.generate();
  }

  /** Also the Retry action: reuses the lesson if it was already created with this text. */
  protected async generate(): Promise<void> {
    const { title, content, count, difficulty, multipleChoice, trueFalse } = this.model();
    const types: QuestionType[] = [
      ...(multipleChoice ? (['multiple_choice'] as const) : []),
      ...(trueFalse ? (['true_false'] as const) : []),
    ];
    this.generating.set(true);
    this.error.set(null);
    try {
      const lessonId = await this.lessonId(title, content);
      const quiz = await firstValueFrom(
        this.quizzesApi.generate(lessonId, { count, difficulty, types }),
      );
      await this.router.navigate(['/quizzes', quiz.id, 'review']);
    } catch (error) {
      this.error.set(toAppError(error));
    } finally {
      this.generating.set(false);
    }
  }

  private async lessonId(title: string, content: string): Promise<string> {
    const created = this.createdLesson;
    if (created && created.title === title && created.content === content) {
      return created.id;
    }
    const lesson = await firstValueFrom(this.lessonsApi.create({ title, content }));
    this.createdLesson = { id: lesson.id, title, content };
    return lesson.id;
  }
}
