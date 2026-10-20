import { computeMetrics } from '../../src/evals/eval-metrics.js';
import type {
  EvalQuestion,
  EvalReport,
  JudgeVerdict,
  LessonResult,
} from '../../src/evals/eval.types.js';

/** Fixed eval data for the metric, report and comparison tests: every number below is chosen by hand. */

export const PASS: JudgeVerdict = {
  answerCorrect: true,
  answerableFromLesson: true,
  testsUnderstanding: true,
  reason: 'Fine.',
};

export function question(
  number: number,
  overrides: Partial<EvalQuestion> = {},
): EvalQuestion {
  return {
    type: 'multiple_choice',
    stem: `Question ${number}?`,
    options: ['Right', 'Wrong one', 'Wrong two', 'Wrong three'],
    correctIndex: 0,
    explanation: 'Because the lesson says so.',
    sourceQuote: `quote number ${number} from the lesson`,
    number,
    quoteCopy: false,
    sharedQuote: false,
    verdict: PASS,
    ...overrides,
  } as EvalQuestion;
}

const NO_JUDGE = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: '0.000000',
  cacheHits: 0,
};

/** Valid at once: 3 questions, all fine. */
export const CLEAN_LESSON: LessonResult = {
  slug: '01-clean',
  title: 'Clean lesson',
  count: 3,
  difficulty: 'easy',
  status: 'ok',
  firstAnswer: {
    schemaValid: true,
    rulesPassed: true,
    questions: 3,
    sourceQuoteFound: 3,
    duplicateStems: 0,
  },
  repaired: false,
  questions: [question(1), question(2), question(3)],
  generation: {
    calls: 1,
    inputTokens: 1_000,
    outputTokens: 500,
    costUsd: '0.000350',
    latencyMs: 2_000,
  },
  judge: {
    calls: 3,
    inputTokens: 1_500,
    outputTokens: 150,
    costUsd: '0.004500',
    cacheHits: 1,
  },
};

/**
 * Repaired: the first answer had 4 questions, one quote not in the lesson
 * and one repeated stem. The final quiz has a quote copy, two questions
 * sharing a quote, a wrong answer, and one question the judge could not judge.
 */
export const REPAIRED_LESSON: LessonResult = {
  slug: '02-repaired',
  title: 'Repaired | lesson',
  count: 4,
  difficulty: 'hard',
  status: 'ok',
  firstAnswer: {
    schemaValid: true,
    rulesPassed: false,
    questions: 4,
    sourceQuoteFound: 3,
    duplicateStems: 1,
  },
  repaired: true,
  questions: [
    question(1, {
      stem: 'Which *two* words copy the quote: the base case stops the recursion?',
      sourceQuote: 'the base case stops the recursion',
      quoteCopy: true,
      verdict: {
        answerCorrect: true,
        answerableFromLesson: true,
        testsUnderstanding: false,
        reason: 'The stem repeats the lesson sentence word for word.',
      },
    }),
    question(2, {
      sharedQuote: true,
      verdict: {
        answerCorrect: false,
        answerableFromLesson: true,
        testsUnderstanding: true,
        reason: 'Option B is also correct according to the lesson.',
      },
    }),
    question(3, { sharedQuote: true }),
    question(4, { verdict: null, judgeError: 'timeout' }),
  ],
  generation: {
    calls: 1,
    inputTokens: 2_400,
    outputTokens: 1_600,
    costUsd: '0.001040',
    latencyMs: 6_500,
  },
  judge: {
    calls: 4,
    inputTokens: 2_000,
    outputTokens: 200,
    costUsd: '0.006000',
    cacheHits: 0,
  },
};

/** Failed after repair: nothing saved; the first answer did not even match the schema. */
export const FAILED_LESSON: LessonResult = {
  slug: '03-failed',
  title: 'Failed lesson',
  count: 5,
  difficulty: 'medium',
  status: 'failed',
  errorCode: 'invalid_output',
  firstAnswer: {
    schemaValid: false,
    rulesPassed: false,
    questions: 0,
    sourceQuoteFound: 0,
    duplicateStems: 0,
  },
  repaired: true,
  questions: [],
  generation: {
    calls: 1,
    inputTokens: 2_000,
    outputTokens: 900,
    costUsd: '0.000650',
    latencyMs: 4_000,
  },
  judge: NO_JUDGE,
};

export const LESSONS = [CLEAN_LESSON, REPAIRED_LESSON, FAILED_LESSON];

export function evalReport(
  lessons: LessonResult[] = LESSONS,
  overrides: Partial<EvalReport['run']> = {},
): EvalReport {
  return {
    run: {
      id: '0f1e2d3c-4b5a-4968-8776-655443322110',
      promptId: 'quiz',
      promptVersion: 2,
      model: 'claude-haiku-5-5',
      judgeModel: 'claude-sonnet-5-5',
      judgePromptVersion: 1,
      effort: 'low',
      dryRun: false,
      createdAt: '2026-10-19T15:15:00.000Z',
      ...overrides,
    },
    metrics: {
      overall: computeMetrics(lessons),
      lessons: lessons.map((lesson) => ({
        slug: lesson.slug,
        title: lesson.title,
        metrics: computeMetrics([lesson]),
      })),
    },
    lessons,
  };
}
