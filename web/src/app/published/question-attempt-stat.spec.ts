import { TestBed } from '@angular/core/testing';
import type { QuestionAttemptStats } from '../core/api/api.types';
import { QuestionAttemptStat } from './question-attempt-stat';

const stat = (overrides: Partial<QuestionAttemptStats>): QuestionAttemptStats => ({
  questionId: 'q1',
  position: 1,
  attempts: 18,
  correct: 13,
  percentCorrect: 13 / 18,
  flag: null,
  ...overrides,
});

describe('QuestionAttemptStat', () => {
  const render = async (value: QuestionAttemptStats) => {
    const fixture = TestBed.createComponent(QuestionAttemptStat);
    fixture.componentRef.setInput('stat', value);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    return { element, text: element.textContent?.replace(/\s+/g, ' ').trim() ?? '' };
  };

  it('shows the percent correct with its number of attempts', async () => {
    const { text, element } = await render(stat({}));

    expect(text).toBe('72% correct (18 attempts)');
    expect(element.querySelector('.badge')).toBeNull();
  });

  it.each([
    ['too_easy', 'Possibly too easy'],
    ['possibly_wrong', 'Possibly wrong or unclear'],
  ] as const)('labels the %s flag in words', async (flag, label) => {
    const { element } = await render(stat({ flag }));

    expect(element.querySelector('.badge')?.textContent).toContain(label);
  });

  it('shows a percentage below the minimum attempts, without a flag', async () => {
    const { text } = await render(stat({ attempts: 1, correct: 1, percentCorrect: 1 }));
    expect(text).toBe('100% correct (1 attempt)');
  });

  it('shows nothing before any attempt', async () => {
    const { text } = await render(stat({ attempts: 0, correct: 0, percentCorrect: null }));
    expect(text).toBe('');
  });
});
