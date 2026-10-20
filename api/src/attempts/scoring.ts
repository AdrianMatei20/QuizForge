import type { ProblemFieldError } from '../common/problem-details/problem-details.js';
import { jsonPointer } from '../common/problem-details/validation-problem.js';

/** What scoring needs from a published question. */
export interface ScoredQuestion {
  id: string;
  /** 1-based, the order the student sees. */
  position: number;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface SubmittedAnswer {
  questionId: string;
  selectedIndex: number;
}

export interface AnswerResult {
  questionId: string;
  selectedIndex: number;
  correct: boolean;
  correctIndex: number;
  explanation: string;
}

export type ScoreOutcome =
  | { ok: true; score: number; total: number; results: AnswerResult[] }
  | { ok: false; errors: ProblemFieldError[] };

/**
 * Scores a submitted attempt on the server, so a client can never claim its
 * own score. Every question must be answered exactly once, with an option
 * index that exists; otherwise every problem is reported, each located by a
 * JSON Pointer into the request body. Results come back in question order,
 * whatever order the answers were sent in.
 */
export function scoreAttempt(
  questions: ScoredQuestion[],
  answers: SubmittedAnswer[],
): ScoreOutcome {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const answered = new Map<string, SubmittedAnswer>();
  const errors: ProblemFieldError[] = [];

  answers.forEach((answer, i) => {
    const question = byId.get(answer.questionId);
    if (!question) {
      errors.push({
        pointer: jsonPointer(['answers', i, 'questionId']),
        detail: 'is not a question of this quiz',
      });
      return;
    }
    if (answered.has(answer.questionId)) {
      errors.push({
        pointer: jsonPointer(['answers', i, 'questionId']),
        detail: `answers question ${question.position} a second time`,
      });
      return;
    }
    answered.set(answer.questionId, answer);
    if (answer.selectedIndex >= question.options.length) {
      errors.push({
        pointer: jsonPointer(['answers', i, 'selectedIndex']),
        detail: `must be between 0 and ${question.options.length - 1} for question ${question.position}`,
      });
    }
  });

  const missing = questions.filter((question) => !answered.has(question.id));
  if (missing.length > 0) {
    const numbers = missing.map((question) => question.position).join(', ');
    errors.push({
      pointer: jsonPointer(['answers']),
      detail: `must answer every question; missing: question${missing.length === 1 ? '' : 's'} ${numbers}`,
    });
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const results = questions.map((question): AnswerResult => {
    const { selectedIndex } = answered.get(question.id) as SubmittedAnswer;
    return {
      questionId: question.id,
      selectedIndex,
      correct: selectedIndex === question.correctIndex,
      correctIndex: question.correctIndex,
      explanation: question.explanation,
    };
  });
  return {
    ok: true,
    score: results.filter((result) => result.correct).length,
    total: questions.length,
    results,
  };
}
