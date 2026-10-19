import type {
  Difficulty,
  QuestionType,
  QuizFailureReason,
  QuizSettings,
  QuizStatus,
} from '../core/api/api.types';

/** The order statuses are listed in: a quiz's life, then failure. */
export const QUIZ_STATUSES_IN_ORDER: readonly QuizStatus[] = [
  'generating',
  'draft',
  'published',
  'failed',
];

export const QUIZ_STATUS_LABEL: Record<QuizStatus, string> = {
  generating: 'Generating',
  draft: 'Draft',
  published: 'Published',
  failed: 'Failed',
};

/**
 * Why a quiz failed, as the end of "… because …". Typed by the API's reasons,
 * so a new reason is a compile error here rather than a raw code on screen.
 */
export const FAILURE_TEXT: Record<QuizFailureReason, string> = {
  invalid_output: 'the AI kept returning answers that could not be used',
  refusal: 'the AI declined to write questions for this lesson',
  truncated: 'the AI answer was cut off',
  budget_exceeded: "today's AI budget was used up",
  timeout: 'the AI service took too long',
  rate_limited: 'the AI service was busy',
  provider_error: 'the AI service had a problem',
  cancelled: 'the request was cancelled',
  internal_error: 'of an unexpected error',
  interrupted: 'the server stopped while generating it',
};

/** A failed quiz's reason as a sentence; a reason this app does not know yet still reads as one. */
export function failureSentence(reason: QuizFailureReason | null | undefined): string {
  const text = reason ? FAILURE_TEXT[reason] : undefined;
  return text ? `Failed because ${text}.` : 'Failed for an unknown reason.';
}

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

const TYPE_LABEL: Record<QuestionType, string> = {
  multiple_choice: 'multiple choice',
  true_false: 'true/false',
};

/** e.g. "Medium · multiple choice, true/false". */
export function settingsSummary(settings: QuizSettings): string {
  const types = settings.types.map((type) => TYPE_LABEL[type]).join(', ');
  return `${DIFFICULTY_LABEL[settings.difficulty]} · ${types}`;
}
