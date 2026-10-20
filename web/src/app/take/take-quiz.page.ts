import {
  afterNextRender,
  Component,
  computed,
  type ElementRef,
  effect,
  inject,
  Injector,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { AttemptResult, PublicQuiz } from '../core/api/api.types';
import { PublicQuizzesApi } from '../core/api/public-quizzes.api';
import { AppError, toAppError } from '../core/errors/app-error';
import { ErrorMessage } from '../shared/error-message';

const LETTERS = 'ABCDEFGHIJ';

/**
 * /q/:id: a student takes a published quiz, one question at a time, then
 * sees the score and, per question, the correct answer and the explanation.
 * The quiz arrives without answers; they come back only with the scored
 * attempt. Model output is rendered as text.
 */
@Component({
  selector: 'app-take-quiz-page',
  imports: [ErrorMessage],
  templateUrl: './take-quiz.page.html',
  styleUrl: './take-quiz.page.scss',
})
export class TakeQuizPage {
  /** The quiz id, from the route. */
  readonly id = input.required<string>();

  private readonly api = inject(PublicQuizzesApi);
  private readonly injector = inject(Injector);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('focusTarget');

  protected readonly letters = LETTERS;
  protected readonly quiz = signal<PublicQuiz | null>(null);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<AppError | null>(null);

  /** 0-based index of the question on screen. */
  protected readonly index = signal(0);
  /** The selected option per question id. */
  protected readonly answers = signal<ReadonlyMap<string, number>>(new Map());
  protected readonly submitting = signal(false);
  protected readonly submitError = signal<AppError | null>(null);
  protected readonly result = signal<AttemptResult | null>(null);

  protected readonly question = computed(() => this.quiz()?.questions[this.index()] ?? null);
  protected readonly total = computed(() => this.quiz()?.questions.length ?? 0);
  protected readonly isLast = computed(() => this.index() === this.total() - 1);
  /** Question numbers still without an answer, for the hint next to Submit. */
  protected readonly unanswered = computed(() =>
    (this.quiz()?.questions ?? [])
      .filter((question) => !this.answers().has(question.id))
      .map((question) => question.position),
  );
  protected readonly notFound = computed(() => this.loadError()?.kind === 'not-found');

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
  }

  protected async load(id: string): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.quiz.set(await firstValueFrom(this.api.get(id)));
      this.restart();
    } catch (error) {
      this.loadError.set(toAppError(error));
    } finally {
      this.loading.set(false);
    }
  }

  protected select(questionId: string, optionIndex: number): void {
    this.answers.update((answers) => new Map(answers).set(questionId, optionIndex));
  }

  protected selected(questionId: string): number | undefined {
    return this.answers().get(questionId);
  }

  protected goTo(index: number): void {
    this.index.set(Math.min(Math.max(index, 0), this.total() - 1));
    this.focusHeading();
  }

  /** The form's submit, and the Retry button after a failed submit (no event). */
  protected async submit(event?: Event): Promise<void> {
    event?.preventDefault();
    const quiz = this.quiz();
    if (!quiz || this.unanswered().length > 0 || this.submitting()) {
      return;
    }
    this.submitting.set(true);
    this.submitError.set(null);
    try {
      const answers = quiz.questions.map((question) => ({
        questionId: question.id,
        selectedIndex: this.answers().get(question.id) as number,
      }));
      this.result.set(await firstValueFrom(this.api.submitAttempt(quiz.id, { answers })));
      this.focusHeading();
    } catch (error) {
      this.submitError.set(toAppError(error));
    } finally {
      this.submitting.set(false);
    }
  }

  /** Start over with no answers, on question 1. */
  protected restart(): void {
    this.answers.set(new Map());
    this.result.set(null);
    this.submitError.set(null);
    this.index.set(0);
  }

  protected questionOf(questionId: string) {
    return this.quiz()?.questions.find((question) => question.id === questionId);
  }

  protected percent(score: number, total: number): string {
    return total === 0 ? '–' : `${Math.round((score / total) * 100)}%`;
  }

  /** Moves focus to the new question (or the results), so screen readers announce the change. */
  private focusHeading(): void {
    afterNextRender(() => this.heading()?.nativeElement.focus(), { injector: this.injector });
  }
}
