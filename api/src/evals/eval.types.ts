import type { LlmEffort } from '../llm/llm-client.js';
import type { GeneratedQuestion } from '../quiz/quiz-output.schema.js';
import type { Difficulty } from '../quiz/quiz.types.js';

/** The judge's answer for one question (api/prompts/judge/v1.md). */
export interface JudgeVerdict {
  answerCorrect: boolean;
  answerableFromLesson: boolean;
  testsUnderstanding: boolean;
  reason: string;
}

/** Tokens and cost of a group of LLM calls. Cost is a decimal string, never a float. */
export interface CallCost {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: string;
}

/** The first answer, before any repair. Null when no answer arrived (e.g. a provider error). */
export interface FirstAnswer {
  schemaValid: boolean;
  /** Schema valid and no rule violations. */
  rulesPassed: boolean;
  /** Questions in it; 0 when the schema failed. */
  questions: number;
  /** Questions whose sourceQuote appears in the lesson. */
  sourceQuoteFound: number;
  /** Questions whose stem repeats an earlier question's stem. */
  duplicateStems: number;
}

// An intersection, not an interface: GeneratedQuestion is a union by type.
export type EvalQuestion = GeneratedQuestion & {
  /** 1-based, in the order the model wrote them. */
  number: number;
  /** The stem shares 6 or more consecutive words with its own sourceQuote. */
  quoteCopy: boolean;
  /** Its sourceQuote overlaps another question's quote in the same quiz. */
  sharedQuote: boolean;
  /** Null when the judge call failed; judgeError then says why (an error code). */
  verdict: JudgeVerdict | null;
  judgeError?: string;
};

export interface LessonResult {
  slug: string;
  title: string;
  count: number;
  difficulty: Difficulty;
  /** "ok" when a valid quiz came back, with or without repair. */
  status: 'ok' | 'failed';
  /** A quiz failure reason code (as in quizzes.failure_reason) when failed. */
  errorCode?: string;
  firstAnswer: FirstAnswer | null;
  repaired: boolean;
  /** The final quiz's questions; empty when the lesson failed. */
  questions: EvalQuestion[];
  generation: CallCost & { latencyMs: number };
  judge: CallCost & { cacheHits: number };
}

/** A share between 0 and 1, or null when there was nothing to divide by. */
export type Rate = number | null;

export interface EvalMetrics {
  lessons: number;
  lessonsFailed: number;
  schemaValidRate: Rate;
  rulePassBeforeRepairRate: Rate;
  repairRate: Rate;
  sourceQuoteFoundRate: Rate;
  duplicateStemRate: Rate;
  quoteCopyRate: Rate;
  sharedQuoteRate: Rate;
  questionsRequested: number;
  questionsSaved: number;
  questionsDropped: number;
  judged: number;
  judgeErrors: number;
  answerCorrectRate: Rate;
  answerableFromLessonRate: Rate;
  testsUnderstandingRate: Rate;
  generation: CallCost & { latencyMsTotal: number; latencyMsMax: number };
  judge: CallCost & { cacheHits: number };
  totalCostUsd: string;
}

export interface LessonMetrics {
  slug: string;
  title: string;
  metrics: EvalMetrics;
}

/** What eval_runs.metrics holds: numbers only, no question text. */
export interface EvalRunMetrics {
  overall: EvalMetrics;
  lessons: LessonMetrics[];
}

export interface EvalRunInfo {
  id: string;
  promptId: string;
  promptVersion: number;
  model: string;
  judgeModel: string;
  judgePromptVersion: number;
  effort: LlmEffort | null;
  dryRun: boolean;
  /** ISO timestamp. */
  createdAt: string;
}

/** The JSON report: everything the Markdown report shows, and every question with its verdict. */
export interface EvalReport {
  run: EvalRunInfo;
  metrics: EvalRunMetrics;
  lessons: LessonResult[];
}
