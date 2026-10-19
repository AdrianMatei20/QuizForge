import type { LlmGenerateRequest } from '../llm/llm.service.js';
import { type GeneratedQuiz, quizOutputSchema } from './quiz-output.schema.js';
import type { QuizSettings } from './quiz.types.js';
import { quizRules } from './rules.js';

export const QUIZ_PROMPT = { id: 'quiz', version: 1 } as const;

// Room for 10 questions plus the thinking some models always do.
export const QUIZ_MAX_TOKENS = 8_192;

export interface QuizRequestInput {
  lessonContent: string;
  settings: QuizSettings;
  model: string;
  minQuoteWords: number;
  /** Recorded on the llm_calls row; QuizService passes the quiz id. */
  correlationId?: string;
}

/**
 * The LlmService request for one quiz: prompt, variables, schema and rules.
 * A pure function, so QuizService and the live quiz test send exactly the
 * same request.
 */
export function buildQuizRequest(
  input: QuizRequestInput,
): LlmGenerateRequest<GeneratedQuiz> {
  const { lessonContent, settings, model, minQuoteWords, correlationId } =
    input;
  return {
    feature: 'quiz-generation',
    promptId: QUIZ_PROMPT.id,
    promptVersion: QUIZ_PROMPT.version,
    variables: {
      count: settings.count,
      difficulty: settings.difficulty,
      types: settings.types.join(', '),
      lesson: lessonContent,
    },
    schema: quizOutputSchema,
    rules: quizRules({ lessonContent, settings, minQuoteWords }),
    model,
    maxTokens: QUIZ_MAX_TOKENS,
    // A teacher asking again wants new questions, not a cached copy.
    cache: false,
    ...(correlationId === undefined ? {} : { correlationId }),
  };
}
