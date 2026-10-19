import { invalidStatusTransitionProblem } from './review.problems.js';
import type { QuestionStatus } from './quiz.types.js';

/**
 * The review workflow: a draft is approved or rejected, and a decision can be
 * undone by moving the question back to draft. Approved and rejected never
 * switch directly, so changing a decision is always an explicit two-step act.
 */
const ALLOWED: Readonly<Record<QuestionStatus, readonly QuestionStatus[]>> = {
  draft: ['approved', 'rejected'],
  approved: ['draft'],
  rejected: ['draft'],
};

/** Whether `from -> to` is a real change the workflow allows. */
export function isAllowedTransition(
  from: QuestionStatus,
  to: QuestionStatus,
): boolean {
  return ALLOWED[from].includes(to);
}

/**
 * Throws a 409 problem for a change the workflow does not allow. Setting the
 * status a question already has is a no-op, not an error, so PATCH stays
 * idempotent and a form can always send its current status along.
 */
export function assertTransition(
  from: QuestionStatus,
  to: QuestionStatus,
): void {
  if (from !== to && !isAllowedTransition(from, to)) {
    throw invalidStatusTransitionProblem(from, to);
  }
}
