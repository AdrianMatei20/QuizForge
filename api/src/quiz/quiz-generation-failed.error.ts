import { HttpStatus } from '@nestjs/common';
import {
  GENERIC_SERVER_ERROR_DETAIL,
  isProblemConvertible,
  PROBLEM_TYPES,
  type ProblemConvertible,
  type ProblemResponse,
} from '../common/problem-details/problem-details.js';
import type { QuizFailureReason } from './quiz.types.js';

/**
 * Thrown by QuizService when generation fails after the quiz row exists, so
 * the client learns which quiz failed and can look it up. The response is
 * the original error's problem details (status, type, Retry-After and all)
 * plus a `quizId` extension member. An error with no problem details of its
 * own becomes the generic 500, still with `quizId`; it is logged by
 * QuizService, never returned.
 */
export class QuizGenerationFailedError
  extends Error
  implements ProblemConvertible
{
  override readonly name = 'QuizGenerationFailedError';

  constructor(
    readonly quizId: string,
    readonly reason: QuizFailureReason,
    options: { cause: unknown },
  ) {
    super(`Quiz ${quizId} generation failed: ${reason}`, options);
  }

  toProblem(): ProblemResponse {
    const original: ProblemResponse = isProblemConvertible(this.cause)
      ? this.cause.toProblem()
      : {
          problem: {
            type: PROBLEM_TYPES.httpStatus,
            title: 'Internal Server Error',
            status: HttpStatus.INTERNAL_SERVER_ERROR,
            detail: GENERIC_SERVER_ERROR_DETAIL,
          },
        };
    return {
      ...original,
      problem: { ...original.problem, quizId: this.quizId },
    };
  }
}
