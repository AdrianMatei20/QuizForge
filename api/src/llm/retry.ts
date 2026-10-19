import type { LlmProviderError } from './llm-client.js';

/** Attempts per provider call, the first one included. */
export const MAX_ATTEMPTS = 3;

export interface BackoffOptions {
  baseMs: number;
  capMs: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = { baseMs: 500, capMs: 8_000 };

/**
 * "Full jitter" exponential backoff: a random delay between 0 and
 * min(cap, base * 2^(attempt - 1)). The randomness spreads out clients that
 * failed at the same moment, so they do not all retry in lockstep.
 *
 * @param failedAttempt 1 for the delay after the first failure, 2 after the second, ...
 * @param random returns a number in [0, 1), like Math.random (injected for tests)
 */
export function backoffDelayMs(
  failedAttempt: number,
  random: () => number,
  { baseMs, capMs }: BackoffOptions = DEFAULT_BACKOFF,
): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** (failedAttempt - 1));
  return Math.floor(random() * ceiling);
}

export interface RetryDelayOptions extends BackoffOptions {
  /** Upper bound for a provider's Retry-After, so one header cannot stall a request for minutes. */
  maxRetryAfterMs: number;
}

/**
 * The delay before the next attempt. Without a Retry-After header it is the
 * full-jitter backoff. With one, it is at least Retry-After (capped at
 * maxRetryAfterMs): retrying sooner than the provider asked would only earn
 * another 429. The jitter still applies if it happens to be longer.
 */
export function retryDelayMs(
  failedAttempt: number,
  retryAfterSeconds: number | undefined,
  random: () => number,
  { maxRetryAfterMs, ...backoff }: RetryDelayOptions,
): number {
  const jitter = backoffDelayMs(failedAttempt, random, backoff);
  if (retryAfterSeconds === undefined) {
    return jitter;
  }
  return Math.max(jitter, Math.min(retryAfterSeconds * 1000, maxRetryAfterMs));
}

/** 429s, 5xx and timeouts are transient. Other 4xx will fail the same way again, and an abort was asked for. */
export function isRetryable(error: LlmProviderError): boolean {
  return (
    error.kind === 'rate_limited' ||
    error.kind === 'server' ||
    error.kind === 'timeout'
  );
}
