import type { LlmGenerateRequest } from '../llm/llm.service.js';
import {
  type GeneratedQuiz,
  quizOutputSchema,
  type RegeneratedQuestion,
  regeneratedQuestionSchema,
} from './quiz-output.schema.js';
import type { QuestionType, QuizSettings } from './quiz.types.js';
import {
  type OtherQuestion,
  quizRules,
  regeneratedQuestionRules,
} from './rules.js';

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

export const REGENERATE_PROMPT = { id: 'quiz-regenerate', version: 1 } as const;

// One question plus any thinking the model does first.
export const REGENERATE_MAX_TOKENS = 4_096;

export interface RegenerateRequestInput {
  lessonContent: string;
  settings: QuizSettings;
  model: string;
  minQuoteWords: number;
  /** The replaced question's type; the replacement keeps it. */
  type: QuestionType;
  replacedStem: string;
  /** The quiz's other current questions, by position. */
  others: readonly OtherQuestion[];
  /** The quiz id, so regenerations count toward the quiz's cost. */
  correlationId: string;
}

/**
 * The LlmService request for one replacement question. The stems are passed
 * as untrusted, delimited text: teachers may have edited them.
 */
export function buildRegenerateRequest(
  input: RegenerateRequestInput,
): LlmGenerateRequest<RegeneratedQuestion> {
  const checks = regeneratedQuestionRules(input);
  return {
    feature: 'quiz-regeneration',
    promptId: REGENERATE_PROMPT.id,
    promptVersion: REGENERATE_PROMPT.version,
    variables: {
      type: input.type,
      difficulty: input.settings.difficulty,
      lesson: input.lessonContent,
      replaced_question: input.replacedStem,
      other_questions:
        input.others.length === 0
          ? '(none)'
          : input.others.map((other) => `- ${other.stem}`).join('\n'),
    },
    schema: regeneratedQuestionSchema,
    rules: (data) => checks(data.question),
    model: input.model,
    maxTokens: REGENERATE_MAX_TOKENS,
    // "Regenerate" must always produce a new question.
    cache: false,
    correlationId: input.correlationId,
  };
}
