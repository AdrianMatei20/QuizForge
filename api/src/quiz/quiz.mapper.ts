import type { LlmUsageTotals } from '../llm/llm-call.store.js';
import type { Question } from './question.entity.js';
import type { Quiz } from './quiz.entity.js';
import type {
  QuestionStatus,
  QuestionType,
  QuizFailureReason,
  QuizSettings,
  QuizStatus,
} from './quiz.types.js';

export interface QuestionResponse {
  id: string;
  position: number;
  type: QuestionType;
  stem: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  sourceQuote: string;
  status: QuestionStatus;
  editedAt: string | null;
}

export interface QuizResponse {
  id: string;
  lessonId: string;
  status: QuizStatus;
  /** Null unless status is "failed". */
  failureReason: QuizFailureReason | null;
  promptId: string;
  promptVersion: number;
  model: string;
  settings: QuizSettings;
  createdAt: string;
  questions: QuestionResponse[];
}

/** A quiz in a list: no questions. */
export interface QuizSummaryResponse {
  id: string;
  status: QuizStatus;
  failureReason: QuizFailureReason | null;
  settings: QuizSettings;
  createdAt: string;
}

export interface QuizCostResponse {
  quizId: string;
  /** llm_calls rows: one per generation request. */
  calls: number;
  /** Provider requests, retries and repair calls included. */
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** USD as a decimal string with 6 places, never a float. */
  costUsd: string;
}

/**
 * Explicit mapping keeps the API shape independent of the table layout.
 * `original` stays internal for now; the review UI may expose it later.
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

function toQuestionResponse(question: Question): QuestionResponse {
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
  };
}
