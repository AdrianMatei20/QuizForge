import { describeRedisError } from './redis.module.js';

describe('describeRedisError', () => {
  it('uses the error message when there is one', () => {
    expect(describeRedisError(new Error('READONLY replica'))).toBe(
      'READONLY replica',
    );
  });

  it('falls back to the code for an AggregateError with an empty message', () => {
    const error: NodeJS.ErrnoException = new AggregateError([], '');
    error.code = 'ECONNREFUSED';

    expect(describeRedisError(error)).toBe('ECONNREFUSED');
  });

  it('falls back to the error name when there is no message or code', () => {
    expect(describeRedisError(new AggregateError([], ''))).toBe(
      'AggregateError',
    );
  });
});
