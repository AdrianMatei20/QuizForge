import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import type { UsageReport } from '../core/api/api.types';
import { UsageApi } from '../core/api/usage.api';
import { UsagePage } from './usage.page';

const REPORT: UsageReport = {
  from: '2026-10-13',
  to: '2026-10-19',
  totals: {
    calls: 12,
    inputTokens: 21_000,
    outputTokens: 9_000,
    costUsd: '0.012500',
    cacheHitRate: 0.25,
    errorRate: 1 / 12,
    byStatus: { ok: 11, invalid_output: 1, error: 0, budget_exceeded: 0, refused: 0, truncated: 0 },
    estimated: { calls: 1, inputTokens: 1_234, outputTokens: 2, costUsd: '0.002488' },
  },
  days: [
    {
      date: '2026-10-19',
      feature: 'quiz-generation-stream',
      calls: 12,
      inputTokens: 21_000,
      outputTokens: 9_000,
      costUsd: '0.012500',
      cacheHitRate: 0.25,
      errorRate: 1 / 12,
      byStatus: {
        ok: 11,
        invalid_output: 1,
        error: 0,
        budget_exceeded: 0,
        refused: 0,
        truncated: 0,
      },
      estimated: { calls: 1, inputTokens: 1_234, outputTokens: 2, costUsd: '0.002488' },
    },
  ],
};

describe('UsagePage', () => {
  let report: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    report = vi.fn(() => of(REPORT));
    TestBed.configureTestingModule({ providers: [{ provide: UsageApi, useValue: { report } }] });
  });

  const render = async () => {
    const fixture = TestBed.createComponent(UsagePage);
    await fixture.whenStable();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  };

  it('loads the last 7 days on open, and shows the totals', async () => {
    const { element } = await render();

    const range = report.mock.calls[0]?.[0] as { from: string; to: string };
    const days =
      (new Date(`${range.to}T00:00:00Z`).getTime() -
        new Date(`${range.from}T00:00:00Z`).getTime()) /
        86_400_000 +
      1;
    expect(days).toBe(7);
    const text = element.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain('$0.0125');
    expect(text).toContain('21,000');
    expect(text).toContain('25.0%');
    expect(text).toContain('8.3%');
    expect(text).toContain('Invalid output 1');
    expect(text).toContain('Includes $0.0025 estimated for 1 stream');
  });

  it('draws the chart with a text summary and a table of the same numbers', async () => {
    const { fixture, element } = await render();

    const svg = element.querySelector('svg[role="img"]');
    expect(svg?.getAttribute('aria-label')).toContain('Total $0.0125');
    expect(element.querySelector('.legend')?.textContent).toContain('Quiz generation (streamed)');

    const toggle = [...element.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Show as a table'),
    );
    toggle?.click();
    await fixture.whenStable();

    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    const rows = element.querySelectorAll('#cost-table tbody tr');
    // Every day of the reported range, 13 to 19 October.
    expect(rows).toHaveLength(7);
    expect(rows[6]?.textContent).toContain('$0.0125');
  });

  it('does not ask the API for a range whose start is after its end', async () => {
    const { fixture, element } = await render();
    report.mockClear();
    const from = element.querySelector<HTMLInputElement>('#usage-from');
    const to = element.querySelector<HTMLInputElement>('#usage-to');
    if (!from || !to) throw new Error('date inputs missing');
    from.value = '2026-10-20';
    from.dispatchEvent(new Event('input'));
    to.value = '2026-10-10';
    to.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    element.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    await fixture.whenStable();

    expect(report).not.toHaveBeenCalled();
    expect(element.querySelector('#usage-from-errors')?.textContent).toContain(
      'The start must not be after the end.',
    );
  });
});
