import { HttpException } from '@nestjs/common';

/** One entry per broken rule; `pointer` is a JSON Pointer into the request body. */
export interface ProblemFieldError {
  pointer: string;
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
