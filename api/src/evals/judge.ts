import { z } from 'zod';
import type { LlmGenerateRequest } from '../llm/llm.service.js';
import type { GeneratedQuestion } from '../quiz/quiz-output.schema.js';
import type { JudgeVerdict } from './eval.types.js';

export const JUDGE_PROMPT = { id: 'judge', version: 1 } as const;

// One verdict is short, but current models may think before answering.
export const JUDGE_MAX_TOKENS = 4_096;

export const judgeVerdictSchema = z.strictObject({
  answerCorrect: z.boolean(),
  answerableFromLesson: z.boolean(),
  testsUnderstanding: z.boolean(),
  reason: z.string().min(1).max(1_000),
});

const LETTERS = 'ABCDEFGHIJ';

/**
 * The question as the judge sees it: stem, lettered options and the marked
 * answer. Not the explanation or the sourceQuote: the judge has to find
 * support in the lesson itself rather than trust the generator's own claim.
 */
export function formatQuestionForJudge(
  question: Pick<GeneratedQuestion, 'stem' | 'options' | 'correctIndex'>,
): string {
  const options = question.options
    .map((option, i) => `${LETTERS[i] ?? i + 1}. ${option}`)
    .join('\n');
  const marked =
    LETTERS[question.correctIndex] ?? String(question.correctIndex + 1);
  return `Question: ${question.stem}\n\nOptions:\n${options}\n\nMarked answer: ${marked}`;
}

export interface JudgeRequestInput {
  lessonContent: string;
  question: Pick<GeneratedQuestion, 'stem' | 'options' | 'correctIndex'>;
  model: string;
  correlationId: string;
}

/**
 * Cached (the LlmService default): the same lesson and question get the
 * same verdict, so judging an unchanged question again costs nothing.
 */
export function buildJudgeRequest(
  input: JudgeRequestInput,
): LlmGenerateRequest<JudgeVerdict> {
  return {
    feature: 'eval-judge',
    promptId: JUDGE_PROMPT.id,
    promptVersion: JUDGE_PROMPT.version,
    variables: {
      lesson: input.lessonContent,
      question: formatQuestionForJudge(input.question),
    },
    schema: judgeVerdictSchema,
    model: input.model,
    maxTokens: JUDGE_MAX_TOKENS,
    correlationId: input.correlationId,
  };
}
