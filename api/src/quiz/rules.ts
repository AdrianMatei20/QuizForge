import type { GeneratedQuestion, GeneratedQuiz } from './quiz-output.schema.js';
import type { QuestionType, QuizSettings } from './quiz.types.js';

/**
 * Quality checks zod cannot express. Each rule is a pure function returning
 * one message per violation, naming the question by its 1-based number.
 * Messages go into the repair prompt and can reach clients in a 502, so they
 * describe the problem without quoting the model's text.
 *
 * Most rules look at one question at a time. Those are written as
 * QuestionChecks that take a label ("question 3"), so the same check serves
 * three uses: a whole generated quiz, a teacher's edit of one question, and
 * one regenerated question (see the rule lists at the end).
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

/** The fields a question check reads; a teacher's edit has the same shape. */
export type CheckedQuestion = Pick<
  GeneratedQuestion,
  'type' | 'stem' | 'options' | 'correctIndex' | 'sourceQuote'
>;

export type QuestionCheck = (
  question: CheckedQuestion,
  label: string,
  context: QuizRuleContext,
) => string[];

/**
 * One problem with one question. `field` locates it inside the question as a
 * JSON Pointer (e.g. "/options/3"), so a teacher's edit can show it next to
 * the right input.
 */
export interface QuestionViolation {
  detail: string;
  field?: string;
}

/** A question check that needs no lesson or settings, only the question itself. */
export type StandaloneCheck = (
  question: CheckedQuestion,
  label: string,
) => QuestionViolation[];

/** Generation and regeneration only need the messages (for the repair prompt). */
const messagesOf =
  (check: StandaloneCheck): QuestionCheck =>
  (question, label) =>
    check(question, label).map((violation) => violation.detail);

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

// Question checks.

/** Points at the repeated option, not the first one: that is the one to change. */
export const checkOptionsDistinct: StandaloneCheck = (question, label) => {
  const seen = new Map<string, number>();
  const violations: QuestionViolation[] = [];
  question.options.forEach((option, o) => {
    const key = normalizeText(option);
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, o);
    } else {
      violations.push({
        detail: `${label}: options ${number(first)} and ${number(o)} are identical`,
        field: `/options/${o}`,
      });
    }
  });
  return violations;
};

export const checkCorrectIndexInRange: StandaloneCheck = (question, label) =>
  question.correctIndex >= 0 && question.correctIndex < question.options.length
    ? []
    : [
        {
          detail: `${label}: correctIndex ${question.correctIndex} is out of range (must be 0 to ${question.options.length - 1})`,
          field: '/correctIndex',
        },
      ];

export const checkNoCatchAllOptions: StandaloneCheck = (question, label) =>
  question.options.flatMap((option, o) =>
    CATCH_ALL_OPTIONS.has(normalizeStem(option))
      ? [
          {
            detail: `${label}: option ${number(o)} is "all of the above" or "none of the above", which is not allowed`,
            field: `/options/${o}`,
          },
        ]
      : [],
  );

export const checkSourceQuoteInLesson: QuestionCheck = (
  question,
  label,
  { lessonContent },
) =>
  normalizeForQuote(lessonContent).includes(
    unwrapQuote(normalizeForQuote(question.sourceQuote)),
  )
    ? []
    : [`${label}: sourceQuote does not appear in the lesson`];

export const checkSourceQuoteLength: QuestionCheck = (
  question,
  label,
  { minQuoteWords },
) => {
  const words = countQuoteWords(question.sourceQuote);
  return words >= minQuoteWords
    ? []
    : [
        `${label}: sourceQuote has ${words} ${words === 1 ? 'word' : 'words'}; at least ${minQuoteWords} are required`,
      ];
};

export const checkTypeRequested: QuestionCheck = (
  question,
  label,
  { settings },
) =>
  settings.types.includes(question.type)
    ? []
    : [
        `${label}: type "${question.type}" was not requested (allowed: ${settings.types.join(', ')})`,
      ];

/** Runs a question check on every question of a quiz, labelled by number. */
function forEachQuestion(check: QuestionCheck): QuizRule {
  return (quiz, context) =>
    quiz.questions.flatMap((question, q) =>
      check(question, `question ${number(q)}`, context),
    );
}

// Quiz rules: what initial generation checks.

export const optionsAreDistinct = forEachQuestion(
  messagesOf(checkOptionsDistinct),
);
export const correctIndexInRange = forEachQuestion(
  messagesOf(checkCorrectIndexInRange),
);
export const noCatchAllOptions = forEachQuestion(
  messagesOf(checkNoCatchAllOptions),
);
export const sourceQuotesAppearInLesson = forEachQuestion(
  checkSourceQuoteInLesson,
);
export const sourceQuotesAreLongEnough = forEachQuestion(
  checkSourceQuoteLength,
);
export const typesAreRequested = forEachQuestion(checkTypeRequested);

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

export const questionCountMatches: QuizRule = (quiz, { settings }) =>
  quiz.questions.length === settings.count
    ? []
    : [`expected ${settings.count} questions, got ${quiz.questions.length}`];

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

/** Another question of the same quiz, for the "stem is new" checks. */
export interface OtherQuestion {
  position: number;
  stem: string;
}

function stemMatches(
  stem: string,
  others: readonly OtherQuestion[],
): OtherQuestion | undefined {
  const key = normalizeStem(stem);
  return others.find((other) => normalizeStem(other.stem) === key);
}

/**
 * A teacher's edit of one question. No sourceQuote rules: once a human has
 * edited a question, it no longer has to quote the lesson. No count or type
 * rules either, since an edit cannot change them.
 */
export const EDIT_CHECKS: readonly StandaloneCheck[] = [
  checkOptionsDistinct,
  checkCorrectIndexInRange,
  checkNoCatchAllOptions,
];

export function editedQuestionViolations(
  question: CheckedQuestion,
  position: number,
  others: readonly OtherQuestion[],
): QuestionViolation[] {
  const label = `question ${position}`;
  const duplicate = stemMatches(question.stem, others);
  return [
    ...EDIT_CHECKS.flatMap((check) => check(question, label)),
    ...(duplicate === undefined
      ? []
      : [
          {
            detail: `${label}: stem is the same as question ${duplicate.position}`,
            field: '/stem',
          },
        ]),
  ];
}

/**
 * One regenerated question: every per-question rule, the replaced question's
 * type, and a stem that is new compared with the replaced question and every
 * other question. Labelled "question" because the model wrote only one.
 */
export const REGENERATE_CHECKS: readonly QuestionCheck[] = [
  checkTypeRequested,
  messagesOf(checkOptionsDistinct),
  messagesOf(checkCorrectIndexInRange),
  messagesOf(checkNoCatchAllOptions),
  checkSourceQuoteLength,
  checkSourceQuoteInLesson,
];

export interface RegenerateRuleInput {
  lessonContent: string;
  settings: QuizSettings;
  minQuoteWords: number;
  /** The replacement must keep this type. */
  type: QuestionType;
  replacedStem: string;
  others: readonly OtherQuestion[];
}

export function regeneratedQuestionRules(
  input: RegenerateRuleInput,
): (question: CheckedQuestion) => string[] {
  const context: QuizRuleContext = {
    lessonContent: input.lessonContent,
    settings: { ...input.settings, types: [input.type] },
    minQuoteWords: input.minQuoteWords,
  };
  return (question) => {
    const label = 'question';
    const repeatsReplaced =
      normalizeStem(question.stem) === normalizeStem(input.replacedStem);
    const duplicate = stemMatches(question.stem, input.others);
    return [
      ...REGENERATE_CHECKS.flatMap((check) => check(question, label, context)),
      ...(repeatsReplaced
        ? [`${label}: stem is the same as the question it replaces`]
        : []),
      ...(duplicate === undefined
        ? []
        : [
            `${label}: stem is the same as question ${duplicate.position}, which is already in the quiz`,
          ]),
    ];
  };
}
