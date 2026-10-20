import { type ScoredQuestion, scoreAttempt } from './scoring.js';

const Q1 = '11111111-1111-4111-8111-111111111111';
const Q2 = '22222222-2222-4222-8222-222222222222';
const Q3 = '33333333-3333-4333-8333-333333333333';
const OTHER = '99999999-9999-4999-8999-999999999999';

const QUESTIONS: ScoredQuestion[] = [
  {
    id: Q1,
    position: 1,
    options: ['A', 'B', 'C', 'D'],
    correctIndex: 2,
    explanation: 'Because C.',
  },
  {
    id: Q2,
    position: 2,
    options: ['True', 'False'],
    correctIndex: 0,
    explanation: 'It is true.',
  },
  {
    id: Q3,
    position: 3,
    options: ['A', 'B', 'C', 'D'],
    correctIndex: 1,
    explanation: 'Because B.',
  },
];

describe('scoreAttempt', () => {
  it('scores every answer and returns results in question order, whatever the answer order', () => {
    const outcome = scoreAttempt(QUESTIONS, [
      { questionId: Q3, selectedIndex: 0 },
      { questionId: Q1, selectedIndex: 2 },
      { questionId: Q2, selectedIndex: 0 },
    ]);

    expect(outcome).toEqual({
      ok: true,
      score: 2,
      total: 3,
      results: [
        {
          questionId: Q1,
          selectedIndex: 2,
          correct: true,
          correctIndex: 2,
          explanation: 'Because C.',
        },
        {
          questionId: Q2,
          selectedIndex: 0,
          correct: true,
          correctIndex: 0,
          explanation: 'It is true.',
        },
        {
          questionId: Q3,
          selectedIndex: 0,
          correct: false,
          correctIndex: 1,
          explanation: 'Because B.',
        },
      ],
    });
  });

  it('scores 0 when every answer is wrong', () => {
    const outcome = scoreAttempt(QUESTIONS, [
      { questionId: Q1, selectedIndex: 0 },
      { questionId: Q2, selectedIndex: 1 },
      { questionId: Q3, selectedIndex: 3 },
    ]);
    expect(outcome).toMatchObject({ ok: true, score: 0, total: 3 });
  });

  it('rejects a missing answer, naming the unanswered question', () => {
    const outcome = scoreAttempt(QUESTIONS, [
      { questionId: Q1, selectedIndex: 2 },
      { questionId: Q3, selectedIndex: 1 },
    ]);

    expect(outcome).toEqual({
      ok: false,
      errors: [
        {
          pointer: '#/answers',
          detail: 'must answer every question; missing: question 2',
        },
      ],
    });
  });

  it('rejects a duplicated answer, pointing at the second one', () => {
    const outcome = scoreAttempt(QUESTIONS, [
      { questionId: Q1, selectedIndex: 2 },
      { questionId: Q2, selectedIndex: 0 },
      { questionId: Q1, selectedIndex: 1 },
      { questionId: Q3, selectedIndex: 1 },
    ]);

    expect(outcome).toEqual({
      ok: false,
      errors: [
        {
          pointer: '#/answers/2/questionId',
          detail: 'answers question 1 a second time',
        },
      ],
    });
  });

  it('rejects a question from elsewhere and an option index that does not exist, all at once', () => {
    const outcome = scoreAttempt(QUESTIONS, [
      { questionId: Q1, selectedIndex: 2 },
      { questionId: Q2, selectedIndex: 2 },
      { questionId: OTHER, selectedIndex: 0 },
    ]);

    expect(outcome).toEqual({
      ok: false,
      errors: [
        {
          pointer: '#/answers/1/selectedIndex',
          detail: 'must be between 0 and 1 for question 2',
        },
        {
          pointer: '#/answers/2/questionId',
          detail: 'is not a question of this quiz',
        },
        {
          pointer: '#/answers',
          detail: 'must answer every question; missing: question 3',
        },
      ],
    });
  });

  it('rejects an empty attempt, listing every question', () => {
    expect(scoreAttempt(QUESTIONS, [])).toEqual({
      ok: false,
      errors: [
        {
          pointer: '#/answers',
          detail: 'must answer every question; missing: questions 1, 2, 3',
        },
      ],
    });
  });
});
