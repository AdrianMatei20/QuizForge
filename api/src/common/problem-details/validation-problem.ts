import { HttpStatus } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import {
  PROBLEM_TYPES,
  ProblemException,
  type ProblemFieldError,
} from './problem-details.js';

/** RFC 6901: "~" and "/" must be escaped inside a JSON Pointer segment. */
function escapePointerSegment(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

/** RFC 6901 pointer such as "#/questions/0/text" ("#" is the whole document). */
export function jsonPointer(path: readonly PropertyKey[]): string {
  return [
    '#',
    ...path.map((segment) => escapePointerSegment(String(segment))),
  ].join('/');
}

/**
 * Flattens class-validator's nested error tree into one entry per broken
 * constraint, each located by a JSON Pointer such as "#/questions/0/text".
 */
export function toProblemFieldErrors(
  errors: ValidationError[],
  parentPointer = '#',
): ProblemFieldError[] {
  return errors.flatMap((error) => {
    const pointer = `${parentPointer}/${escapePointerSegment(error.property)}`;
    const own = Object.values(error.constraints ?? {}).map((detail) => ({
      pointer,
      detail,
    }));
    return [...own, ...toProblemFieldErrors(error.children ?? [], pointer)];
  });
}

/** Used as the ValidationPipe exceptionFactory. */
export function validationProblem(errors: ValidationError[]): ProblemException {
  return new ProblemException({
    type: PROBLEM_TYPES.validation,
    title: 'Validation failed',
    status: HttpStatus.BAD_REQUEST,
    detail: 'The request contains invalid fields.',
    errors: toProblemFieldErrors(errors),
  });
}
