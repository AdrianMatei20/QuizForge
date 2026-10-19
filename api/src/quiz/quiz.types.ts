/**
 * Value sets shared by the entities, the HTTP DTOs and the LLM output schema,
 * so the database constraints, request validation and model output always
 * agree on what is allowed.
 */

export const QUESTION_TYPES = ['multiple_choice', 'true_false'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const QUIZ_STATUSES = [
  'generating',
  'draft',
  'published',
  'failed',
] as const;
export type QuizStatus = (typeof QUIZ_STATUSES)[number];

/**
 * Why a quiz ended as "failed". An error code only: never model output.
 * The two kinds of provider trouble are kept apart because they call for
 * different fixes: rate_limited means wait or slow down, provider_error
 * means something is broken.
 */
export const QUIZ_FAILURE_REASONS = [
  'invalid_output',
  'refusal',
  'truncated',
  'budget_exceeded',
  'timeout',
  'rate_limited',
  'provider_error',
  'cancelled',
  'internal_error',
] as const;
export type QuizFailureReason = (typeof QUIZ_FAILURE_REASONS)[number];

export const QUESTION_STATUSES = ['draft', 'approved', 'rejected'] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

/** What the teacher asked for; stored on the quiz as jsonb. */
export interface QuizSettings {
  count: number;
  difficulty: Difficulty;
  types: QuestionType[];
}

export const QUIZ_COUNT_MIN = 3;
export const QUIZ_COUNT_MAX = 10;

/** The answer options of every true/false question, in this order. */
export const TRUE_FALSE_OPTIONS = ['True', 'False'] as const;
