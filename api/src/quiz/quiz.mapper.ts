import { ApiProperty } from '@nestjs/swagger';
import { EXAMPLE_IDS } from '../docs/problem-details.dto.js';
import type { LlmUsageTotals } from '../llm/llm-call.store.js';
import type { Question } from './question.entity.js';
import type { Quiz } from './quiz.entity.js';
import { contentDiffers } from './review-stats.js';
import {
  DIFFICULTIES,
  type Difficulty,
  QUESTION_STATUSES,
  QUESTION_TYPES,
  type QuestionStatus,
  type QuestionType,
  QUIZ_COUNT_MAX,
  QUIZ_COUNT_MIN,
  QUIZ_FAILURE_REASONS,
  QUIZ_STATUSES,
  type QuizFailureReason,
  type QuizStatus,
} from './quiz.types.js';

/*
 * API response shapes. Classes rather than interfaces so Swagger can read
 * their decorators; the mappers below still return plain objects.
 */

const QUESTION_ID = { format: 'uuid', example: EXAMPLE_IDS.question };
const QUIZ_ID = { format: 'uuid', example: EXAMPLE_IDS.quiz };
const LESSON_ID = { format: 'uuid', example: EXAMPLE_IDS.lesson };
const TIMESTAMP = { format: 'date-time', example: '2026-10-19T15:00:00.000Z' };

export class QuestionResponse {
  @ApiProperty(QUESTION_ID)
  id!: string;

  @ApiProperty({ description: '1-based order within the quiz.', example: 1 })
  position!: number;

  @ApiProperty({ enum: QUESTION_TYPES, example: 'multiple_choice' })
  type!: QuestionType;

  @ApiProperty({ example: 'What is the base case of a recursive function?' })
  stem!: string;

  @ApiProperty({
    description:
      'Multiple choice: 4 options, shuffled when the question was generated. True/false: ["True", "False"].',
    type: [String],
    example: [
      'The first call made to the function',
      'A condition where the function returns a result without calling itself',
      'The deepest call on the call stack',
      'A loop that replaces the recursion',
    ],
  })
  options!: string[];

  @ApiProperty({ description: 'Zero-based index into options.', example: 1 })
  correctIndex!: number;

  @ApiProperty({
    example:
      'The lesson defines the base case as the condition where the function returns without calling itself.',
  })
  explanation!: string;

  @ApiProperty({
    description: 'The sentence of the lesson that supports the answer.',
    example:
      'a base case, which is a condition where the function returns a result without calling itself',
  })
  sourceQuote!: string;

  @ApiProperty({ enum: QUESTION_STATUSES, example: 'draft' })
  status!: QuestionStatus;

  @ApiProperty({
    ...TIMESTAMP,
    nullable: true,
    type: String,
    description: 'When a teacher last changed the content; null if never.',
  })
  editedAt!: string | null;

  @ApiProperty({
    description:
      "Whether the content now differs from the AI's version: stem, explanation, the set of options or the correct answer. " +
      'Reordering options, or changing only case or whitespace, does not count. The edit rate uses the same rule.',
    example: false,
  })
  isEdited!: boolean;
}

export class QuizSettingsResponse {
  @ApiProperty({ minimum: QUIZ_COUNT_MIN, maximum: QUIZ_COUNT_MAX, example: 5 })
  count!: number;

  @ApiProperty({ enum: DIFFICULTIES, example: 'medium' })
  difficulty!: Difficulty;

  @ApiProperty({
    enum: QUESTION_TYPES,
    isArray: true,
    example: ['multiple_choice', 'true_false'],
  })
  types!: QuestionType[];
}

/** A quiz in a list: no questions. */
export class QuizSummaryResponse {
  @ApiProperty(QUIZ_ID)
  id!: string;

  @ApiProperty({ enum: QUIZ_STATUSES, example: 'draft' })
  status!: QuizStatus;

  @ApiProperty({
    enum: QUIZ_FAILURE_REASONS,
    nullable: true,
    description: 'Why the quiz failed; null unless status is "failed".',
    example: null,
  })
  failureReason!: QuizFailureReason | null;

  @ApiProperty({ type: QuizSettingsResponse })
  settings!: QuizSettingsResponse;

  @ApiProperty(TIMESTAMP)
  createdAt!: string;
}

export class QuizResponse extends QuizSummaryResponse {
  @ApiProperty(LESSON_ID)
  lessonId!: string;

  @ApiProperty({ example: 'quiz' })
  promptId!: string;

  @ApiProperty({ example: 1 })
  promptVersion!: number;

  @ApiProperty({ example: 'claude-haiku-5-5' })
  model!: string;

  @ApiProperty({
    description:
      'Current questions in order. Once published, only the approved ones.',
    type: [QuestionResponse],
  })
  questions!: QuestionResponse[];
}

export class QuestionStatusCountsResponse {
  @ApiProperty({ example: 2 })
  draft!: number;

  @ApiProperty({ example: 2 })
  approved!: number;

  @ApiProperty({ example: 1 })
  rejected!: number;
}

export class ReviewStatsResponse {
  @ApiProperty(QUIZ_ID)
  quizId!: string;

  @ApiProperty({ description: 'Current (not replaced) questions.', example: 5 })
  total!: number;

  @ApiProperty({ type: QuestionStatusCountsResponse })
  byStatus!: QuestionStatusCountsResponse;

  @ApiProperty({
    description: 'Questions replaced through regenerate.',
    example: 1,
  })
  regenerated!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Approved questions whose content differs from the model original, divided by approved questions. Reordering options is not an edit. Null with no approved questions.',
    example: 0.5,
  })
  editRate!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'rejected / (approved + rejected); drafts are undecided. Null when nothing is decided.',
    example: 0.333,
  })
  rejectRate!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      '(rejected + regenerated) / (approved + rejected + regenerated): how often the model question was not good enough.',
    example: 0.5,
  })
  missRate!: number | null;
}

export class QuizCostResponse {
  @ApiProperty(QUIZ_ID)
  quizId!: string;

  @ApiProperty({
    description: 'LLM calls (one per generation or regeneration request).',
    example: 2,
  })
  calls!: number;

  @ApiProperty({
    description: 'Provider requests, retries and repair calls included.',
    example: 3,
  })
  attempts!: number;

  @ApiProperty({ example: 3702 })
  inputTokens!: number;

  @ApiProperty({ example: 2050 })
  outputTokens!: number;

  @ApiProperty({ example: 5752 })
  totalTokens!: number;

  @ApiProperty({
    description: 'USD as a decimal string with 6 places, never a float.',
    example: '0.001395',
  })
  costUsd!: string;
}

/**
 * Explicit mapping keeps the API shape independent of the table layout.
 * `original` and the per-question prompt and model stay internal; clients get
 * `isEdited` instead of the original itself.
 */
export function toQuizResponse(quiz: Quiz): QuizResponse {
  return {
    id: quiz.id,
    lessonId: quiz.lessonId,
    status: quiz.status,
    failureReason: quiz.failureReason,
    promptId: quiz.promptId,
    promptVersion: quiz.promptVersion,
    model: quiz.model,
    settings: quiz.settings,
    createdAt: quiz.createdAt.toISOString(),
    questions: (quiz.questions ?? []).map(toQuestionResponse),
  };
}

export function toQuizSummaryResponse(quiz: Quiz): QuizSummaryResponse {
  return {
    id: quiz.id,
    status: quiz.status,
    failureReason: quiz.failureReason,
    settings: quiz.settings,
    createdAt: quiz.createdAt.toISOString(),
  };
}

export function toQuizCostResponse(
  quizId: string,
  usage: LlmUsageTotals,
): QuizCostResponse {
  return {
    quizId,
    calls: usage.calls,
    attempts: usage.attempts,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.inputTokens + usage.outputTokens,
    costUsd: usage.costUsd,
  };
}

export function toQuestionResponse(question: Question): QuestionResponse {
  return {
    id: question.id,
    position: question.position,
    type: question.type,
    stem: question.stem,
    options: question.options,
    correctIndex: question.correctIndex,
    explanation: question.explanation,
    sourceQuote: question.sourceQuote,
    status: question.status,
    editedAt: question.editedAt?.toISOString() ?? null,
    isEdited: contentDiffers(question),
  };
}

/** 202 body of POST /lessons/:id/quizzes with stream: true. */
export class QuizStreamStartedResponse {
  @ApiProperty({
    ...QUIZ_ID,
    description: 'Watch it at GET /api/quizzes/{quizId}/stream.',
  })
  quizId!: string;
}

/** Data of a `question_rejected` stream event. */
export class QuestionRejectedEvent {
  @ApiProperty({
    description: 'The position the rejected line would have had.',
    example: 3,
  })
  position!: number;

  @ApiProperty({
    description: 'Why the line was rejected. Never quotes the model output.',
    type: [String],
    example: ['question 3: sourceQuote does not appear in the lesson'],
  })
  violations!: string[];
}

export class StreamUsage {
  @ApiProperty({ example: 2 })
  calls!: number;

  @ApiProperty({ example: 1874 })
  inputTokens!: number;

  @ApiProperty({ example: 1814 })
  outputTokens!: number;

  @ApiProperty({ example: 3688 })
  totalTokens!: number;

  @ApiProperty({
    description: 'USD as a decimal string with 6 places.',
    example: '0.001094',
  })
  costUsd!: string;
}

/** Data of the `done` stream event. */
export class StreamDoneEvent {
  @ApiProperty({
    description:
      'Questions saved, including those filled in by the repair step.',
    example: 5,
  })
  generated!: number;

  @ApiProperty({
    description: 'Lines the model wrote that failed validation.',
    example: 1,
  })
  rejected!: number;

  @ApiProperty({
    type: StreamUsage,
    description: 'Every LLM call made for the quiz so far.',
  })
  usage!: StreamUsage;
}

export function toStreamUsage(usage: LlmUsageTotals): StreamUsage {
  return {
    calls: usage.calls,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.inputTokens + usage.outputTokens,
    costUsd: usage.costUsd,
  };
}
