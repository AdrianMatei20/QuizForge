import type { LlmValidationCheck } from '../llm/llm.service.js';
import { formatUsd, parseUsd } from '../llm/money.js';
import type {
  GeneratedQuestion,
  GeneratedQuiz,
} from '../quiz/quiz-output.schema.js';
import {
  checkSourceQuoteInLesson,
  normalizeStem,
  type QuizRuleContext,
} from '../quiz/rules.js';
import type {
  CallCost,
  EvalMetrics,
  FirstAnswer,
  LessonResult,
  Rate,
} from './eval.types.js';

/** How many consecutive shared words count as copying (quote-copy) or overlapping (shared-quote). */
export const COPY_RUN_WORDS = 6;

/**
 * Lowercase words, without punctuation, so "Base case," and "base case"
 * match. Letters and digits in any script count as word characters.
 */
export function words(text: string): string[] {
  return (
    text.toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? []
  );
}

/** Every run of `size` consecutive words, joined by spaces. */
function wordRuns(tokens: string[], size: number): Set<string> {
  const runs = new Set<string>();
  for (let i = 0; i + size <= tokens.length; i++) {
    runs.add(tokens.slice(i, i + size).join(' '));
  }
  return runs;
}

/** True when the two texts share at least `size` consecutive words. */
export function sharesWordRun(
  a: string,
  b: string,
  size = COPY_RUN_WORDS,
): boolean {
  const runsOfA = wordRuns(words(a), size);
  for (const run of wordRuns(words(b), size)) {
    if (runsOfA.has(run)) {
      return true;
    }
  }
  return false;
}

/** The stem copies its own quote: a student can find the answer by matching words. */
export function isQuoteCopy(
  question: Pick<GeneratedQuestion, 'stem' | 'sourceQuote'>,
): boolean {
  return sharesWordRun(question.stem, question.sourceQuote);
}

/**
 * Two quotes overlap when they share a run of COPY_RUN_WORDS words, or when
 * one (shorter) quote appears whole inside the other.
 */
export function quotesOverlap(a: string, b: string): boolean {
  const wordsA = words(a).join(' ');
  const wordsB = words(b).join(' ');
  if (wordsA === '' || wordsB === '') {
    return false;
  }
  return (
    ` ${wordsA} `.includes(` ${wordsB} `) ||
    ` ${wordsB} `.includes(` ${wordsA} `) ||
    sharesWordRun(a, b)
  );
}

/** For each question: does its quote overlap any other question's quote in the same quiz? */
export function sharedQuoteFlags(
  questions: Pick<GeneratedQuestion, 'sourceQuote'>[],
): boolean[] {
  return questions.map((question, i) =>
    questions.some(
      (other, j) =>
        j !== i && quotesOverlap(question.sourceQuote, other.sourceQuote),
    ),
  );
}

/**
 * What the first answer looked like, from LlmService's onValidation check:
 * the same sourceQuote check the quiz rules use, and repeated stems by the
 * same normalisation as the duplicate-stem rule.
 */
export function summarizeFirstAnswer(
  check: Pick<
    LlmValidationCheck<GeneratedQuiz>,
    'schemaValid' | 'data' | 'violations'
  >,
  context: QuizRuleContext,
): FirstAnswer {
  const questions = check.schemaValid ? (check.data?.questions ?? []) : [];
  const seen = new Set<string>();
  let duplicateStems = 0;
  for (const question of questions) {
    const stem = normalizeStem(question.stem);
    if (seen.has(stem)) {
      duplicateStems++;
    }
    seen.add(stem);
  }
  return {
    schemaValid: check.schemaValid,
    rulesPassed: check.schemaValid && check.violations.length === 0,
    questions: questions.length,
    sourceQuoteFound: count(
      questions,
      (question) =>
        checkSourceQuoteInLesson(question, '', context).length === 0,
    ),
    duplicateStems,
  };
}

function rate(part: number, whole: number): Rate {
  return whole === 0 ? null : part / whole;
}

function count<T>(items: T[], predicate: (item: T) => boolean): number {
  return items.filter(predicate).length;
}

function sumCost(costs: CallCost[]): CallCost {
  return {
    calls: costs.reduce((sum, cost) => sum + cost.calls, 0),
    inputTokens: costs.reduce((sum, cost) => sum + cost.inputTokens, 0),
    outputTokens: costs.reduce((sum, cost) => sum + cost.outputTokens, 0),
    // Exact: summed as integer micro-dollars, like every other cost here.
    costUsd: formatUsd(
      costs.reduce((sum, cost) => sum + parseUsd(cost.costUsd), 0n),
    ),
  };
}

/**
 * The metrics over a set of lessons: a whole run, or one lesson (pass a
 * one-element array). See the README's Evals section for what each means.
 *
 * - Lesson-level rates (schema-valid, rule-pass before repair, repair) are
 *   over the lessons where a first answer arrived.
 * - sourceQuote-found and duplicate-stem are over the first answers'
 *   questions: after repair they are 100% by construction, because the
 *   rules enforce them.
 * - quote-copy, shared-quote and the judge rates are over the final
 *   questions (the judge rates only over questions the judge answered).
 */
export function computeMetrics(lessons: LessonResult[]): EvalMetrics {
  const answered = lessons.flatMap((lesson) =>
    lesson.firstAnswer ? [lesson.firstAnswer] : [],
  );
  const firstQuestions = answered.reduce(
    (sum, answer) => sum + answer.questions,
    0,
  );
  const finalQuestions = lessons.flatMap((lesson) => lesson.questions);
  const verdicts = finalQuestions.flatMap((question) =>
    question.verdict ? [question.verdict] : [],
  );
  const questionsRequested = lessons.reduce(
    (sum, lesson) => sum + lesson.count,
    0,
  );
  const generation = sumCost(lessons.map((lesson) => lesson.generation));
  const judge = sumCost(lessons.map((lesson) => lesson.judge));

  return {
    lessons: lessons.length,
    lessonsFailed: count(lessons, (lesson) => lesson.status === 'failed'),
    schemaValidRate: rate(
      count(answered, (answer) => answer.schemaValid),
      answered.length,
    ),
    rulePassBeforeRepairRate: rate(
      count(answered, (answer) => answer.rulesPassed),
      answered.length,
    ),
    repairRate: rate(
      count(lessons, (lesson) => lesson.repaired),
      answered.length,
    ),
    sourceQuoteFoundRate: rate(
      answered.reduce((sum, answer) => sum + answer.sourceQuoteFound, 0),
      firstQuestions,
    ),
    duplicateStemRate: rate(
      answered.reduce((sum, answer) => sum + answer.duplicateStems, 0),
      firstQuestions,
    ),
    quoteCopyRate: rate(
      count(finalQuestions, (question) => question.quoteCopy),
      finalQuestions.length,
    ),
    sharedQuoteRate: rate(
      count(finalQuestions, (question) => question.sharedQuote),
      finalQuestions.length,
    ),
    questionsRequested,
    questionsSaved: finalQuestions.length,
    questionsDropped: questionsRequested - finalQuestions.length,
    judged: verdicts.length,
    judgeErrors: count(finalQuestions, (question) => question.verdict === null),
    answerCorrectRate: rate(
      count(verdicts, (verdict) => verdict.answerCorrect),
      verdicts.length,
    ),
    answerableFromLessonRate: rate(
      count(verdicts, (verdict) => verdict.answerableFromLesson),
      verdicts.length,
    ),
    testsUnderstandingRate: rate(
      count(verdicts, (verdict) => verdict.testsUnderstanding),
      verdicts.length,
    ),
    generation: {
      ...generation,
      latencyMsTotal: lessons.reduce(
        (sum, lesson) => sum + lesson.generation.latencyMs,
        0,
      ),
      latencyMsMax: Math.max(
        0,
        ...lessons.map((lesson) => lesson.generation.latencyMs),
      ),
    },
    judge: {
      ...judge,
      cacheHits: lessons.reduce(
        (sum, lesson) => sum + lesson.judge.cacheHits,
        0,
      ),
    },
    totalCostUsd: formatUsd(
      parseUsd(generation.costUsd) + parseUsd(judge.costUsd),
    ),
  };
}
