import type { Question } from './question.entity.js';
import type { GeneratedQuestion } from './quiz-output.schema.js';
import { type Random, shuffleOptions } from './shuffle.js';

export type NewQuestionRow = Pick<
  Question,
  | 'quizId'
  | 'position'
  | 'type'
  | 'stem'
  | 'options'
  | 'correctIndex'
  | 'explanation'
  | 'sourceQuote'
  | 'status'
  | 'promptId'
  | 'promptVersion'
  | 'model'
  | 'original'
>;

/**
 * A model-written question as a new draft row: options shuffled (so the
 * answer's position carries no signal), the prompt and model that wrote it
 * recorded, and `original` kept exactly as the model returned it. Used by
 * initial generation, streaming and regenerate alike.
 */
export function newQuestionRow(input: {
  quizId: string;
  position: number;
  generated: GeneratedQuestion;
  prompt: { id: string; version: number };
  model: string;
  random: Random;
}): NewQuestionRow {
  const { quizId, position, generated, prompt, model, random } = input;
  return {
    quizId,
    position,
    type: generated.type,
    stem: generated.stem,
    ...shuffleOptions(generated, random),
    explanation: generated.explanation,
    sourceQuote: generated.sourceQuote,
    status: 'draft',
    promptId: prompt.id,
    promptVersion: prompt.version,
    model,
    original: generated,
  };
}
