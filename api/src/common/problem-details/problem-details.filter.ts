import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { STATUS_CODES } from 'node:http';
import {
  PROBLEM_TYPES,
  type ProblemDetails,
  ProblemException,
} from './problem-details.js';

const GENERIC_SERVER_ERROR_DETAIL =
  'An unexpected error occurred. Please try again later.';

/**
 * Maps any thrown value to RFC 9457 problem details:
 * - ProblemException: used as-is (the thrower chose what to expose).
 * - Other HttpException below 500: its message becomes `detail`.
 * - Anything else: a generic 500. The real error is only logged.
 */
export function toProblemDetails(
  exception: unknown,
  instance: string,
): ProblemDetails {
  if (exception instanceof ProblemException) {
    return { ...exception.problem, instance };
  }

  if (
    exception instanceof HttpException &&
    exception.getStatus() < HttpStatus.INTERNAL_SERVER_ERROR
  ) {
    const status = exception.getStatus();
    return {
      type: PROBLEM_TYPES.httpStatus,
      title: STATUS_CODES[status] ?? 'Error',
      status,
      detail: exception.message,
      instance,
    };
  }

  const status =
    exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
  return {
    type: PROBLEM_TYPES.httpStatus,
    title: STATUS_CODES[status] ?? 'Error',
    status,
    detail: GENERIC_SERVER_ERROR_DETAIL,
    instance,
  };
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const problem = toProblemDetails(exception, request.originalUrl);

    if (problem.status >= 500 && !(exception instanceof ProblemException)) {
      this.logger.error(
        `${request.method} ${request.originalUrl} failed`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response
      .status(problem.status)
      .type('application/problem+json')
      .json(problem);
  }
}
