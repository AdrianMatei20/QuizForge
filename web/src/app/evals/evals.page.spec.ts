import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import type { EvalRunSummary } from '../core/api/api.types';
import { EvalsApi } from '../core/api/evals.api';
import { run } from './eval-runs.testing';
import { EvalsPage } from './evals.page';

describe('EvalsPage', () => {
  let list: ReturnType<typeof vi.fn>;

  const setUp = (items: EvalRunSummary[]) => {
    list = vi.fn(() => of({ items }));
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: EvalsApi, useValue: { list } }],
    });
  };

  const render = async () => {
    const fixture = TestBed.createComponent(EvalsPage);
    await fixture.whenStable();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  };

  it('lists runs with their headline metrics, hiding dry runs by default', async () => {
    setUp([run('newer', { promptVersion: 2, effort: 'low' }), run('older')]);
    const { element } = await render();

    expect(list).toHaveBeenCalledWith({ includeDryRuns: false });
    const rows = element.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    const text = rows[0]?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain('quiz v2 · claude-haiku-5-5');
    expect(text).toContain('effort low');
    expect(text).toContain('90%');
    expect(text).toContain('66.7%');
    expect(text).toContain('$0.4123');
  });

  it('asks for dry runs when the box is ticked, and marks them', async () => {
    setUp([run('dry', { dryRun: true })]);
    const { fixture, element } = await render();

    element.querySelector<HTMLInputElement>('.toolbar input[type="checkbox"]')?.click();
    await fixture.whenStable();

    expect(list).toHaveBeenLastCalledWith({ includeDryRuns: true });
    expect(element.querySelector('.badge')?.textContent).toContain('Dry run');
  });

  it('compares two selected runs, with the older one as the baseline', async () => {
    setUp([run('c-newest'), run('b-middle'), run('a-oldest')]);
    const { fixture, element } = await render();
    const checkbox = (id: string) => element.querySelector<HTMLInputElement>(`#select-${id}`);

    expect(element.querySelector('button[disabled]')?.textContent).toContain('Compare');
    checkbox('c-newest')?.click();
    checkbox('a-oldest')?.click();
    await fixture.whenStable();

    const link = element.querySelector<HTMLAnchorElement>('a.button');
    expect(link?.getAttribute('href')).toBe('/evals/compare?a=a-oldest&b=c-newest');

    // A third pick replaces the earliest one.
    checkbox('b-middle')?.click();
    await fixture.whenStable();
    expect(link?.getAttribute('href')).toBe('/evals/compare?a=a-oldest&b=b-middle');
  });

  it('explains how to make a run when there are none', async () => {
    setUp([]);
    const { element } = await render();

    expect(element.querySelector('.empty-state')?.textContent).toContain(
      'npm run eval -- --prompt v1',
    );
  });
});
