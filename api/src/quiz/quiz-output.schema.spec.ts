import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { quizOutputSchema } from './quiz-output.schema.js';

const multipleChoice = {
  type: 'multiple_choice',
  stem: 'Q?',
  options: ['A', 'B', 'C', 'D'],
  correctIndex: 0,
  explanation: 'E',
  sourceQuote: 'S',
};
const trueFalse = {
  ...multipleChoice,
  type: 'true_false',
  options: ['True', 'False'],
};

function issues(value: unknown): string[] {
  const result = quizOutputSchema.safeParse(value);
  return result.success
    ? []
    : result.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`,
      );
}

describe('quizOutputSchema', () => {
  it('accepts both question types', () => {
    expect(issues({ questions: [multipleChoice, trueFalse] })).toEqual([]);
  });

  it('keeps the data exactly as given (no transforms)', () => {
    const input = { questions: [{ ...multipleChoice, stem: '  padded  ' }] };

    expect(quizOutputSchema.parse(input)).toEqual(input);
  });

  it('requires exactly 4 options for multiple choice', () => {
    expect(
      issues({ questions: [{ ...multipleChoice, options: ['A', 'B', 'C'] }] }),
    ).toHaveLength(1);
  });

  it('requires true/false options to be exactly ["True", "False"]', () => {
    expect(
      issues({ questions: [{ ...trueFalse, options: ['False', 'True'] }] }),
    ).toEqual(['questions.0.options: must be exactly ["True", "False"]']);
    expect(
      issues({ questions: [{ ...trueFalse, options: ['Yes', 'No'] }] }).length,
    ).toBeGreaterThan(0);
  });

  it('rejects blank text and unknown types', () => {
    expect(
      issues({ questions: [{ ...multipleChoice, sourceQuote: '   ' }] }),
    ).toEqual(['questions.0.sourceQuote: must not be blank']);
    expect(
      issues({ questions: [{ ...multipleChoice, type: 'essay' }] }).length,
    ).toBeGreaterThan(0);
  });

  it('rejects unknown keys instead of silently dropping them', () => {
    expect(
      issues({ questions: [{ ...multipleChoice, difficulty: 'hard' }] }).length,
    ).toBeGreaterThan(0);
  });

  it('can be converted to a structured-output format by the SDK', () => {
    // The SDK rejects some zod shapes (e.g. tuples of literals) at request time.
    expect(zodOutputFormat(quizOutputSchema).schema).toMatchObject({
      type: 'object',
    });
  });
});
