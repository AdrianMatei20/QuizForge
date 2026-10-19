import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom, type Subscription } from 'rxjs';
import type {
  ProblemFieldError,
  QuestionResponse,
  QuestionStatus,
  QuizResponse,
  UpdateQuestionRequest,
} from '../core/api/api.types';
import { QuestionsApi } from '../core/api/questions.api';
import { QuizzesApi } from '../core/api/quizzes.api';
import type { QuizStreamEvent } from '../core/api/stream-events';
import { AppError, toAppError } from '../core/errors/app-error';

/** What a card is waiting for. Only one action per card at a time. */
export type CardBusy = 'status' | 'saving' | 'regenerating';

/** The content fields a teacher can edit. */
export type QuestionEdit = Required<
  Pick<UpdateQuestionRequest, 'stem' | 'options' | 'correctIndex' | 'explanation'>
>;

export interface CardState {
  busy?: CardBusy;
  /** The last failed action on this card, shown on the card. */
  error?: AppError;
  /** Repeats the failed action; set only when trying again might work. */
  retry?: () => void;
  /** API validation errors from the last failed save, shown next to their fields. */
  fieldErrors?: readonly ProblemFieldError[];
}

const STATUS_LABEL: Record<QuestionStatus, string> = {
  draft: 'moved back to draft',
  approved: 'approved',
  rejected: 'rejected',
};

/**
 * The review board's state, in signals. Provided by the review page, so each
 * visit starts fresh. Cards are keyed by position, not id: regenerate
 * replaces a question with a new id at the same position.
 *
 * Status changes are optimistic: the card changes at once, and rolls back
 * with an error if the API refuses. Edits are not, because the API validates
 * them and the teacher needs to see why a save failed.
 *
 * While the quiz is generating, it listens to the generation stream: cards
 * appear as questions arrive. The stream closes when the page is destroyed;
 * generation itself carries on on the server.
 */
@Injectable()
export class QuizReviewStore {
  private readonly quizzesApi = inject(QuizzesApi);
  private readonly questionsApi = inject(QuestionsApi);
  private readonly destroyRef = inject(DestroyRef);
  private streamSubscription: Subscription | undefined;

  readonly quiz = signal<QuizResponse | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal<AppError | null>(null);
  /** From review-stats, refreshed after every successful change. */
  readonly editRate = signal<number | null>(null);
  readonly cards = signal<Readonly<Record<number, CardState>>>({});
  /** Position of the question being edited, if any. */
  readonly editing = signal<number | null>(null);
  readonly publishing = signal(false);
  readonly publishError = signal<AppError | null>(null);
  /** Polite screen-reader announcement of the last completed action. */
  readonly announcement = signal('');
  /** Positions whose line was rejected and that the repair step is still rewriting. */
  readonly rewriting = signal<ReadonlySet<number>>(new Set());
  /** The `problem` that ended generation, if any. */
  readonly streamError = signal<AppError | null>(null);

  readonly questions = computed(() => this.quiz()?.questions ?? []);
  readonly generating = computed(() => this.quiz()?.status === 'generating');
  /** How many questions were asked for: "Generating 4 of 8". */
  readonly expectedCount = computed(() => this.quiz()?.settings.count ?? 0);

  readonly counts = computed(() => {
    const counts: Record<QuestionStatus, number> = { draft: 0, approved: 0, rejected: 0 };
    for (const question of this.questions()) {
      counts[question.status]++;
    }
    return counts;
  });

  readonly canPublish = computed(
    () => this.quiz()?.status === 'draft' && this.counts().approved > 0 && !this.publishing(),
  );

  async load(quizId: string): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const quiz = await firstValueFrom(this.quizzesApi.get(quizId));
      this.quiz.set(quiz);
      if (quiz.status === 'draft') {
        await this.refreshStats();
      } else if (quiz.status === 'generating') {
        this.listen(quizId);
      }
    } catch (error) {
      this.loadError.set(toAppError(error));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Follows the generation stream. Questions are inserted by position, so a
   * question replayed after a reconnect replaces itself instead of
   * appearing twice. On `done` the quiz is reloaded (its status is now draft);
   * on `problem` the stream is closed and the message shown.
   */
  private listen(quizId: string): void {
    this.streamSubscription?.unsubscribe();
    this.streamError.set(null);
    this.streamSubscription = this.quizzesApi
      .stream(quizId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (event) => this.onStreamEvent(event),
        complete: () => void this.reloadAfterStream(quizId),
        error: (error: unknown) => {
          this.streamError.set(toAppError(error));
          this.rewriting.set(new Set());
          this.announce('Quiz generation stopped.');
          void this.reloadAfterStream(quizId);
        },
      });
  }

  private onStreamEvent(event: QuizStreamEvent): void {
    switch (event.type) {
      case 'question': {
        const question = event.data;
        this.upsertQuestion(question);
        this.rewriting.update((positions) => without(positions, question.position));
        this.announce(`Question ${question.position} is ready.`);
        break;
      }
      case 'question_rejected':
        if (event.data.position <= this.expectedCount()) {
          this.rewriting.update((positions) => new Set(positions).add(event.data.position));
        }
        break;
      case 'done':
        this.announce(
          `All questions are ready: ${event.data.generated} of ${this.expectedCount()}.`,
        );
        break;
    }
  }

  private async reloadAfterStream(quizId: string): Promise<void> {
    this.rewriting.set(new Set());
    try {
      this.quiz.set(await firstValueFrom(this.quizzesApi.get(quizId)));
      if (this.quiz()?.status === 'draft') {
        await this.refreshStats();
      }
    } catch (error) {
      this.loadError.set(toAppError(error));
    }
  }

  card(position: number): CardState {
    return this.cards()[position] ?? {};
  }

  /** Optimistic: shows the new status at once, rolls back if the API refuses. */
  async setStatus(position: number, status: QuestionStatus): Promise<void> {
    const previous = this.questionAt(position);
    if (!previous || previous.status === status || this.card(position).busy) {
      return;
    }
    this.replaceQuestion(position, { ...previous, status });
    this.setCard(position, { busy: 'status' });
    try {
      const saved = await firstValueFrom(this.questionsApi.update(previous.id, { status }));
      this.replaceQuestion(position, saved);
      this.setCard(position, {});
      this.announce(`Question ${position} ${STATUS_LABEL[status]}.`);
      void this.refreshStats();
    } catch (error) {
      this.replaceQuestion(position, previous);
      this.setCard(
        position,
        this.failure(error, () => void this.setStatus(position, status)),
      );
      this.announce(`Question ${position} could not be updated.`);
    }
  }

  startEdit(position: number): void {
    if (this.card(position).busy) {
      return;
    }
    this.setCard(position, {});
    this.editing.set(position);
  }

  cancelEdit(): void {
    const position = this.editing();
    if (position !== null) {
      this.setCard(position, {});
    }
    this.editing.set(null);
  }

  /** Not optimistic. Resolves to true when saved; API field errors stay on the card. */
  async saveEdit(position: number, changes: QuestionEdit): Promise<boolean> {
    const question = this.questionAt(position);
    if (!question || this.card(position).busy) {
      return false;
    }
    this.setCard(position, { busy: 'saving' });
    try {
      const saved = await firstValueFrom(this.questionsApi.update(question.id, changes));
      this.replaceQuestion(position, saved);
      this.setCard(position, {});
      this.editing.set(null);
      this.announce(`Question ${position} saved.`);
      void this.refreshStats();
      return true;
    } catch (error) {
      const appError = toAppError(error);
      this.setCard(
        position,
        appError.kind === 'validation' && appError.fieldErrors.length > 0
          ? { fieldErrors: appError.fieldErrors }
          : this.failure(appError, () => void this.saveEdit(position, changes)),
      );
      this.announce(`Question ${position} was not saved.`);
      return false;
    }
  }

  /** Replaces the question at this position with a newly generated one. */
  async regenerate(position: number): Promise<void> {
    const question = this.questionAt(position);
    // Not while generating: the server's repair step may still be filling gaps.
    if (!question || this.card(position).busy || this.generating()) {
      return;
    }
    if (this.editing() === position) {
      this.editing.set(null);
    }
    this.setCard(position, { busy: 'regenerating' });
    try {
      const replacement = await firstValueFrom(this.questionsApi.regenerate(question.id));
      this.replaceQuestion(position, replacement);
      this.setCard(position, {});
      this.announce(`Question ${position} replaced with a new question.`);
      void this.refreshStats();
    } catch (error) {
      this.setCard(
        position,
        this.failure(error, () => void this.regenerate(position)),
      );
      this.announce(`Question ${position} could not be regenerated.`);
    }
  }

  /** Resolves to true once published. */
  async publish(): Promise<boolean> {
    const quiz = this.quiz();
    if (!quiz || !this.canPublish()) {
      return false;
    }
    this.publishing.set(true);
    this.publishError.set(null);
    try {
      this.quiz.set(await firstValueFrom(this.quizzesApi.publish(quiz.id)));
      return true;
    } catch (error) {
      this.publishError.set(toAppError(error));
      return false;
    } finally {
      this.publishing.set(false);
    }
  }

  private questionAt(position: number): QuestionResponse | undefined {
    return this.questions().find((question) => question.position === position);
  }

  private replaceQuestion(position: number, replacement: QuestionResponse): void {
    this.quiz.update((quiz) =>
      quiz === null
        ? quiz
        : {
            ...quiz,
            questions: quiz.questions.map((question) =>
              question.position === position ? replacement : question,
            ),
          },
    );
  }

  /** Inserts a streamed question at its position, or replaces the one already there. */
  private upsertQuestion(question: QuestionResponse): void {
    this.quiz.update((quiz) =>
      quiz === null
        ? quiz
        : {
            ...quiz,
            questions: [
              ...quiz.questions.filter((existing) => existing.position !== question.position),
              question,
            ].sort((a, b) => a.position - b.position),
          },
    );
  }

  private setCard(position: number, state: CardState): void {
    this.cards.update((cards) => ({ ...cards, [position]: state }));
  }

  private failure(error: unknown, retry: () => void): CardState {
    const appError = toAppError(error);
    return appError.retryable ? { error: appError, retry } : { error: appError };
  }

  private announce(message: string): void {
    this.announcement.set(message);
  }

  /** The edit rate is a nice-to-have: if refreshing it fails, the last value stays. */
  private async refreshStats(): Promise<void> {
    const quiz = this.quiz();
    if (!quiz) {
      return;
    }
    try {
      const stats = await firstValueFrom(this.quizzesApi.reviewStats(quiz.id));
      this.editRate.set(stats.editRate);
    } catch {
      // Keep the previous value; the counts are computed locally anyway.
    }
  }
}

function without(positions: ReadonlySet<number>, position: number): ReadonlySet<number> {
  const next = new Set(positions);
  next.delete(position);
  return next;
}
