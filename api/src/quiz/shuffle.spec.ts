import { seededRandom } from '../../test/support/random.js';
import { shuffleOptions } from './shuffle.js';

const QUESTION = {
  type: 'multiple_choice' as const,
  options: ['Oxygen', 'Nitrogen', 'Helium', 'Argon'],
  correctIndex: 2,
};

describe('shuffleOptions', () => {
  it.each([1, 2, 3, 42, 1234, 99_999])(
    'seed %i: keeps the correct answer correct and the same set of options',
    (seed) => {
      const shuffled = shuffleOptions(QUESTION, seededRandom(seed));

      expect(shuffled.options[shuffled.correctIndex]).toBe('Helium');
      expect([...shuffled.options].sort()).toEqual(
        [...QUESTION.options].sort(),
      );
    },
  );

  it('is reproducible with the same seed', () => {
    expect(shuffleOptions(QUESTION, seededRandom(7))).toEqual(
      shuffleOptions(QUESTION, seededRandom(7)),
    );
  });

  it('puts the correct answer in every position across seeds', () => {
    const positions = new Set(
      Array.from(
        { length: 100 },
        (_, seed) => shuffleOptions(QUESTION, seededRandom(seed)).correctIndex,
      ),
    );

    expect([...positions].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it('does not change the input question', () => {
    const options = [...QUESTION.options];

    shuffleOptions({ ...QUESTION, options }, seededRandom(1));

    expect(options).toEqual(QUESTION.options);
  });

  it('leaves true/false questions in their fixed order', () => {
    const trueFalse = {
      type: 'true_false' as const,
      options: ['True', 'False'],
      correctIndex: 1,
    };

    expect(shuffleOptions(trueFalse, () => 0)).toEqual({
      options: ['True', 'False'],
      correctIndex: 1,
    });
  });

  it('maps positions exactly as Fisher-Yates with the given random values', () => {
    // random() = 0 always swaps position i with 0: [A,B,C,D] -> [B,C,D,A].
    const shuffled = shuffleOptions(
      {
        type: 'multiple_choice',
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 0,
      },
      () => 0,
    );

    expect(shuffled).toEqual({
      options: ['B', 'C', 'D', 'A'],
      correctIndex: 3,
    });
  });
});
