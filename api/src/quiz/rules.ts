import type { GeneratedQuiz } from './quiz-output.schema.js';
import type { QuizSettings } from './quiz.types.js';

/**
 * Quality checks zod cannot express. Each rule is a pure function returning
 * one message per violation, naming the question by its 1-based number.
 * Messages go into the repair prompt and can reach clients in a 502, so they
 * describe the problem without quoting the model's text.
 */
export interface QuizRuleContext {
  lessonContent: string;
  settings: QuizSettings;
  /** QUIZ_SOURCE_QUOTE_MIN_WORDS: shorter quotes are too thin to check an answer against. */
  minQuoteWords: number;
}

export type QuizRule = (
  quiz: GeneratedQuiz,
  context: QuizRuleContext,
) => string[];

const CATCH_ALL_OPTIONS = new Set(['all of the above', 'none of the above']);

/** Lowercase, trim, collapse whitespace. */
export function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** normalizeText, then drop trailing punctuation, so "Why?" and "why" match. */
export function normalizeStem(text: string): string {
  return normalizeText(text).replace(/[\s.?!:;]+$/, '');
}

/**
 * Collapse whitespace and make quote characters straight, so a quote with
 * curly quotes or a line break still matches the lesson. Case is kept.
 */
export function normalizeForQuote(text: string): string {
  return text
    .replace(/[‘’‚‛′`]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Models sometimes wrap the quote in quotation marks; those are not part of it. */
function unwrapQuote(text: string): string {
  return text.replace(/^["']+|["']+$/g, '').trim();
}

const number = (index: number) => index + 1;

/**
 * Words in a quote after the same normalization as the lesson match. A word
 * is a whitespace-separated token with at least one letter or digit, so a
 * stray dash or ellipsis does not count, while "log2(n)" counts as one.
 */
export function countQuoteWords(quote: string): number {
  return unwrapQuote(normalizeForQuote(quote))
    .split(' ')
    .filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

export const optionsAreDistinct: QuizRule = (quiz) =>
  quiz.questions.flatMap((question, q) => {
    const seen = new Map<string, number>();
    const violations: string[] = [];
    question.options.forEach((option, o) => {
      const key = normalizeText(option);
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, o);
      } else {
        violations.push(
          `question ${number(q)}: options ${number(first)} and ${number(o)} are identical`,
        );
      }
    });
    return violations;
  });

export const correctIndexInRange: QuizRule = (quiz) =>
  quiz.questions.flatMap((question, q) =>
    question.correctIndex >= 0 &&
    question.correctIndex < question.options.length
      ? []
      : [
          `question ${number(q)}: correctIndex ${question.correctIndex} is out of range (must be 0 to ${question.options.length - 1})`,
        ],
  );

export const noCatchAllOptions: QuizRule = (quiz) =>
  quiz.questions.flatMap((question, q) =>
    question.options.flatMap((option, o) =>
      CATCH_ALL_OPTIONS.has(normalizeStem(option))
        ? [
            `question ${number(q)}: option ${number(o)} is "all of the above" or "none of the above", which is not allowed`,
          ]
        : [],
    ),
  );

export const stemsAreUnique: QuizRule = (quiz) => {
  const seen = new Map<string, number>();
  return quiz.questions.flatMap((question, q) => {
    const key = normalizeStem(question.stem);
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, q);
      return [];
    }
    return [
      `question ${number(q)}: stem is the same as question ${number(first)}`,
    ];
  });
};

export const sourceQuotesAppearInLesson: QuizRule = (
  quiz,
  { lessonContent },
) => {
  const lesson = normalizeForQuote(lessonContent);
  return quiz.questions.flatMap((question, q) =>
    lesson.includes(unwrapQuote(normalizeForQuote(question.sourceQuote)))
      ? []
      : [`question ${number(q)}: sourceQuote does not appear in the lesson`],
  );
};

export const sourceQuotesAreLongEnough: QuizRule = (quiz, { minQuoteWords }) =>
  quiz.questions.flatMap((question, q) => {
    const words = countQuoteWords(question.sourceQuote);
    return words >= minQuoteWords
      ? []
      : [
          `question ${number(q)}: sourceQuote has ${words} ${words === 1 ? 'word' : 'words'}; at least ${minQuoteWords} are required`,
        ];
  });

export const questionCountMatches: QuizRule = (quiz, { settings }) =>
  quiz.questions.length === settings.count
    ? []
    : [`expected ${settings.count} questions, got ${quiz.questions.length}`];

export const typesAreRequested: QuizRule = (quiz, { settings }) =>
  quiz.questions.flatMap((question, q) =>
    settings.types.includes(question.type)
      ? []
      : [
          `question ${number(q)}: type "${question.type}" was not requested (allowed: ${settings.types.join(', ')})`,
        ],
  );

export const QUIZ_RULES: readonly QuizRule[] = [
  questionCountMatches,
  typesAreRequested,
  optionsAreDistinct,
  correctIndexInRange,
  noCatchAllOptions,
  stemsAreUnique,
  sourceQuotesAreLongEnough,
  sourceQuotesAppearInLesson,
];

/** The rules callback for LlmService: every rule, in a stable order. */
export function quizRules(
  context: QuizRuleContext,
): (quiz: GeneratedQuiz) => string[] {
  return (quiz) => QUIZ_RULES.flatMap((rule) => rule(quiz, context));
}
