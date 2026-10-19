/** Injected wherever "now" matters (the daily budget), so tests can pin the time. */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');

export const systemClock: Clock = { now: () => new Date() };

/** 00:00:00.000 UTC on the same UTC day as `date`. */
export function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/** Whole seconds until the next UTC midnight, rounded up and at least 1 (for Retry-After). */
export function secondsUntilNextUtcMidnight(date: Date): number {
  const nextMidnight = startOfUtcDay(date).getTime() + 24 * 60 * 60 * 1000;
  return Math.max(1, Math.ceil((nextMidnight - date.getTime()) / 1000));
}
