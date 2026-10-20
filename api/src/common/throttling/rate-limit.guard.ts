import {
  applyDecorators,
  HttpStatus,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import {
  SkipThrottle,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
} from '@nestjs/throttler';
import type {
  ProblemConvertible,
  ProblemResponse,
} from '../problem-details/problem-details.js';

/** The named throttler for LLM-backed endpoints (generate, regenerate). */
export const GENERATE_THROTTLER = 'generate';
/** The named throttler for submitting quiz attempts (public, no login). */
export const ATTEMPT_THROTTLER = 'attempt';

const LIMITED = {
  [GENERATE_THROTTLER]: 'generation requests',
  [ATTEMPT_THROTTLER]: 'quiz attempts',
} as const;
type ThrottlerName = keyof typeof LIMITED;

/** A client went over a rate limit; maps to 429 problem details. */
export class TooManyRequestsError extends Error implements ProblemConvertible {
  override readonly name = 'TooManyRequestsError';

  constructor(
    readonly retryAfterSeconds: number,
    /** What was limited, e.g. "quiz attempts". */
    readonly what: string,
  ) {
    super(`Too many ${what}`);
  }

  toProblem(): ProblemResponse {
    return {
      problem: {
        type: 'urn:quizforge:problem:too-many-requests',
        title: 'Too many requests',
        status: HttpStatus.TOO_MANY_REQUESTS,
        detail: `Too many ${this.what} from this client. Try again in ${this.retryAfterSeconds} seconds.`,
      },
      // @nestjs/throttler names its header after the throttler (e.g.
      // "Retry-After-generate"); clients expect the standard one.
      headers: { 'Retry-After': String(this.retryAfterSeconds) },
    };
  }
}

/**
 * Rate limits per client IP, with the named throttlers configured in
 * AppModule. Counts are kept in memory, per API instance. Use it through
 * GenerateRateLimit() or AttemptRateLimit(), never directly: the guard
 * applies every configured throttler unless the others are skipped.
 */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  /**
   * One counter per client and throttler across every endpoint that uses
   * it. The default key includes the controller and handler, which would
   * give generate and regenerate a separate allowance each.
   */
  protected override generateKey(
    _context: unknown,
    tracker: string,
    throttlerName: string,
  ): string {
    return `${throttlerName}:${tracker}`;
  }

  protected override throwThrottlingException(
    _context: unknown,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    // The key starts with the throttler's name (see generateKey).
    const name = detail.key.split(':')[0] as ThrottlerName;
    // timeToBlockExpire is in seconds; at least 1, so clients do not retry at once.
    throw new TooManyRequestsError(
      Math.max(1, Math.ceil(detail.timeToBlockExpire)),
      LIMITED[name] ?? 'requests',
    );
  }
}

/** THROTTLE_GENERATE_LIMIT per THROTTLE_GENERATE_TTL_MS, shared by every LLM-backed endpoint. */
export const GenerateRateLimit = () =>
  applyDecorators(
    UseGuards(RateLimitGuard),
    SkipThrottle({ [ATTEMPT_THROTTLER]: true }),
  );

/** THROTTLE_ATTEMPT_LIMIT per THROTTLE_ATTEMPT_TTL_MS for submitting quiz attempts. */
export const AttemptRateLimit = () =>
  applyDecorators(
    UseGuards(RateLimitGuard),
    SkipThrottle({ [GENERATE_THROTTLER]: true }),
  );
