import { HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import type {
  ProblemConvertible,
  ProblemResponse,
} from '../problem-details/problem-details.js';

/** The named throttler for LLM-backed endpoints (generate, regenerate). */
export const GENERATE_THROTTLER = 'generate';

/** A client sent too many generation requests; maps to 429 problem details. */
export class TooManyRequestsError extends Error implements ProblemConvertible {
  override readonly name = 'TooManyRequestsError';

  constructor(readonly retryAfterSeconds: number) {
    super('Too many generation requests');
  }

  toProblem(): ProblemResponse {
    return {
      problem: {
        type: 'urn:quizforge:problem:too-many-requests',
        title: 'Too many requests',
        status: HttpStatus.TOO_MANY_REQUESTS,
        detail: `Too many generation requests from this client. Try again in ${this.retryAfterSeconds} seconds.`,
      },
      // @nestjs/throttler names its header "Retry-After-generate" for a named
      // throttler; clients expect the standard one.
      headers: { 'Retry-After': String(this.retryAfterSeconds) },
    };
  }
}

/**
 * Rate limits the endpoints that call the LLM (they cost money and take
 * seconds), per client IP: THROTTLE_GENERATE_LIMIT requests per
 * THROTTLE_GENERATE_TTL_MS, shared by all of them. Counts are kept in
 * memory, per API instance.
 */
@Injectable()
export class GenerateThrottlerGuard extends ThrottlerGuard {
  /**
   * One counter per client across every guarded endpoint. The default key
   * includes the controller and handler, which would give generate and
   * regenerate a separate allowance each.
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
    // timeToBlockExpire is in seconds; at least 1, so clients do not retry at once.
    throw new TooManyRequestsError(
      Math.max(1, Math.ceil(detail.timeToBlockExpire)),
    );
  }
}
