import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import type { ComparedMetric, EvalComparison } from '../core/api/api.types';
import { EvalsApi } from '../core/api/evals.api';
import { EvalComparePage } from './eval-compare.page';
import { run } from './eval-runs.testing';

const metric = (overrides: Partial<ComparedMetric>): ComparedMetric => ({
  key: 'quoteCopyRate',
  label: 'Quote copy',
  format: 'rate',
  direction: 'lower',
  a: 0.4,
  b: 0.1,
  delta: -30,
  verdict: 'better',
  ...overrides,
});

const COMPARISON: EvalComparison = {
  a: run('run-a'),
  b: run('run-b', { promptVersion: 2 }),
  metrics: [
    metric({}),
    metric({
      key: 'answerCorrectRate',
      label: 'Judge: answer correct',
      direction: 'higher',
      a: 1,
      b: 0.9,
      delta: -10,
      verdict: 'worse',
    }),
    metric({
      key: 'judgeCostUsd',
      label: 'Judge cost',
      format: 'usd',
      direction: 'neutral',
      a: '0.300000',
      b: '0.250000',
      delta: '-0.050000',
      verdict: 'n/a',
    }),
  ],
};

describe('EvalComparePage', () => {
  let compare: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    compare = vi.fn(() => of(COMPARISON));
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: EvalsApi, useValue: { compare } }],
    });
  });

  const render = async (a?: string, b?: string) => {
    const fixture = TestBed.createComponent(EvalComparePage);
    if (a) fixture.componentRef.setInput('a', a);
    if (b) fixture.componentRef.setInput('b', b);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };

  it('shows A, B, the change and a worded verdict for every metric', async () => {
    const element = await render('run-a', 'run-b');

    expect(compare).toHaveBeenCalledWith('run-a', 'run-b');
    const rows = [...element.querySelectorAll('tbody tr')].map((row) =>
      [...row.children].map((cell) => cell.textContent?.trim()),
    );
    expect(rows).toEqual([
      ['Quote copy', '40%', '10%', '−30.0 pp', 'better'],
      ['Judge: answer correct', '100%', '90%', '−10.0 pp', 'worse'],
      ['Judge cost', '$0.3000', '$0.2500', '−$0.0500', ''],
    ]);
    expect(element.querySelector('dl')?.textContent).toContain('quiz v2');
  });

  it('asks for two runs when the URL names fewer', async () => {
    const element = await render('run-a');

    expect(compare).not.toHaveBeenCalled();
    expect(element.querySelector('.notice')?.textContent).toContain('Choose two runs');
  });
});
