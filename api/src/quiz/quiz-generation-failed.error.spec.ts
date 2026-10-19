import {
  LlmBudgetExceededError,
  LlmInvalidOutputError,
} from '../llm/llm.errors.js';
import { QuizGenerationFailedError } from './quiz-generation-failed.error.js';

const QUIZ_ID = '11111111-1111-4111-8111-111111111111';

describe('QuizGenerationFailedError', () => {
  it("adds quizId to the original error's problem, keeping its headers", () => {
    const cause = new LlmBudgetExceededError(120);
    const error = new QuizGenerationFailedError(QUIZ_ID, 'budget_exceeded', {
      cause,
    });

    expect(error.toProblem()).toEqual({
      problem: { ...cause.toProblem().problem, quizId: QUIZ_ID },
      headers: { 'Retry-After': '120' },
    });
  });

  it('keeps the violations of an invalid-output error', () => {
    const cause = new LlmInvalidOutputError([{ message: 'question 2: bad' }]);
    const { problem } = new QuizGenerationFailedError(
      QUIZ_ID,
      'invalid_output',
      { cause },
    ).toProblem();

    expect(problem).toMatchObject({
      status: 502,
      quizId: QUIZ_ID,
      errors: [{ detail: 'question 2: bad' }],
    });
  });

  it('turns an unexpected cause into a generic 500 with quizId, hiding its message', () => {
    const error = new QuizGenerationFailedError(QUIZ_ID, 'internal_error', {
      cause: new Error('password=hunter2 in connection string'),
    });

    const response = error.toProblem();

    expect(response.problem).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      detail: 'An unexpected error occurred. Please try again later.',
      quizId: QUIZ_ID,
    });
    expect(response.headers).toBeUndefined();
    expect(JSON.stringify(response)).not.toContain('hunter2');
  });
});
