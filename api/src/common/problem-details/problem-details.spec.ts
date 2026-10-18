import {
  BadRequestException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { toProblemDetails } from './problem-details.filter.js';
import { PROBLEM_TYPES, ProblemException } from './problem-details.js';
import {
  toProblemFieldErrors,
  validationProblem,
} from './validation-problem.js';

function validationError(
  property: string,
  constraints?: Record<string, string>,
  children: ValidationError[] = [],
): ValidationError {
  return Object.assign(new ValidationError(), {
    property,
    constraints,
    children,
  });
}

describe('toProblemFieldErrors', () => {
  it('creates one entry per broken constraint', () => {
    const errors = toProblemFieldErrors([
      validationError('title', {
        isString: 'title must be a string',
        isNotEmpty: 'title should not be empty',
      }),
    ]);

    expect(errors).toEqual([
      { pointer: '#/title', detail: 'title must be a string' },
      { pointer: '#/title', detail: 'title should not be empty' },
    ]);
  });

  it('flattens nested errors into JSON pointers', () => {
    const errors = toProblemFieldErrors([
      validationError('questions', undefined, [
        validationError('0', undefined, [
          validationError('text', { isString: 'text must be a string' }),
        ]),
      ]),
    ]);

    expect(errors).toEqual([
      { pointer: '#/questions/0/text', detail: 'text must be a string' },
    ]);
  });

  it('escapes "~" and "/" in property names', () => {
    const errors = toProblemFieldErrors([
      validationError('a/b~c', { isString: 'bad' }),
    ]);

    expect(errors[0]?.pointer).toBe('#/a~1b~0c');
  });

  it('returns an empty list when there are no errors', () => {
    expect(toProblemFieldErrors([])).toEqual([]);
  });
});

describe('toProblemDetails', () => {
  const instance = '/api/things';

  it('uses a ProblemException as-is and adds the instance', () => {
    const problem = toProblemDetails(
      validationProblem([validationError('title', { isString: 'bad title' })]),
      instance,
    );

    expect(problem).toEqual({
      type: PROBLEM_TYPES.validation,
      title: 'Validation failed',
      status: 400,
      detail: 'The request contains invalid fields.',
      instance,
      errors: [{ pointer: '#/title', detail: 'bad title' }],
    });
  });

  it('keeps extension members of a ProblemException, even for 5xx', () => {
    const problem = toProblemDetails(
      new ProblemException({
        type: PROBLEM_TYPES.httpStatus,
        title: 'Service Unavailable',
        status: HttpStatus.SERVICE_UNAVAILABLE,
        detail: 'A dependency is down.',
        checks: { redis: { status: 'down' } },
      }),
      instance,
    );

    expect(problem.status).toBe(503);
    expect(problem.detail).toBe('A dependency is down.');
    expect(problem['checks']).toEqual({ redis: { status: 'down' } });
  });

  it('maps a 4xx HttpException to about:blank with its message as detail', () => {
    const problem = toProblemDetails(
      new NotFoundException('Quiz 42 was not found'),
      instance,
    );

    expect(problem).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'Quiz 42 was not found',
      instance,
    });
  });

  it('does not add an errors member to plain HTTP errors', () => {
    const problem = toProblemDetails(new BadRequestException('nope'), instance);

    expect(problem).not.toHaveProperty('errors');
  });

  it('hides the message of a 5xx HttpException', () => {
    const problem = toProblemDetails(
      new InternalServerErrorException('connection string leaked'),
      instance,
    );

    expect(problem.status).toBe(500);
    expect(problem.detail).not.toContain('leaked');
  });

  it('turns an unknown error into a generic 500 without leaking its message', () => {
    const problem = toProblemDetails(new Error('secret internals'), instance);

    expect(problem).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      detail: 'An unexpected error occurred. Please try again later.',
      instance,
    });
  });

  it('handles thrown values that are not errors', () => {
    expect(toProblemDetails('a string', instance).status).toBe(500);
  });
});
