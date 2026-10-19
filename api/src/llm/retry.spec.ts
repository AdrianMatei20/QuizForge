import { LlmProviderError, type LlmProviderErrorKind } from './llm-client.js';
import { backoffDelayMs, isRetryable, retryDelayMs } from './retry.js';

describe('retryDelayMs', () => {
  const options = { baseMs: 500, capMs: 8_000, maxRetryAfterMs: 10_000 };
  const half = () => 0.5;

  it('is the full-jitter backoff when there is no Retry-After', () => {
    expect(retryDelayMs(1, undefined, half, options)).toBe(250);
    expect(retryDelayMs(2, undefined, half, options)).toBe(500);
  });

  it('waits at least the Retry-After', () => {
    expect(retryDelayMs(1, 2, half, options)).toBe(2_000);
  });

  it('keeps the jitter when it is longer than the Retry-After', () => {
    // Attempt 5: 0.5 * min(8000, 500 * 2^4) = 4000 > 1000
    expect(retryDelayMs(5, 1, half, options)).toBe(4_000);
  });

  it('caps the Retry-After at maxRetryAfterMs', () => {
    expect(retryDelayMs(1, 3_600, half, options)).toBe(10_000);
  });

  it('treats Retry-After: 0 as "retry now" (jitter only)', () => {
    expect(retryDelayMs(1, 0, half, options)).toBe(250);
  });

  it('ignores Retry-After when maxRetryAfterMs is 0', () => {
    expect(retryDelayMs(1, 30, half, { ...options, maxRetryAfterMs: 0 })).toBe(
      250,
    );
  });
});

describe('backoffDelayMs', () => {
  const almostOne = () => 0.999_999;

  it('doubles the ceiling with each failed attempt', () => {
    expect(backoffDelayMs(1, almostOne)).toBe(499);
    expect(backoffDelayMs(2, almostOne)).toBe(999);
    expect(backoffDelayMs(3, almostOne)).toBe(1_999);
  });

  it('never exceeds the cap', () => {
    expect(backoffDelayMs(10, almostOne)).toBe(7_999);
  });

  it('can be zero (full jitter starts at 0)', () => {
    expect(backoffDelayMs(3, () => 0)).toBe(0);
  });

  it('scales with the random value', () => {
    expect(backoffDelayMs(2, () => 0.25)).toBe(250);
  });

  it('accepts custom base and cap', () => {
    expect(backoffDelayMs(4, () => 0.5, { baseMs: 100, capMs: 500 })).toBe(250);
  });
});

describe('isRetryable', () => {
  it.each<[LlmProviderErrorKind, boolean]>([
    ['rate_limited', true],
    ['server', true],
    ['timeout', true],
    ['client', false],
    ['aborted', false],
  ])('%s -> %s', (kind, retryable) => {
    expect(isRetryable(new LlmProviderError(kind, 'test'))).toBe(retryable);
  });
});
