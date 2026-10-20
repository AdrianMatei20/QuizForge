/** Why a question stands out in the attempt stats; null when it does not. */
export type QuestionFlag = 'too_easy' | 'possibly_wrong';

export interface FlagThresholds {
  /** Flag as too easy when the share correct is above this (0 to 1). */
  tooEasyAbove: number;
  /** Flag as possibly wrong or unclear when the share correct is below this (0 to 1). */
  possiblyWrongBelow: number;
  /** Only flag a question once it has at least this many attempts. */
  minAttempts: number;
}

/** One stored attempt, as the stats need it. */
export interface AttemptRecord {
  score: number;
  answers: { questionId: string; correct: boolean }[];
}

export interface QuestionStats {
  questionId: string;
  position: number;
  attempts: number;
  correct: number;
  /** 0 to 1; null with no attempts. */
  percentCorrect: number | null;
  flag: QuestionFlag | null;
}

export interface AttemptStats {
  attempts: number;
  /** Mean of score / total over all attempts, 0 to 1; null with no attempts. */
  averageScore: number | null;
  questions: QuestionStats[];
}

/**
 * The flag for one question. Strictly above or below the thresholds, and
 * never before minAttempts: with one attempt every question is 0% or 100%.
 */
export function flagFor(
  correct: number,
  attempts: number,
  thresholds: FlagThresholds,
): QuestionFlag | null {
  if (attempts === 0 || attempts < thresholds.minAttempts) {
    return null;
  }
  const share = correct / attempts;
  if (share > thresholds.tooEasyAbove) {
    return 'too_easy';
  }
  if (share < thresholds.possiblyWrongBelow) {
    return 'possibly_wrong';
  }
  return null;
}

/** Per-question correctness and flags over a published quiz's attempts. */
export function attemptStats(
  questions: { id: string; position: number }[],
  attempts: AttemptRecord[],
  thresholds: FlagThresholds,
): AttemptStats {
  const tally = new Map(
    questions.map((question) => [question.id, { attempts: 0, correct: 0 }]),
  );
  for (const attempt of attempts) {
    for (const answer of attempt.answers) {
      const counts = tally.get(answer.questionId);
      if (counts) {
        counts.attempts++;
        counts.correct += answer.correct ? 1 : 0;
      }
    }
  }
  // Every attempt answers every question, so the mean of score / total is
  // all correct answers over all answers: one division, no rounding drift.
  const answers = attempts.length * questions.length;
  const correct = attempts.reduce((sum, attempt) => sum + attempt.score, 0);
  return {
    attempts: attempts.length,
    averageScore: answers === 0 ? null : correct / answers,
    questions: questions.map((question) => {
      const counts = tally.get(question.id) ?? { attempts: 0, correct: 0 };
      return {
        questionId: question.id,
        position: question.position,
        attempts: counts.attempts,
        correct: counts.correct,
        percentCorrect:
          counts.attempts === 0 ? null : counts.correct / counts.attempts,
        flag: flagFor(counts.correct, counts.attempts, thresholds),
      };
    }),
  };
}
