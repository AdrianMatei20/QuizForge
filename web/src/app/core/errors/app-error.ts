import { HttpErrorResponse } from '@angular/common/http';
import type { ProblemFieldError } from '../api/api.types';

/** What went wrong, in terms the UI cares about. */
export type AppErrorKind =
  | 'validation'
  | 'not-found'
  | 'conflict'
  | 'too-large'
  | 'refused'
  | 'budget-exceeded'
  | 'rate-limited'
  | 'invalid-output'
  | 'provider-error'
  | 'timeout'
  | 'network'
  | 'server'
  | 'unknown';

const PREFIX = 'urn:quizforge:problem:';

/** API problem types with a specific meaning for the UI. Anything else falls back to its status. */
const KIND_BY_TYPE: Readonly<Record<string, AppErrorKind>> = {
  [`${PREFIX}validation-error`]: 'validation',
  [`${PREFIX}lesson-too-large`]: 'too-large',
  [`${PREFIX}llm-refused`]: 'refused',
  [`${PREFIX}llm-budget-exceeded`]: 'budget-exceeded',
  [`${PREFIX}llm-rate-limited`]: 'rate-limited',
  // Both mean the model's answer could not be used; asking again may work.
  [`${PREFIX}llm-invalid-output`]: 'invalid-output',
  [`${PREFIX}llm-output-truncated`]: 'invalid-output',
  [`${PREFIX}llm-upstream-error`]: 'provider-error',
  [`${PREFIX}llm-timeout`]: 'timeout',
};

const RETRYABLE: ReadonlySet<AppErrorKind> = new Set([
  'invalid-output',
  'provider-error',
  'rate-limited',
  'timeout',
  'network',
]);

/**
 * Every failed API call surfaces as an AppError (see problemDetailsInterceptor),
 * built from the RFC 9457 problem details the API returns. Components never
 * see HttpErrorResponse or raw JSON.
 */
export class AppError extends Error {
  override readonly name = 'AppError';

  constructor(
    readonly kind: AppErrorKind,
    readonly status: number,
    /** The API's human-readable explanation, if it sent one. Never model output. */
    readonly detail: string | undefined,
    readonly fieldErrors: readonly ProblemFieldError[] = [],
    readonly extras: {
      type?: string;
      title?: string;
      /** The failed quiz, when quiz generation failed. */
      quizId?: string;
      /** From the Retry-After header, for 429 and 503. */
      retryAfterSeconds?: number;
    } = {},
  ) {
    super(detail ?? `Request failed (${kind})`);
  }

  /** Whether trying the same request again might work. */
  get retryable(): boolean {
    return RETRYABLE.has(this.kind);
  }
}

interface ProblemBody {
  type: string;
  title?: string;
  detail?: string;
  errors?: ProblemFieldError[];
  quizId?: string;
}

function isProblemBody(body: unknown): body is ProblemBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { type?: unknown }).type === 'string'
  );
}

function kindForStatus(status: number): AppErrorKind {
  if (status === 0) return 'network';
  if (status === 400) return 'validation';
  if (status === 404) return 'not-found';
  if (status === 409) return 'conflict';
  if (status === 413) return 'too-large';
  if (status >= 500) return 'server';
  return 'unknown';
}

function retryAfterSeconds(error: HttpErrorResponse): number | undefined {
  const header = error.headers?.get('Retry-After');
  const seconds = header === null || header === undefined ? NaN : Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

/** Maps anything thrown by HttpClient to an AppError. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  if (!(error instanceof HttpErrorResponse)) {
    return new AppError('unknown', 0, undefined);
  }
  const body: unknown = error.error;
  if (!isProblemBody(body)) {
    // Network failure, proxy error page, or anything that is not problem details.
    return new AppError(kindForStatus(error.status), error.status, undefined, [], {
      retryAfterSeconds: retryAfterSeconds(error),
    });
  }
  return new AppError(
    KIND_BY_TYPE[body.type] ?? kindForStatus(error.status),
    error.status,
    body.detail,
    Array.isArray(body.errors) ? body.errors : [],
    {
      type: body.type,
      title: body.title,
      quizId: typeof body.quizId === 'string' ? body.quizId : undefined,
      retryAfterSeconds: retryAfterSeconds(error),
    },
  );
}
