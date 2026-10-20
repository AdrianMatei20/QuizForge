import {
  CLEAN_LESSON,
  FAILED_LESSON,
  LESSONS,
  REPAIRED_LESSON,
} from '../../test/support/eval-report.js';
import {
  computeMetrics,
  isQuoteCopy,
  quotesOverlap,
  sharedQuoteFlags,
  sharesWordRun,
  summarizeFirstAnswer,
  words,
} from './eval-metrics.js';

describe('words', () => {
  it('lowercases and drops punctuation, keeping apostrophes inside words', () => {
    expect(words("Newton's first law: an object, at rest!")).toEqual([
      "newton's",
      'first',
      'law',
      'an',
      'object',
      'at',
      'rest',
    ]);
  });
});

describe('quote copy', () => {
  const quote = 'Every recursive function needs a base case to stop';

  it('flags a stem that shares 6 consecutive words with its quote', () => {
    expect(
      isQuoteCopy({
        stem: 'True or false: every recursive function needs a base case?',
        sourceQuote: quote,
      }),
    ).toBe(true);
  });

  it('does not flag 5 shared words, or the same words in another order', () => {
    expect(
      sharesWordRun('Does a recursive function needs a base?', quote),
    ).toBe(false);
    expect(
      isQuoteCopy({
        stem: 'Needs every function a recursive base case?',
        sourceQuote: quote,
      }),
    ).toBe(false);
  });

  it('ignores case and punctuation when matching', () => {
    expect(
      sharesWordRun('EVERY recursive function, needs a BASE case', quote),
    ).toBe(true);
  });
});

describe('shared quotes', () => {
  it('overlap when one quote contains the other, or they share 6 words', () => {
    expect(
      quotesOverlap('the base case', 'Every function needs the base case.'),
    ).toBe(true);
    expect(
      quotesOverlap(
        'each call moves closer to the base case of the function',
        'so every call moves closer to the base case and stops',
      ),
    ).toBe(true);
  });

  it('do not overlap on a few common words, or part of a word', () => {
    expect(quotesOverlap('the base case', 'the call stack')).toBe(false);
    expect(quotesOverlap('case', 'staircase')).toBe(false);
  });

  it('flags every question whose quote overlaps another one', () => {
    expect(
      sharedQuoteFlags([
        { sourceQuote: 'the base case stops the recursion' },
        { sourceQuote: 'a loop is often faster' },
        { sourceQuote: 'The base case stops the recursion.' },
      ]),
    ).toEqual([true, false, true]);
  });
});

describe('summarizeFirstAnswer', () => {
  const context = {
    lessonContent: 'A base case stops recursion. A loop is often faster.',
    settings: {
      count: 3,
      difficulty: 'easy' as const,
      types: ['true_false' as const],
    },
    minQuoteWords: 1,
  };
  const tf = (stem: string, sourceQuote: string) => ({
    type: 'true_false' as const,
    stem,
    options: ['True', 'False'] as ('True' | 'False')[],
    correctIndex: 0,
    explanation: 'e',
    sourceQuote,
  });

  it('counts quotes found in the lesson and repeated stems', () => {
    expect(
      summarizeFirstAnswer(
        {
          schemaValid: true,
          data: {
            questions: [
              tf('Stops?', 'A base case stops recursion.'),
              tf('stops ?', 'invented sentence'),
              tf('Faster?', 'A loop is often faster'),
            ],
          },
          violations: ['question 2: sourceQuote does not appear in the lesson'],
        },
        context,
      ),
    ).toEqual({
      schemaValid: true,
      rulesPassed: false,
      questions: 3,
      sourceQuoteFound: 2,
      duplicateStems: 1,
    });
  });

  it('has no questions when the schema failed', () => {
    expect(
      summarizeFirstAnswer(
        { schemaValid: false, violations: ['bad'] },
        context,
      ),
    ).toEqual({
      schemaValid: false,
      rulesPassed: false,
      questions: 0,
      sourceQuoteFound: 0,
      duplicateStems: 0,
    });
  });
});

describe('computeMetrics', () => {
  it('computes every rate over the right denominator', () => {
    const m = computeMetrics(LESSONS);

    expect(m).toMatchObject({
      lessons: 3,
      lessonsFailed: 1,
      // First answers: 2 of 3 matched the schema, 1 of 3 passed every rule, 2 of 3 needed repair.
      schemaValidRate: 2 / 3,
      rulePassBeforeRepairRate: 1 / 3,
      repairRate: 2 / 3,
      // First-answer questions: 3 + 4 + 0 = 7; quotes found 3 + 3, one repeated stem.
      sourceQuoteFoundRate: 6 / 7,
      duplicateStemRate: 1 / 7,
      // Final questions: 3 + 4 = 7; one quote copy, two sharing a quote.
      quoteCopyRate: 1 / 7,
      sharedQuoteRate: 2 / 7,
      questionsRequested: 12,
      questionsSaved: 7,
      questionsDropped: 5,
      // Judged: 6 of the 7 (one judge error).
      judged: 6,
      judgeErrors: 1,
      answerCorrectRate: 5 / 6,
      answerableFromLessonRate: 1,
      testsUnderstandingRate: 5 / 6,
    });
  });

  it('sums tokens, latency and cost exactly', () => {
    const m = computeMetrics(LESSONS);

    expect(m.generation).toEqual({
      calls: 3,
      inputTokens: 5_400,
      outputTokens: 3_000,
      costUsd: '0.002040',
      latencyMsTotal: 12_500,
      latencyMsMax: 6_500,
    });
    expect(m.judge).toEqual({
      calls: 7,
      inputTokens: 3_500,
      outputTokens: 350,
      costUsd: '0.010500',
      cacheHits: 1,
    });
    expect(m.totalCostUsd).toBe('0.012540');
  });

  it('gives null rates when there is nothing to divide by', () => {
    const m = computeMetrics([FAILED_LESSON]);

    expect(m.sourceQuoteFoundRate).toBeNull();
    expect(m.quoteCopyRate).toBeNull();
    expect(m.answerCorrectRate).toBeNull();
    expect(m.schemaValidRate).toBe(0);
    expect(m.questionsDropped).toBe(5);
  });

  it('leaves a lesson without any first answer (a provider error) out of the answer rates', () => {
    const m = computeMetrics([
      CLEAN_LESSON,
      {
        ...FAILED_LESSON,
        errorCode: 'provider_error',
        firstAnswer: null,
        repaired: false,
      },
    ]);

    expect(m.schemaValidRate).toBe(1);
    expect(m.repairRate).toBe(0);
    expect(m.lessonsFailed).toBe(1);
  });

  it('is the same for one lesson as for that lesson within a run', () => {
    expect(computeMetrics([REPAIRED_LESSON]).quoteCopyRate).toBe(1 / 4);
  });

  it('handles an empty run', () => {
    const m = computeMetrics([]);
    expect(m.lessons).toBe(0);
    expect(m.generation.latencyMsMax).toBe(0);
    expect(m.totalCostUsd).toBe('0.000000');
  });
});
