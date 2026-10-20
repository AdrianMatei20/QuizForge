import { applyDecorators, type Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import {
  LlmProblemDetailsDto,
  ProblemDetailsDto,
  QuizGenerationProblemDetailsDto,
  ValidationProblemDetailsDto,
} from './problem-details.dto.js';

/** One documented error response of an endpoint. */
export interface ProblemResponseSpec {
  status: number;
  description: string;
  schema: Type;
  /** Documents the Retry-After response header (seconds). */
  retryAfter?: boolean;
}

const retryAfterHeader = {
  'Retry-After': {
    description: 'Seconds to wait before trying again.',
    schema: { type: 'integer', example: 30 },
  },
};

const LLM_ERRORS = (schema: Type, suffix: string) =>
  ({
    refused: {
      status: 422,
      description:
        `The model refused the request (urn:quizforge:problem:llm-refused).${suffix} ` +
        'Or, in demo mode (LLM_PROVIDER=fake), the lesson is not one of the sample lessons (urn:quizforge:problem:demo-mode-lesson, with `sampleLessons`); nothing is stored then.',
      // The demo-mode 422 comes before any quiz exists, so not every 422 has a quizId.
      schema: ProblemDetailsDto,
    },
    budgetExceeded: {
      status: 429,
      description:
        'Too many generation requests from this client (urn:quizforge:problem:too-many-requests; THROTTLE_GENERATE_LIMIT per THROTTLE_GENERATE_TTL_MS), ' +
        `or today's AI budget (LLM_DAILY_BUDGET_USD) is used up and the provider was not called (urn:quizforge:problem:llm-budget-exceeded).${suffix}`,
      // Throttling happens before any quiz exists, so not every 429 has a quizId.
      schema: ProblemDetailsDto,
      retryAfter: true,
    },
    badOutput: {
      status: 502,
      description:
        'The model output was still invalid after one repair call (llm-invalid-output, with `errors`), ' +
        `was cut off by the token limit (llm-output-truncated), or the provider failed (llm-upstream-error).${suffix}`,
      schema,
    },
    rateLimited: {
      status: 503,
      description: `The provider kept rate limiting after every retry (urn:quizforge:problem:llm-rate-limited).${suffix}`,
      schema,
      retryAfter: true,
    },
    timeout: {
      status: 504,
      description: `Every attempt timed out (urn:quizforge:problem:llm-timeout).${suffix}`,
      schema,
    },
  }) satisfies Record<string, ProblemResponseSpec>;

/** The error responses endpoints share. Pick the ones an endpoint can return. */
export const PROBLEMS = {
  validation: {
    status: 400,
    description:
      'Invalid request: a body field (located by `pointer`), or a query or path parameter (named in `parameter`; path ids must be UUIDs). `errors` lists every problem.',
    schema: ValidationProblemDetailsDto,
  },
  notFound: {
    status: 404,
    description: 'No such resource.',
    schema: ProblemDetailsDto,
  },
  lessonTooLarge: {
    status: 413,
    description:
      'Lesson content is over 20,000 characters (urn:quizforge:problem:lesson-too-large, with `maxLength`), or the JSON body is over 256 KB.',
    schema: ProblemDetailsDto,
  },
  tooManyAttempts: {
    status: 429,
    description:
      'Too many attempts from this client (urn:quizforge:problem:too-many-requests), with `Retry-After`: THROTTLE_ATTEMPT_LIMIT per THROTTLE_ATTEMPT_TTL_MS, per IP.',
    schema: ProblemDetailsDto,
  },
  internal: {
    status: 500,
    description: 'Unexpected error. The details are logged, never returned.',
    schema: ProblemDetailsDto,
  },
  publishConflict: {
    status: 409,
    description:
      'Already published (quiz-published), or not a draft, e.g. a failed quiz (quiz-not-in-review, with `quizStatus`).',
    schema: ProblemDetailsDto,
  },
  noApprovedQuestions: {
    status: 422,
    description:
      'No question is approved yet (urn:quizforge:problem:no-approved-questions).',
    schema: ProblemDetailsDto,
  },
  editConflict: {
    status: 409,
    description:
      'The quiz is published (quiz-published), or the status change is not allowed, e.g. approved to rejected (invalid-status-transition, with `from` and `to`).',
    schema: ProblemDetailsDto,
  },
  regenerateConflict: {
    status: 409,
    description:
      'The quiz is published (quiz-published), or another request replaced the question first (question-already-replaced).',
    schema: ProblemDetailsDto,
  },
  /** Quiz generation: every failure after the quiz row exists carries its `quizId`. */
  generation: {
    ...LLM_ERRORS(
      QuizGenerationProblemDetailsDto,
      ' The failed quiz is identified by `quizId`.',
    ),
    internal: {
      status: 500,
      description:
        'Unexpected error after the quiz was created (failureReason internal_error). Includes `quizId`.',
      schema: QuizGenerationProblemDetailsDto,
    },
  },
  /** Regenerating a question: the same LLM errors, without a quiz id; the question is left unchanged. */
  regeneration: LLM_ERRORS(
    LlmProblemDetailsDto,
    ' The question is left unchanged.',
  ),
} as const;

const ALL_SCHEMAS = [
  ProblemDetailsDto,
  ValidationProblemDetailsDto,
  QuizGenerationProblemDetailsDto,
  LlmProblemDetailsDto,
];

/**
 * Documents an endpoint's error responses as application/problem+json.
 * A generic 500 is added unless the endpoint documents its own.
 */
export function ApiProblems(...specs: ProblemResponseSpec[]): MethodDecorator {
  const all: ProblemResponseSpec[] = specs.some((spec) => spec.status === 500)
    ? specs
    : [...specs, PROBLEMS.internal];
  return applyDecorators(
    ApiExtraModels(...ALL_SCHEMAS),
    ...all.map((spec) =>
      ApiResponse({
        status: spec.status,
        description: spec.description,
        content: {
          'application/problem+json': {
            schema: { $ref: getSchemaPath(spec.schema) },
          },
        },
        ...(spec.retryAfter ? { headers: retryAfterHeader } : {}),
      }),
    ),
  );
}
