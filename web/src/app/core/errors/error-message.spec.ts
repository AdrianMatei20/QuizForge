import { AppError } from './app-error';
import { errorMessage } from './error-message';

describe('errorMessage', () => {
  it('says the model returned an unusable answer for invalid output', () => {
    expect(errorMessage(new AppError('invalid-output', 502, 'raw detail'))).toBe(
      "The AI returned an answer we couldn't use. Try again.",
    );
  });

  it('says the daily budget is used up for the budget guard', () => {
    expect(errorMessage(new AppError('budget-exceeded', 429, undefined))).toBe(
      "Today's AI budget is used up. Try again after midnight UTC.",
    );
  });

  it("uses the API's own detail for conflicts and validation", () => {
    expect(
      errorMessage(
        new AppError(
          'conflict',
          409,
          'A published quiz and its questions can no longer be changed.',
        ),
      ),
    ).toBe('A published quiz and its questions can no longer be changed.');
  });

  it('never shows raw error objects', () => {
    expect(errorMessage({ status: 500, error: '{"secret":true}' })).toBe(
      'Something went wrong. Please try again.',
    );
    expect(errorMessage(new AppError('server', 500, undefined))).toBe(
      'Something went wrong on our side. Please try again.',
    );
  });
});
