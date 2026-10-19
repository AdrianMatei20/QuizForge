import { resolveProblem } from '../common/problem-details/problem-details.filter.js';
import {
  LlmBudgetExceededError,
  LlmInvalidOutputError,
  LlmOutputTruncatedError,
  LlmRateLimitedError,
  LlmRefusalError,
  LlmTimeoutError,
  LlmUpstreamError,
} from './llm.errors.js';

const instance = '/api/quizzes/1/generate';

describe('LLM errors as problem details', () => {
  it('maps a budget overrun to 429 with Retry-After', () => {
    const { problem, headers } = resolveProblem(
      new LlmBudgetExceededError(32_400),
      instance,
    );

    expect(problem).toMatchObject({
      type: 'urn:quizforge:problem:llm-budget-exceeded',
      status: 429,
      instance,
    });
    expect(headers).toEqual({ 'Retry-After': '32400' });
  });

  it('maps rate limiting to 503 with Retry-After', () => {
    const { problem, headers } = resolveProblem(
      new LlmRateLimitedError(7),
      instance,
    );

    expect(problem.status).toBe(503);
    expect(headers).toEqual({ 'Retry-After': '7' });
  });

  it('maps a timeout to 504 and an upstream error to 502, without headers', () => {
    expect(resolveProblem(new LlmTimeoutError(), instance)).toMatchObject({
      problem: { status: 504 },
      headers: {},
    });
    expect(resolveProblem(new LlmUpstreamError(), instance)).toMatchObject({
      problem: { status: 502 },
      headers: {},
    });
  });

  it('maps invalid output to 502 with the violations, with and without pointers', () => {
    const { problem } = resolveProblem(
      new LlmInvalidOutputError([
        { pointer: '#/questions/0/text', message: 'Too small' },
        { message: 'Expected exactly 5 questions' },
      ]),
      instance,
    );

    expect(problem).toMatchObject({
      type: 'urn:quizforge:problem:llm-invalid-output',
      status: 502,
      errors: [
        { pointer: '#/questions/0/text', detail: 'Too small' },
        { detail: 'Expected exactly 5 questions' },
      ],
    });
    expect(problem.errors?.[1]).not.toHaveProperty('pointer');
  });

  it('maps a refusal to 422 without the model wording', () => {
    const { problem, headers } = resolveProblem(
      new LlmRefusalError(),
      instance,
    );

    expect(problem).toMatchObject({
      type: 'urn:quizforge:problem:llm-refused',
      status: 422,
    });
    expect(headers).toEqual({});
    expect(JSON.stringify(problem)).not.toContain("can't help");
  });

  it('maps truncated output to 502 with a hint to raise maxTokens', () => {
    const { problem } = resolveProblem(
      new LlmOutputTruncatedError(512),
      instance,
    );

    expect(problem).toMatchObject({
      type: 'urn:quizforge:problem:llm-output-truncated',
      status: 502,
      maxTokens: 512,
    });
    expect(problem.detail).toContain('Raise maxTokens');
  });

  it('never exposes the provider error it wraps', () => {
    const cause = new Error('upstream said: <lesson>secret lesson</lesson>');

    const { problem } = resolveProblem(
      new LlmUpstreamError({ cause }),
      instance,
    );

    expect(JSON.stringify(problem)).not.toContain('secret');
  });
});
