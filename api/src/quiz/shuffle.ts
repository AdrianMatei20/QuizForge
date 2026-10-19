/** Returns a number in [0, 1), like Math.random. */
export type Random = () => number;

/** Randomness for option shuffling. Math.random in the app, a seeded generator in tests. */
export const QUIZ_RANDOM = Symbol('QUIZ_RANDOM');

interface ShuffleInput {
  type: 'multiple_choice' | 'true_false';
  options: readonly string[];
  correctIndex: number;
}

/**
 * Shuffles a multiple-choice question's options (Fisher-Yates) and moves
 * correctIndex with the correct answer, so the answer's position carries no
 * signal: models tend to favour some positions. True/false options keep
 * their fixed ["True", "False"] order.
 *
 * The shuffle is uniform, so 1 time in 24 the order stays the same. Forcing
 * a change would itself say something about where the answer was.
 */
export function shuffleOptions(
  question: ShuffleInput,
  random: Random,
): { options: string[]; correctIndex: number } {
  if (question.type !== 'multiple_choice') {
    return {
      options: [...question.options],
      correctIndex: question.correctIndex,
    };
  }
  const order = question.options.map((_option, index) => index);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  return {
    options: order.map((index) => question.options[index] as string),
    correctIndex: order.indexOf(question.correctIndex),
  };
}
