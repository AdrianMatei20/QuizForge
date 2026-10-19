import { QueryFailedError } from 'typeorm';
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
import { quizFailureReason } from './quiz-failure.js';

describe('quizFailureReason', () => {
  it.each([
    [new LlmInvalidOutputError([{ message: 'bad' }]), 'invalid_output'],
    [new LlmRefusalError(), 'refusal'],
    [new LlmOutputTruncatedError(8_192), 'truncated'],
    [new LlmBudgetExceededError(60), 'budget_exceeded'],
    [new LlmTimeoutError(), 'timeout'],
    [new LlmRateLimitedError(30), 'rate_limited'],
    [new LlmUpstreamError(), 'provider_error'],
  ])('maps %s to %s', (error, reason) => {
    expect(quizFailureReason(error)).toBe(reason);
  });

  it('maps an aborted provider call and an AbortError to cancelled', () => {
    expect(
      quizFailureReason(new LlmProviderError('aborted', 'Request aborted')),
    ).toBe('cancelled');
    expect(
      quizFailureReason(
        new DOMException('This operation was aborted', 'AbortError'),
      ),
    ).toBe('cancelled');
  });

  it('maps anything else to internal_error', () => {
    expect(
      quizFailureReason(
        new QueryFailedError('INSERT ...', [], new Error('db down')),
      ),
    ).toBe('internal_error');
    expect(quizFailureReason(new Error('surprise'))).toBe('internal_error');
    expect(quizFailureReason('not even an error')).toBe('internal_error');
  });
});
