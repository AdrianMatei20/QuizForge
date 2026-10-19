import type { GeneratedQuestion } from './quiz-output.schema.js';
import type { QuestionStatus } from './quiz.types.js';
import { normalizeText } from './rules.js';

/** What the stats read from a question row. */
export interface ReviewedQuestion {
  status: QuestionStatus;
  stem: string;
  options: readonly string[];
  correctIndex: number;
  explanation: string;
  /** The model's raw output, in the model's own option order. */
  original: Pick<
    GeneratedQuestion,
    'stem' | 'options' | 'correctIndex' | 'explanation'
  >;
}

const sortedOptions = (options: readonly string[]) =>
  options.map(normalizeText).sort();

const correctAnswer = (options: readonly string[], index: number) =>
  normalizeText(options[index] ?? '');

/**
 * Whether a teacher changed what the question says, compared with the
 * model's original. Normalized text (case and whitespace do not count),
 * options compared as a set, and the correct answer compared by its text,
 * not its index: options are shuffled before saving, and a teacher who only
 * reorders options has not changed the question.
 */
export function contentDiffers(question: ReviewedQuestion): boolean {
  const { original } = question;
  const sameOptions =
    JSON.stringify(sortedOptions(question.options)) ===
    JSON.stringify(sortedOptions(original.options));
  return (
    normalizeText(question.stem) !== normalizeText(original.stem) ||
    normalizeText(question.explanation) !==
      normalizeText(original.explanation) ||
    !sameOptions ||
    correctAnswer(question.options, question.correctIndex) !==
      correctAnswer(original.options, original.correctIndex)
  );
}

export interface ReviewStats {
  /** Current (not soft-deleted) questions. */
  total: number;
  byStatus: Record<QuestionStatus, number>;
  /** Questions replaced through regenerate (soft-deleted). */
  regenerated: number;
  /** Approved questions whose content differs from the original, / approved. */
  editRate: number | null;
  /** rejected / (approved + rejected). Drafts are undecided, so not counted. */
  rejectRate: number | null;
  /**
   * (rejected + regenerated) / (approved + rejected + regenerated): how often
   * the model's question was not good enough, whichever way the teacher
   * discarded it.
   */
  missRate: number | null;
}

/** A ratio, or null when there is nothing to divide by (0 would read as a perfect score). */
function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function computeReviewStats(
  current: readonly ReviewedQuestion[],
  regenerated: number,
): ReviewStats {
  const byStatus: Record<QuestionStatus, number> = {
    draft: 0,
    approved: 0,
    rejected: 0,
  };
  for (const question of current) {
    byStatus[question.status]++;
  }
  const editedApproved = current.filter(
    (question) => question.status === 'approved' && contentDiffers(question),
  ).length;
  const { approved, rejected } = byStatus;

  return {
    total: current.length,
    byStatus,
    regenerated,
    editRate: rate(editedApproved, approved),
    rejectRate: rate(rejected, approved + rejected),
    missRate: rate(rejected + regenerated, approved + rejected + regenerated),
  };
}
