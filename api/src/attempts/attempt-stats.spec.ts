import {
  type AttemptRecord,
  attemptStats,
  type FlagThresholds,
  flagFor,
} from './attempt-stats.js';

const THRESHOLDS: FlagThresholds = {
  tooEasyAbove: 0.9,
  possiblyWrongBelow: 0.2,
  minAttempts: 5,
};

describe('flagFor', () => {
  it.each([
    // [correct, attempts, flag]
    [10, 10, 'too_easy'],
    [19, 20, 'too_easy'], // 95%
    [9, 10, null], // exactly 90% is not above 90%
    [5, 10, null],
    [2, 10, null], // exactly 20% is not below 20%
    [1, 10, 'possibly_wrong'],
    [0, 5, 'possibly_wrong'],
  ] as [number, number, string | null][])(
    '%i of %i correct: %s',
    (correct, attempts, flag) => {
      expect(flagFor(correct, attempts, THRESHOLDS)).toBe(flag);
    },
  );

  it('never flags below the minimum number of attempts', () => {
    expect(flagFor(4, 4, THRESHOLDS)).toBeNull();
    expect(flagFor(0, 4, THRESHOLDS)).toBeNull();
    expect(flagFor(0, 0, THRESHOLDS)).toBeNull();
    expect(flagFor(5, 5, THRESHOLDS)).toBe('too_easy');
  });

  it('uses the configured thresholds', () => {
    const strict = {
      tooEasyAbove: 0.6,
      possiblyWrongBelow: 0.4,
      minAttempts: 1,
    };
    expect(flagFor(7, 10, strict)).toBe('too_easy');
    expect(flagFor(3, 10, strict)).toBe('possibly_wrong');
    expect(flagFor(5, 10, strict)).toBeNull();
  });
});

describe('attemptStats', () => {
  const questions = [
    { id: 'q1', position: 1 },
    { id: 'q2', position: 2 },
    { id: 'q3', position: 3 },
  ];
  /** An attempt with the given correctness per question (q1, q2, q3). */
  const attempt = (q1: boolean, q2: boolean, q3: boolean): AttemptRecord => ({
    score: [q1, q2, q3].filter(Boolean).length,
    answers: [
      { questionId: 'q1', correct: q1 },
      { questionId: 'q2', correct: q2 },
      { questionId: 'q3', correct: q3 },
    ],
  });

  it('computes percent correct, flags and the average score on fixed data', () => {
    // q1: always right; q2: right in 3 of 6; q3: never right.
    const attempts = [
      attempt(true, true, false),
      attempt(true, true, false),
      attempt(true, true, false),
      attempt(true, false, false),
      attempt(true, false, false),
      attempt(true, false, false),
    ];

    const stats = attemptStats(questions, attempts, THRESHOLDS);

    expect(stats.attempts).toBe(6);
    // Scores 2,2,2,1,1,1 of 3: mean (6 + 3) / 18 = 0.5.
    expect(stats.averageScore).toBe(0.5);
    expect(stats.questions).toEqual([
      {
        questionId: 'q1',
        position: 1,
        attempts: 6,
        correct: 6,
        percentCorrect: 1,
        flag: 'too_easy',
      },
      {
        questionId: 'q2',
        position: 2,
        attempts: 6,
        correct: 3,
        percentCorrect: 0.5,
        flag: null,
      },
      {
        questionId: 'q3',
        position: 3,
        attempts: 6,
        correct: 0,
        percentCorrect: 0,
        flag: 'possibly_wrong',
      },
    ]);
  });

  it('shows percentages below the minimum number of attempts, without flags', () => {
    const stats = attemptStats(
      questions,
      [attempt(true, false, false), attempt(true, false, true)],
      THRESHOLDS,
    );

    expect(stats.questions.map((q) => [q.percentCorrect, q.flag])).toEqual([
      [1, null],
      [0, null],
      [0.5, null],
    ]);
  });

  it('has nulls and no flags with no attempts', () => {
    const stats = attemptStats(questions, [], THRESHOLDS);

    expect(stats.attempts).toBe(0);
    expect(stats.averageScore).toBeNull();
    expect(
      stats.questions.every(
        (q) => q.percentCorrect === null && q.flag === null,
      ),
    ).toBe(true);
  });

  it('ignores answers to questions that are no longer in the quiz', () => {
    const stats = attemptStats(
      [{ id: 'q1', position: 1 }],
      [
        {
          score: 1,
          answers: [
            { questionId: 'gone', correct: true },
            { questionId: 'q1', correct: true },
          ],
        },
      ],
      THRESHOLDS,
    );
    expect(stats.questions).toHaveLength(1);
    expect(stats.questions[0]?.attempts).toBe(1);
  });
});
