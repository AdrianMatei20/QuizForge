import { ProblemException } from '../common/problem-details/problem-details.js';
import { QUESTION_STATUSES, type QuestionStatus } from './quiz.types.js';
import { assertTransition, isAllowedTransition } from './status-transitions.js';

/** Every (from, to) pair of the 3 x 3 table, and what should happen. */
const TABLE: [
  QuestionStatus,
  QuestionStatus,
  'change' | 'no-op' | 'invalid',
][] = [
  ['draft', 'draft', 'no-op'],
  ['draft', 'approved', 'change'],
  ['draft', 'rejected', 'change'],
  ['approved', 'draft', 'change'],
  ['approved', 'approved', 'no-op'],
  ['approved', 'rejected', 'invalid'],
  ['rejected', 'draft', 'change'],
  ['rejected', 'approved', 'invalid'],
  ['rejected', 'rejected', 'no-op'],
];

describe('question status transitions', () => {
  it('covers every pair of statuses', () => {
    expect(TABLE).toHaveLength(QUESTION_STATUSES.length ** 2);
  });

  it.each(TABLE.filter(([, , outcome]) => outcome === 'change'))(
    '%s -> %s is allowed',
    (from, to) => {
      expect(isAllowedTransition(from, to)).toBe(true);
      expect(() => assertTransition(from, to)).not.toThrow();
    },
  );

  it.each(TABLE.filter(([, , outcome]) => outcome === 'no-op'))(
    '%s -> %s is a no-op, not an error',
    (from, to) => {
      expect(isAllowedTransition(from, to)).toBe(false);
      expect(() => assertTransition(from, to)).not.toThrow();
    },
  );

  it.each(TABLE.filter(([, , outcome]) => outcome === 'invalid'))(
    '%s -> %s is rejected with 409 problem details',
    (from, to) => {
      expect(isAllowedTransition(from, to)).toBe(false);

      let thrown: unknown;
      try {
        assertTransition(from, to);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ProblemException);
      expect((thrown as ProblemException).problem).toMatchObject({
        type: 'urn:quizforge:problem:invalid-status-transition',
        status: 409,
        from,
        to,
      });
    },
  );
});
