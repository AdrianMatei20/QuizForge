import { HttpStatus } from '@nestjs/common';
import type {
  ProblemConvertible,
  ProblemResponse,
} from '../common/problem-details/problem-details.js';

/** One reason model output was rejected. `pointer` locates zod issues; rule violations have none. */
export interface LlmViolation {
  pointer?: string;
  message: string;
}

/** The value stored in llm_calls.error_code for failed calls. */
export type LlmErrorCode =
  | 'budget_exceeded'
  | 'rate_limited'
  | 'timeout'
  | 'upstream_error'
  | 'invalid_output'
  | 'refused'
  | 'output_truncated';

const PROBLEM_TYPE_PREFIX = 'urn:quizforge:problem:';

/**
 * Base class for the errors LlmService throws. They are plain Errors that
 * describe themselves as problem details, so they are not tied to HTTP.
 * Details shown to clients never include prompts, lesson text or model output.
 */
export abstract class LlmError extends Error implements ProblemConvertible {
  abstract readonly code: LlmErrorCode;
  abstract toProblem(): ProblemResponse;
}

/** Today's (UTC) spend has reached LLM_DAILY_BUDGET_USD. The provider was not called. */
export class LlmBudgetExceededError extends LlmError {
  override readonly name = 'LlmBudgetExceededError';
  readonly code = 'budget_exceeded';

  constructor(readonly retryAfterSeconds: number) {
    super('The daily LLM budget is used up');
  }

  toProblem(): ProblemResponse {
    return {
      problem: {
        type: `${PROBLEM_TYPE_PREFIX}llm-budget-exceeded`,
        title: 'AI budget exceeded',
        status: HttpStatus.TOO_MANY_REQUESTS,
        detail:
          "Today's budget for AI generation is used up. Try again after midnight UTC.",
      },
      headers: { 'Retry-After': String(this.retryAfterSeconds) },
    };
  }
}

/** The provider kept answering 429 after every retry. */
export class LlmRateLimitedError extends LlmError {
  override readonly name = 'LlmRateLimitedError';
  readonly code = 'rate_limited';

  constructor(
    readonly retryAfterSeconds: number,
    options?: ErrorOptions,
  ) {
    super('The LLM provider is rate limiting requests', options);
  }

  toProblem(): ProblemResponse {
    return {
      problem: {
        type: `${PROBLEM_TYPE_PREFIX}llm-rate-limited`,
        title: 'AI service busy',
        status: HttpStatus.SERVICE_UNAVAILABLE,
        detail: 'The AI service is busy. Try again shortly.',
      },
      headers: { 'Retry-After': String(this.retryAfterSeconds) },
    };
  }
}

/** Every attempt hit the per-call timeout. */
export class LlmTimeoutError extends LlmError {
  override readonly name = 'LlmTimeoutError';
  readonly code = 'timeout';

  constructor(options?: ErrorOptions) {
    super('The LLM provider did not respond in time', options);
  }

  toProblem(): ProblemResponse {
    return {
      problem: {
        type: `${PROBLEM_TYPE_PREFIX}llm-timeout`,
        title: 'AI service timeout',
        status: HttpStatus.GATEWAY_TIMEOUT,
        detail: 'The AI service did not respond in time. Try again shortly.',
      },
    };
  }
}

/**
 * The provider failed in a way we cannot fix by waiting: 5xx after every
 * retry, or a 4xx such as a bad request or a rejected API key.
 */
export class LlmUpstreamError extends LlmError {
  override readonly name = 'LlmUpstreamError';
  readonly code = 'upstream_error';

  constructor(options?: ErrorOptions) {
    super('The LLM provider returned an error', options);
  }

  toProblem(): ProblemResponse {
    return {
      problem: {
        type: `${PROBLEM_TYPE_PREFIX}llm-upstream-error`,
        title: 'AI service error',
        status: HttpStatus.BAD_GATEWAY,
        detail: 'The AI service returned an error. Try again later.',
      },
    };
  }
}

/**
 * The model declined to answer. A repair call cannot change that, so none is
 * made. 422: the request was understood, but its content was refused.
 */
export class LlmRefusalError extends LlmError {
  override readonly name = 'LlmRefusalError';
  readonly code = 'refused';

  constructor() {
    super('The model refused the request');
  }

  toProblem(): ProblemResponse {
    return {
      problem: {
        type: `${PROBLEM_TYPE_PREFIX}llm-refused`,
        title: 'AI request refused',
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        // Never the model's own wording: it is model output.
        detail:
          'The AI service declined to process this content. Review the input and try again.',
      },
    };
  }
}

/**
 * The output was cut off by the token limit (or a full context window). A
 * repair call would be cut off the same way, so none is made.
 */
export class LlmOutputTruncatedError extends LlmError {
  override readonly name = 'LlmOutputTruncatedError';
  readonly code = 'output_truncated';

  constructor(readonly maxTokens: number) {
    super(`The model output was cut off at maxTokens=${maxTokens}`);
  }

  toProblem(): ProblemResponse {
    return {
      problem: {
        type: `${PROBLEM_TYPE_PREFIX}llm-output-truncated`,
        title: 'AI output truncated',
        status: HttpStatus.BAD_GATEWAY,
        detail:
          'The AI output was cut off before it was complete. Raise maxTokens for this feature, or shorten the input.',
        maxTokens: this.maxTokens,
      },
    };
  }
}

/** The output failed its schema or rules, and the one repair attempt failed too. */
export class LlmInvalidOutputError extends LlmError {
  override readonly name = 'LlmInvalidOutputError';
  readonly code = 'invalid_output';

  constructor(readonly violations: LlmViolation[]) {
    super(`The model output was invalid (${violations.length} violations)`);
  }

  toProblem(): ProblemResponse {
    return {
      problem: {
        type: `${PROBLEM_TYPE_PREFIX}llm-invalid-output`,
        title: 'AI output rejected',
        status: HttpStatus.BAD_GATEWAY,
        detail:
          'The AI service produced output that failed validation. Try again.',
        // Only the reasons, never the output itself.
        errors: this.violations.map(({ pointer, message }) =>
          pointer === undefined
            ? { detail: message }
            : { pointer, detail: message },
        ),
      },
    };
  }
}
