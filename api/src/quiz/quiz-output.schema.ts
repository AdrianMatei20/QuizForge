import { z } from 'zod';
import { TRUE_FALSE_OPTIONS } from './quiz.types.js';

/**
 * What the quiz prompt must return. Also sent to the provider as the
 * structured-output schema. Two things to know:
 * - The provider only enforces the JSON shape; it turns const, enum and
 *   length limits into hints. zod enforces all of them again here.
 * - The SDK cannot convert a tuple of literals, so true/false options are a
 *   2-item "True" | "False" array plus a refine for the exact order.
 * No transforms and no silently dropped keys (strict objects): the parsed
 * data must equal the model's JSON, because it is
 * stored as each question's `original`.
 */
// A check, not .trim(): in zod, .trim() is a transform and would change the data.
const nonBlank = () =>
  z.string().refine((text) => text.trim() !== '', 'must not be blank');

const fields = {
  stem: nonBlank(),
  correctIndex: z.number().int(),
  explanation: nonBlank(),
  sourceQuote: nonBlank(),
};

const multipleChoiceQuestion = z.strictObject({
  type: z.literal('multiple_choice'),
  stem: fields.stem,
  options: z.array(nonBlank()).length(4),
  correctIndex: fields.correctIndex,
  explanation: fields.explanation,
  sourceQuote: fields.sourceQuote,
});

const trueFalseQuestion = z.strictObject({
  type: z.literal('true_false'),
  stem: fields.stem,
  options: z
    .array(z.enum(TRUE_FALSE_OPTIONS))
    .length(2)
    .refine(
      (options) =>
        options[0] === TRUE_FALSE_OPTIONS[0] &&
        options[1] === TRUE_FALSE_OPTIONS[1],
      'must be exactly ["True", "False"]',
    ),
  correctIndex: fields.correctIndex,
  explanation: fields.explanation,
  sourceQuote: fields.sourceQuote,
});

export const generatedQuestionSchema = z.discriminatedUnion('type', [
  multipleChoiceQuestion,
  trueFalseQuestion,
]);

export const quizOutputSchema = z.strictObject({
  questions: z.array(generatedQuestionSchema),
});

export type GeneratedQuestion = z.infer<typeof generatedQuestionSchema>;
export type GeneratedQuiz = z.infer<typeof quizOutputSchema>;
