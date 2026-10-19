import {
  type ArgumentMetadata,
  HttpStatus,
  ParseUUIDPipe,
  ValidationPipe,
  type ValidationPipeOptions,
} from '@nestjs/common';
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
 * Where an invalid value came from. A JSON Pointer only makes sense for the
 * body; a query or path parameter is named in `parameter` instead (as in the
 * RFC 9457 examples), so clients never mistake "#/limit" for a body field.
 */
export type ValueLocation = 'body' | 'parameter';

/**
 * Flattens class-validator's nested error tree into one entry per broken
 * constraint: located by a JSON Pointer such as "#/questions/0/text" for the
 * body, or by name ("limit") for a parameter.
 */
export function toProblemFieldErrors(
  errors: ValidationError[],
  location: ValueLocation = 'body',
  parentPath: readonly string[] = [],
): ProblemFieldError[] {
  return errors.flatMap((error) => {
    const path = [...parentPath, error.property];
    const where =
      location === 'body'
        ? { pointer: jsonPointer(path) }
        : { parameter: path.join('.') };
    const own = Object.values(error.constraints ?? {}).map((detail) => ({
      ...where,
      detail,
    }));
    return [
      ...own,
      ...toProblemFieldErrors(error.children ?? [], location, path),
    ];
  });
}

export function validationProblem(
  errors: ProblemFieldError[],
): ProblemException {
  return new ProblemException({
    type: PROBLEM_TYPES.validation,
    title: 'Validation failed',
    status: HttpStatus.BAD_REQUEST,
    detail: 'The request contains invalid fields.',
    errors,
  });
}

/** class-validator's errors, before we know whether they came from the body or a parameter. */
class ClassValidationFailed extends Error {
  constructor(readonly errors: ValidationError[]) {
    super('Validation failed');
  }
}

/**
 * ValidationPipe that reports problems as validation problem details, located
 * by where the value came from. The plain exceptionFactory only receives the
 * errors, not whether they belong to the body, the query or the path, so the
 * factory throws them raw and transform(), which has that metadata, builds
 * the problem.
 */
export class ProblemValidationPipe extends ValidationPipe {
  constructor(options: Omit<ValidationPipeOptions, 'exceptionFactory'> = {}) {
    super({
      ...options,
      exceptionFactory: (errors) => new ClassValidationFailed(errors),
    });
  }

  override async transform(
    value: unknown,
    metadata: ArgumentMetadata,
  ): Promise<unknown> {
    try {
      return (await super.transform(value, metadata)) as unknown;
    } catch (error) {
      if (error instanceof ClassValidationFailed) {
        const location =
          metadata.type === 'query' || metadata.type === 'param'
            ? 'parameter'
            : 'body';
        throw validationProblem(toProblemFieldErrors(error.errors, location));
      }
      throw error;
    }
  }
}

/**
 * ParseUUIDPipe for one named path parameter, failing with a validation
 * problem that names it, instead of a bare 400 without `errors`.
 */
export function parseUuidParam(name: string): ParseUUIDPipe {
  return new ParseUUIDPipe({
    exceptionFactory: () =>
      validationProblem([
        { parameter: name, detail: `${name} must be a UUID` },
      ]),
  });
}
