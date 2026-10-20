import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import type { AttemptStats, QuestionResponse, QuizResponse } from '../core/api/api.types';
import { QuizzesApi } from '../core/api/quizzes.api';
import { PublishedQuizPage } from './published-quiz.page';

const question = (id: string, stem: string): QuestionResponse => ({
  id,
  position: 1,
  type: 'multiple_choice',
  stem,
  options: ['A', 'B', 'C', 'D'],
  correctIndex: 0,
  explanation: 'Because.',
  sourceQuote: 'A quote from the lesson.',
  status: 'approved',
  editedAt: null,
  isEdited: false,
});

const QUIZ = {
  id: 'quiz-1',
  status: 'published',
  settings: { count: 2, difficulty: 'easy', types: ['multiple_choice'] },
  questions: [question('q1', 'First?'), question('q2', 'Second?')],
} as unknown as QuizResponse;

const stats = (overrides: Partial<AttemptStats>): AttemptStats => ({
  quizId: 'quiz-1',
  attempts: 6,
  averageScore: 0.5,
  thresholds: { tooEasyAbove: 0.9, possiblyWrongBelow: 0.2, minAttempts: 5 },
  questions: [
    { questionId: 'q1', position: 1, attempts: 6, correct: 6, percentCorrect: 1, flag: 'too_easy' },
    {
      questionId: 'q2',
      position: 2,
      attempts: 6,
      correct: 0,
      percentCorrect: 0,
      flag: 'possibly_wrong',
    },
  ],
  ...overrides,
});

describe('PublishedQuizPage', () => {
  const render = async (attemptStats: AttemptStats) => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: QuizzesApi,
          useValue: { get: () => of(QUIZ), attemptStats: vi.fn(() => of(attemptStats)) },
        },
      ],
    });
    const fixture = TestBed.createComponent(PublishedQuizPage);
    fixture.componentRef.setInput('id', 'quiz-1');
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };

  it('gives the student link to share', async () => {
    const element = await render(stats({}));

    expect(element.querySelector<HTMLInputElement>('#student-link')?.value).toMatch(/\/q\/quiz-1$/);
  });

  it('shows attempts, the average score, and each question with its percent correct and flag', async () => {
    const element = await render(stats({}));

    expect(element.querySelector('.attempts')?.textContent?.replace(/\s+/g, ' ')).toContain(
      '6 attempts · average score 50%',
    );
    const cards = element.querySelectorAll('.question-list > li');
    expect(cards[0]?.textContent).toContain('100% correct');
    expect(cards[0]?.textContent).toContain('Possibly too easy');
    expect(cards[1]?.textContent).toContain('0% correct');
    expect(cards[1]?.textContent).toContain('Possibly wrong or unclear');
  });

  it('says there are no attempts yet, and shows no stat lines', async () => {
    const element = await render(
      stats({
        attempts: 0,
        averageScore: null,
        questions: [
          {
            questionId: 'q1',
            position: 1,
            attempts: 0,
            correct: 0,
            percentCorrect: null,
            flag: null,
          },
          {
            questionId: 'q2',
            position: 2,
            attempts: 0,
            correct: 0,
            percentCorrect: null,
            flag: null,
          },
        ],
      }),
    );

    expect(element.querySelector('.attempts')?.textContent).toContain('No attempts yet');
    expect(element.querySelector('.stat')).toBeNull();
  });
});
