import { secondsUntilNextUtcMidnight, startOfUtcDay } from './clock.js';

describe('startOfUtcDay', () => {
  it('truncates to midnight UTC', () => {
    expect(
      startOfUtcDay(new Date('2026-10-19T15:30:45.123Z')).toISOString(),
    ).toBe('2026-10-19T00:00:00.000Z');
  });

  it('uses the UTC date, not the local one', () => {
    // 23:30 UTC is already the next day in UTC+1 zones, but not in UTC.
    expect(
      startOfUtcDay(new Date('2026-10-19T23:30:00.000Z')).toISOString(),
    ).toBe('2026-10-19T00:00:00.000Z');
  });
});

describe('secondsUntilNextUtcMidnight', () => {
  it('counts whole seconds until midnight', () => {
    expect(
      secondsUntilNextUtcMidnight(new Date('2026-10-19T15:00:00.000Z')),
    ).toBe(9 * 3600);
  });

  it('rounds partial seconds up', () => {
    expect(
      secondsUntilNextUtcMidnight(new Date('2026-10-19T23:59:59.001Z')),
    ).toBe(1);
  });

  it('is a full day exactly at midnight', () => {
    expect(
      secondsUntilNextUtcMidnight(new Date('2026-10-19T00:00:00.000Z')),
    ).toBe(86_400);
  });
});
