import { HttpException } from '@nestjs/common';

/**
 * One entry per broken rule. `pointer` is a JSON Pointer to the offending
 * field; it is absent when the rule is about the document as a whole.
 */
export interface ProblemFieldError {
  pointer?: string;
  detail: string;
}

/** A problem as thrown by code. Extra members are allowed as RFC 9457 extensions. */
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  errors?: ProblemFieldError[];
  [extension: string]: unknown;
}

/** RFC 9457 problem details as sent to the client. */
export interface ProblemDetails extends Problem {
  instance: string;
}

/** What a ProblemConvertible error contributes to the HTTP response. */
export interface ProblemResponse {
  problem: Problem;
  headers?: Record<string, string>;
}

/**
 * Implemented by domain errors that know how they should look to a client.
 * They stay plain Errors (not HttpExceptions), so code outside HTTP, such as
 * background jobs, can throw them too. The global filter calls toProblem().
 */
export interface ProblemConvertible {
  toProblem(): ProblemResponse;
}

export function isProblemConvertible(
  value: unknown,
): value is ProblemConvertible {
  return (
    value instanceof Error &&
    typeof (value as Partial<ProblemConvertible>).toProblem === 'function'
  );
}

/** What clients see for any unexpected error; the real error is only logged. */
export const GENERIC_SERVER_ERROR_DETAIL =
  'An unexpected error occurred. Please try again later.';

export const PROBLEM_TYPES = {
  // RFC 9457 4.2.1: the problem has no meaning beyond its HTTP status code.
  httpStatus: 'about:blank',
  validation: 'urn:quizforge:problem:validation-error',
} as const;

/**
 * Throw this to send a specific problem to the client. The global filter
 * copies these fields into the response as-is and fills in `instance`.
 */
export class ProblemException extends HttpException {
  constructor(readonly problem: Problem) {
    super(problem.detail, problem.status);
  }
}
