import { LlmProviderError } from '../llm/llm-client.js';
import {
  LlmBudgetExceededError,
  LlmInvalidOutputError,
  LlmOutputTruncatedError,
  LlmRateLimitedError,
  LlmRefusalError,
  LlmTimeoutError,
  LlmUpstreamError,
} from '../llm/llm.errors.js';
import type { QuizFailureReason } from './quiz.types.js';

/**
 * Maps whatever made generation fail to the code stored in
 * quizzes.failure_reason. Only the error's class is looked at, never its
 * message, so model output cannot end up in the column.
 */
export function quizFailureReason(error: unknown): QuizFailureReason {
  if (error instanceof LlmInvalidOutputError) {
    return 'invalid_output';
  }
  if (error instanceof LlmRefusalError) {
    return 'refusal';
  }
  if (error instanceof LlmOutputTruncatedError) {
    return 'truncated';
  }
  if (error instanceof LlmBudgetExceededError) {
    return 'budget_exceeded';
  }
  if (error instanceof LlmTimeoutError) {
    return 'timeout';
  }
  if (error instanceof LlmRateLimitedError) {
    return 'rate_limited';
  }
  if (error instanceof LlmUpstreamError) {
    return 'provider_error';
  }
  if (isAbort(error)) {
    return 'cancelled';
  }
  return 'internal_error';
}

/**
 * LlmService passes an aborted provider call through as an LlmProviderError
 * of kind "aborted"; AbortSignal.throwIfAborted() throws an AbortError.
 */
function isAbort(error: unknown): boolean {
  return (
    (error instanceof LlmProviderError && error.kind === 'aborted') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}
