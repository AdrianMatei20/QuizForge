import { validationProblem } from '../common/problem-details/validation-problem.js';

export const USAGE_DEFAULT_DAYS = 7;
export const USAGE_MAX_DAYS = 366;

const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface UsageRange {
  /** Inclusive UTC days, YYYY-MM-DD. */
  from: string;
  to: string;
  /** Query bounds: [fromDate, toExclusive). */
  fromDate: Date;
  toExclusive: Date;
}

/** "2026-10-19" -> that day at 00:00 UTC, or undefined if not a real date. */
function parseDay(value: string): Date | undefined {
  if (!DATE.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  // Rejects "2026-02-31", which Date would roll over into March.
  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
    ? undefined
    : date;
}

const toDay = (date: Date) => date.toISOString().slice(0, 10);

/**
 * The days a /usage request covers. Both ends are inclusive UTC days; `to`
 * defaults to today and `from` to 6 days before `to` (a week). At most
 * USAGE_MAX_DAYS days. Invalid input is a 400 validation problem naming the
 * parameter.
 */
export function resolveUsageRange(
  query: { from?: string; to?: string },
  now: Date,
): UsageRange {
  const errors: { parameter: string; detail: string }[] = [];
  const to = query.to === undefined ? parseDay(toDay(now)) : parseDay(query.to);
  if (to === undefined) {
    errors.push({ parameter: 'to', detail: 'to must be a date as YYYY-MM-DD' });
  }
  const from =
    query.from === undefined
      ? to && new Date(to.getTime() - (USAGE_DEFAULT_DAYS - 1) * DAY_MS)
      : parseDay(query.from);
  // Only when given: a missing `from` defaults from `to`, whose own error is already reported.
  if (query.from !== undefined && from === undefined) {
    errors.push({
      parameter: 'from',
      detail: 'from must be a date as YYYY-MM-DD',
    });
  }
  if (from && to) {
    const days = (to.getTime() - from.getTime()) / DAY_MS + 1;
    if (days < 1) {
      errors.push({ parameter: 'from', detail: 'from must not be after to' });
    } else if (days > USAGE_MAX_DAYS) {
      errors.push({
        parameter: 'from',
        detail: `the range can be at most ${USAGE_MAX_DAYS} days`,
      });
    }
  }
  if (errors.length > 0 || !from || !to) {
    throw validationProblem(errors);
  }
  return {
    from: toDay(from),
    to: toDay(to),
    fromDate: from,
    toExclusive: new Date(to.getTime() + DAY_MS),
  };
}
