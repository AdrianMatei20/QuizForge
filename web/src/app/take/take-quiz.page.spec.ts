import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import type { AttemptResult, PublicQuiz } from '../core/api/api.types';
import { PublicQuizzesApi } from '../core/api/public-quizzes.api';
import { toAppError } from '../core/errors/app-error';
import { TakeQuizPage } from './take-quiz.page';

const QUIZ: PublicQuiz = {
  id: 'quiz-1',
  lessonTitle: 'Recursion',
  questions: [
    {
      id: 'q1',
      position: 1,
      type: 'multiple_choice',
      stem: 'What stops a recursive function?',
      options: ['A loop', 'The base case', 'The call stack', 'A timeout'],
    },
    {
      id: 'q2',
      position: 2,
      type: 'true_false',
      stem: 'Recursion is always faster than a loop.',
      options: ['True', 'False'],
    },
  ],
};

const RESULT: AttemptResult = {
  attemptId: 'attempt-1',
  score: 1,
  total: 2,
  results: [
    {
      questionId: 'q1',
      selectedIndex: 1,
      correct: true,
      correctIndex: 1,
      explanation: 'The base case returns without calling itself.',
    },
    {
      questionId: 'q2',
      selectedIndex: 0,
      correct: false,
      correctIndex: 1,
      explanation: 'A loop is often faster.',
    },
  ],
};

describe('TakeQuizPage', () => {
  let submitAttempt: ReturnType<typeof vi.fn>;

  const setUp = (get: () => unknown = () => of(QUIZ)) => {
    submitAttempt = vi.fn(() => of(RESULT));
    TestBed.configureTestingModule({
      providers: [{ provide: PublicQuizzesApi, useValue: { get, submitAttempt } }],
    });
  };

  const render = async () => {
    const fixture = TestBed.createComponent(TakeQuizPage);
    fixture.componentRef.setInput('id', 'quiz-1');
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const button = (name: string) =>
      [...element.querySelectorAll('button')].find((b) => b.textContent?.includes(name));
    const choose = async (optionText: string) => {
      const label = [...element.querySelectorAll('label.option')].find((l) =>
        l.textContent?.includes(optionText),
      );
      label?.querySelector('input')?.click();
      await fixture.whenStable();
    };
    const click = async (name: string) => {
      button(name)?.click();
      await fixture.whenStable();
    };
    return { fixture, element, button, choose, click };
  };

  it('shows one question at a time with its progress', async () => {
    setUp();
    const { element, button, click } = await render();

    expect(element.querySelector('.progress-label')?.textContent).toContain('Question 1 of 2');
    expect(element.querySelector('progress')?.getAttribute('max')).toBe('2');
    expect(element.querySelector('legend')?.textContent).toContain(
      'What stops a recursive function?',
    );
    expect(element.querySelectorAll('input[type="radio"]')).toHaveLength(4);
    expect(button('Back')?.disabled).toBe(true);

    await click('Next');

    expect(element.querySelector('.progress-label')?.textContent).toContain('Question 2 of 2');
    expect(element.querySelector('legend')?.textContent).toContain('always faster');
  });

  it('keeps answers when moving back, and only submits once every question is answered', async () => {
    setUp();
    const { element, button, choose, click } = await render();

    await choose('The base case');
    await click('Next');
    expect(button('Submit answers')?.disabled).toBe(true);
    expect(element.querySelector('#unanswered-hint')?.textContent).toContain('question 2');

    await click('Back');
    expect(element.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.value).toBe('1');

    await click('Next');
    await choose('True');
    expect(button('Submit answers')?.disabled).toBe(false);
    await click('Submit answers');

    expect(submitAttempt).toHaveBeenCalledWith('quiz-1', {
      answers: [
        { questionId: 'q1', selectedIndex: 1 },
        { questionId: 'q2', selectedIndex: 0 },
      ],
    });
  });

  it('shows the score and, per question, the verdict, the correct answer and the explanation', async () => {
    setUp();
    const { element, choose, click } = await render();
    await choose('The base case');
    await click('Next');
    await choose('True');
    await click('Submit answers');

    expect(element.querySelector('h1')?.textContent).toContain('You scored 1 of 2 (50%)');
    const cards = element.querySelectorAll('.results li');
    expect(cards[0]?.textContent).toContain('Correct');
    expect(cards[0]?.textContent).toContain('The base case returns without calling itself.');
    expect(cards[1]?.textContent).toContain('Incorrect');
    expect(cards[1]?.textContent?.replace(/\s+/g, ' ')).toContain('Correct answer B. False');
    expect(cards[1]?.textContent).toContain('A loop is often faster.');
  });

  it('says the quiz is not available when it is not published', async () => {
    setUp(() =>
      throwError(() => toAppError(new HttpErrorResponse({ status: 404, statusText: 'Not Found' }))),
    );
    const { element } = await render();

    expect(element.querySelector('h1')?.textContent).toContain("This quiz isn't available");
    expect(element.querySelector('form')).toBeNull();
  });
});
