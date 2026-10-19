/**
 * The API's limits and review rules, mirrored here so forms can check them
 * before a round trip. The API stays the authority: anything it rejects is
 * shown next to the matching field anyway.
 * (api/src/lessons/lesson-content.ts, api/src/quiz/update-question.dto.ts,
 * api/src/quiz/quiz.types.ts, api/src/quiz/rules.ts)
 */
export const LIMITS = {
  lessonTitleMax: 200,
  lessonContentMin: 200,
  lessonContentMax: 20_000,
  quizCountMin: 3,
  quizCountMax: 10,
  stemMax: 1_000,
  optionMax: 500,
  explanationMax: 2_000,
  multipleChoiceOptions: 4,
} as const;

export const TRUE_FALSE_OPTIONS = ['True', 'False'] as const;

/**
 * Length as the API counts it: Unicode code points of the trimmed text, so
 * an emoji counts as 1, not 2.
 */
export function textLength(text: string): number {
  // Splitting into code points is the point here.
  return [...text.trim()].length;
}

/** Lowercase, trim, collapse whitespace (rules.ts normalizeText). */
export function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** normalizeText without trailing punctuation, so "Why?" and "why" match (rules.ts normalizeStem). */
export function normalizeStem(text: string): string {
  return normalizeText(text).replace(/[\s.?!:;]+$/, '');
}

const CATCH_ALL_OPTIONS = new Set(['all of the above', 'none of the above']);

export function isCatchAllOption(option: string): boolean {
  return CATCH_ALL_OPTIONS.has(normalizeStem(option));
}
