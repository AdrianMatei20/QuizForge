import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import type { QuestionResponse, QuizResponse, ReviewStatsResponse } from '../core/api/api.types';
import { QuestionsApi } from '../core/api/questions.api';
import { QuizzesApi } from '../core/api/quizzes.api';
import { AppError } from '../core/errors/app-error';
import { QuizReviewStore } from './quiz-review.store';

function question(position: number, overrides: Partial<QuestionResponse> = {}): QuestionResponse {
  return {
    id: `q${position}`,
    position,
    type: 'multiple_choice',
    stem: `Question ${position}?`,
    options: ['A', 'B', 'C', 'D'],
    correctIndex: 0,
    explanation: 'Because.',
    sourceQuote: 'From the lesson text.',
    status: 'draft',
    editedAt: null,
    isEdited: false,
    ...overrides,
  };
}

const QUIZ: QuizResponse = {
  id: 'quiz-1',
  lessonId: 'lesson-1',
  status: 'draft',
  failureReason: null,
  promptId: 'quiz',
  promptVersion: 1,
  model: 'fake-model',
  settings: { count: 2, difficulty: 'medium', types: ['multiple_choice'] },
  createdAt: '2026-10-19T15:00:00.000Z',
  questions: [question(1), question(2)],
};

const STATS: ReviewStatsResponse = {
  quizId: 'quiz-1',
  total: 2,
  byStatus: { draft: 1, approved: 1, rejected: 0 },
  regenerated: 0,
  editRate: 0,
  rejectRate: 0,
  missRate: 0,
};

describe('QuizReviewStore', () => {
  let store: QuizReviewStore;
  let questionsApi: { update: ReturnType<typeof vi.fn>; regenerate: ReturnType<typeof vi.fn> };
  let quizzesApi: {
    get: ReturnType<typeof vi.fn>;
    reviewStats: ReturnType<typeof vi.fn>;
    publish: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    questionsApi = { update: vi.fn(), regenerate: vi.fn() };
    quizzesApi = {
      get: vi.fn(() => of(QUIZ)),
      reviewStats: vi.fn(() => of(STATS)),
      publish: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        QuizReviewStore,
        { provide: QuestionsApi, useValue: questionsApi },
        { provide: QuizzesApi, useValue: quizzesApi },
      ],
    });
    store = TestBed.inject(QuizReviewStore);
    await store.load('quiz-1');
  });

  const statusAt = (position: number) =>
    store.questions().find((q) => q.position === position)?.status;

  describe('optimistic status changes', () => {
    it('shows the new status at once, then rolls back with an error when the API refuses', async () => {
      const response = new Subject<QuestionResponse>();
      questionsApi.update.mockReturnValue(response);

      const done = store.setStatus(1, 'approved');

      // Optimistic: approved before the API has answered.
      expect(statusAt(1)).toBe('approved');
      expect(store.counts().approved).toBe(1);
      expect(store.card(1).busy).toBe('status');

      response.error(
        new AppError(
          'conflict',
          409,
          'A published quiz and its questions can no longer be changed.',
        ),
      );
      await done;

      expect(statusAt(1)).toBe('draft');
      expect(store.counts().approved).toBe(0);
      expect(store.card(1).busy).toBeUndefined();
      expect(store.card(1).error?.kind).toBe('conflict');
      // Trying the same thing again cannot help with a conflict.
      expect(store.card(1).retry).toBeUndefined();
      expect(questionsApi.update).toHaveBeenCalledWith('q1', { status: 'approved' });
    });

    it('offers a retry when the failure might be temporary', async () => {
      questionsApi.update.mockReturnValueOnce(
        throwError(() => new AppError('network', 0, undefined)),
      );

      await store.setStatus(2, 'rejected');

      expect(statusAt(2)).toBe('draft');
      expect(store.card(2).retry).toBeTypeOf('function');

      questionsApi.update.mockReturnValueOnce(of(question(2, { status: 'rejected' })));
      store.card(2).retry?.();
      await vi.waitFor(() => expect(statusAt(2)).toBe('rejected'));
      expect(store.card(2).error).toBeUndefined();
    });

    it('keeps the server version on success and refreshes the edit rate', async () => {
      questionsApi.update.mockReturnValue(of(question(1, { status: 'approved', isEdited: true })));
      quizzesApi.reviewStats.mockReturnValue(of({ ...STATS, editRate: 1 }));

      await store.setStatus(1, 'approved');

      expect(store.questions()[0]).toMatchObject({ status: 'approved', isEdited: true });
      await vi.waitFor(() => expect(store.editRate()).toBe(1));
      expect(store.announcement()).toBe('Question 1 approved.');
    });

    it('ignores a change to the status the question already has', async () => {
      await store.setStatus(1, 'draft');

      expect(questionsApi.update).not.toHaveBeenCalled();
    });
  });

  describe('edits', () => {
    const edit = { stem: 'New?', options: ['A', 'B', 'C', 'D'], correctIndex: 1, explanation: 'x' };

    it('keeps API field errors on the card and stays in edit mode when a save is rejected', async () => {
      store.startEdit(1);
      questionsApi.update.mockReturnValue(
        throwError(
          () =>
            new AppError('validation', 400, 'The edited question breaks the quiz rules.', [
              { pointer: '#/stem', detail: 'question 1: stem is the same as question 2' },
            ]),
        ),
      );

      expect(await store.saveEdit(1, edit)).toBe(false);

      expect(store.editing()).toBe(1);
      expect(store.card(1).fieldErrors).toEqual([
        { pointer: '#/stem', detail: 'question 1: stem is the same as question 2' },
      ]);
      expect(store.card(1).error).toBeUndefined();
    });

    it('closes the editor and shows the saved question on success', async () => {
      store.startEdit(1);
      questionsApi.update.mockReturnValue(of(question(1, { stem: 'New?', isEdited: true })));

      expect(await store.saveEdit(1, edit)).toBe(true);

      expect(store.editing()).toBeNull();
      expect(store.questions()[0]).toMatchObject({ stem: 'New?', isEdited: true });
    });
  });

  describe('regenerate', () => {
    it('shows the card as regenerating, then puts the new question at the same position', async () => {
      const response = new Subject<QuestionResponse>();
      questionsApi.regenerate.mockReturnValue(response);

      const done = store.regenerate(2);
      expect(store.card(2).busy).toBe('regenerating');

      response.next(question(2, { id: 'q2-new', stem: 'A brand new question?' }));
      response.complete();
      await done;

      expect(store.questions().map((q) => q.id)).toEqual(['q1', 'q2-new']);
      expect(store.questions()[1]).toMatchObject({ position: 2, stem: 'A brand new question?' });
      expect(store.card(2).busy).toBeUndefined();
    });

    it('keeps the old question and offers a retry when the model output is unusable', async () => {
      questionsApi.regenerate.mockReturnValue(
        throwError(() => new AppError('invalid-output', 502, undefined)),
      );

      await store.regenerate(2);

      expect(store.questions()[1]?.id).toBe('q2');
      expect(store.card(2).error?.kind).toBe('invalid-output');
      expect(store.card(2).retry).toBeTypeOf('function');
    });
  });

  describe('publish', () => {
    it('is only possible with at least one approved question', async () => {
      expect(store.canPublish()).toBe(false);

      questionsApi.update.mockReturnValue(of(question(1, { status: 'approved' })));
      await store.setStatus(1, 'approved');

      expect(store.canPublish()).toBe(true);
    });
  });
});
