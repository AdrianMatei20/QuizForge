import { HttpStatus } from '@nestjs/common';
import {
  PROBLEM_TYPES,
  ProblemException,
  type ProblemFieldError,
} from '../common/problem-details/problem-details.js';
import type { QuestionStatus, QuizStatus } from './quiz.types.js';

/** The problems review actions can produce, in one place so their types stay consistent. */

const PREFIX = 'urn:quizforge:problem:';

export function quizPublishedProblem(quizId: string): ProblemException {
  return new ProblemException({
    type: `${PREFIX}quiz-published`,
    title: 'Quiz is published',
    status: HttpStatus.CONFLICT,
    detail: 'A published quiz and its questions can no longer be changed.',
    quizId,
  });
}

/** Generating and failed quizzes have no questions to review or publish. */
export function quizNotInReviewProblem(
  quizId: string,
  quizStatus: QuizStatus,
): ProblemException {
  return new ProblemException({
    type: `${PREFIX}quiz-not-in-review`,
    title: 'Quiz is not in review',
    status: HttpStatus.CONFLICT,
    detail: `Only a draft quiz can be published; this one is "${quizStatus}".`,
    quizId,
    quizStatus,
  });
}

export function invalidStatusTransitionProblem(
  from: QuestionStatus,
  to: QuestionStatus,
): ProblemException {
  return new ProblemException({
    type: `${PREFIX}invalid-status-transition`,
    title: 'Invalid status change',
    status: HttpStatus.CONFLICT,
    detail: `A question cannot go from "${from}" to "${to}". Move it back to "draft" first.`,
    from,
    to,
  });
}

export function noApprovedQuestionsProblem(quizId: string): ProblemException {
  return new ProblemException({
    type: `${PREFIX}no-approved-questions`,
    title: 'No approved questions',
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    detail: 'Approve at least one question before publishing the quiz.',
    quizId,
  });
}

/** Another request replaced (soft-deleted) the question first. */
export function questionAlreadyReplacedProblem(
  questionId: string,
): ProblemException {
  return new ProblemException({
    type: `${PREFIX}question-already-replaced`,
    title: 'Question already replaced',
    status: HttpStatus.CONFLICT,
    detail: 'This question was replaced by another request in the meantime.',
    questionId,
  });
}

/** An edit that breaks the question schema or the edit rules. */
export function questionRuleViolationsProblem(
  errors: ProblemFieldError[],
): ProblemException {
  return new ProblemException({
    type: PROBLEM_TYPES.validation,
    title: 'Validation failed',
    status: HttpStatus.BAD_REQUEST,
    detail: 'The edited question breaks the quiz rules.',
    errors,
  });
}

export function emptyQuestionUpdateProblem(): ProblemException {
  return new ProblemException({
    type: PROBLEM_TYPES.validation,
    title: 'Validation failed',
    status: HttpStatus.BAD_REQUEST,
    detail: 'The request contains invalid fields.',
    errors: [
      {
        detail:
          'send at least one of stem, options, correctIndex, explanation or status',
      },
    ],
  });
}
