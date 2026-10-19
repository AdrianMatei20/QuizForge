import {
  BadRequestException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { IsInt, Max, ValidationError } from 'class-validator';
import { toProblemDetails } from './problem-details.filter.js';
import { PROBLEM_TYPES, ProblemException } from './problem-details.js';
import {
  parseUuidParam,
  ProblemValidationPipe,
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

  it('names query and path parameters instead of giving them body pointers', () => {
    const errors = toProblemFieldErrors(
      [validationError('limit', { max: 'limit must not be greater than 100' })],
      'parameter',
    );

    expect(errors).toEqual([
      { parameter: 'limit', detail: 'limit must not be greater than 100' },
    ]);
  });
});

describe('ProblemValidationPipe', () => {
  class LimitQuery {
    @IsInt()
    @Max(100)
    limit!: number;
  }
  const pipe = new ProblemValidationPipe({ transform: true });

  const problemFor = async (type: 'body' | 'query' | 'param') => {
    try {
      await pipe.transform({ limit: 500 }, { type, metatype: LimitQuery });
    } catch (error) {
      return (error as ProblemException).problem;
    }
    throw new Error('expected the pipe to throw');
  };

  it('locates body errors with a JSON Pointer', async () => {
    expect((await problemFor('body')).errors).toEqual([
      { pointer: '#/limit', detail: 'limit must not be greater than 100' },
    ]);
  });

  it.each(['query', 'param'] as const)(
    'locates %s errors by parameter name, without a pointer',
    async (type) => {
      const problem = await problemFor(type);

      expect(problem).toMatchObject({
        type: PROBLEM_TYPES.validation,
        status: 400,
      });
      expect(problem.errors).toEqual([
        { parameter: 'limit', detail: 'limit must not be greater than 100' },
      ]);
    },
  );

  it('passes valid values through', async () => {
    await expect(
      pipe.transform({ limit: 5 }, { type: 'query', metatype: LimitQuery }),
    ).resolves.toEqual({ limit: 5 });
  });
});

describe('parseUuidParam', () => {
  it('rejects a malformed id with a validation problem naming the parameter', async () => {
    let thrown: unknown;
    try {
      await parseUuidParam('lessonId').transform('not-a-uuid', {
        type: 'param',
        data: 'lessonId',
      });
    } catch (error) {
      thrown = error;
    }

    expect((thrown as ProblemException).problem).toEqual({
      type: PROBLEM_TYPES.validation,
      title: 'Validation failed',
      status: 400,
      detail: 'The request contains invalid fields.',
      errors: [{ parameter: 'lessonId', detail: 'lessonId must be a UUID' }],
    });
  });
});

describe('toProblemDetails', () => {
  const instance = '/api/things';

  it('uses a ProblemException as-is and adds the instance', () => {
    const problem = toProblemDetails(
      validationProblem(
        toProblemFieldErrors([
          validationError('title', { isString: 'bad title' }),
        ]),
      ),
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

  it('maps an exposed 4xx http-errors object (e.g. body too large) to its status', () => {
    // What the Express JSON body parser throws for a body over its limit.
    const error = Object.assign(new Error('request entity too large'), {
      status: 413,
      statusCode: 413,
      expose: true,
      type: 'entity.too.large',
    });

    expect(toProblemDetails(error, instance)).toEqual({
      type: 'about:blank',
      title: 'Payload Too Large',
      status: 413,
      detail: 'request entity too large',
      instance,
    });
  });

  it('keeps a generic 500 for errors with a status that are not marked as exposed', () => {
    const error = Object.assign(new Error('internal detail'), { status: 400 });
    const serverError = Object.assign(new Error('db down'), {
      status: 503,
      expose: true,
    });

    expect(toProblemDetails(error, instance).status).toBe(500);
    expect(toProblemDetails(serverError, instance)).toMatchObject({
      status: 500,
      detail: 'An unexpected error occurred. Please try again later.',
    });
  });

  it('handles thrown values that are not errors', () => {
    expect(toProblemDetails('a string', instance).status).toBe(500);
  });
});
