import type { QuizFailureReason } from '../core/api/api.types';
import { FAILURE_TEXT, failureSentence, settingsSummary } from './quiz-labels';

describe('failureSentence', () => {
  it('turns a reason code into a sentence', () => {
    expect(failureSentence('timeout')).toBe('Failed because the AI service took too long.');
    expect(failureSentence('internal_error')).toBe('Failed because of an unexpected error.');
  });

  it('has a sentence for every reason, never a code', () => {
    for (const reason of Object.keys(FAILURE_TEXT) as QuizFailureReason[]) {
      const sentence = failureSentence(reason);
      expect(sentence).toMatch(/^Failed because .+\.$/);
      // Codes are snake_case; a sentence has no underscores.
      expect(sentence).not.toContain('_');
    }
  });

  it('still reads as a sentence for a missing or unknown reason', () => {
    expect(failureSentence(null)).toBe('Failed for an unknown reason.');
    expect(failureSentence('new_reason' as QuizFailureReason)).toBe(
      'Failed for an unknown reason.',
    );
  });
});

describe('settingsSummary', () => {
  it('names the difficulty and the question types', () => {
    expect(
      settingsSummary({ count: 5, difficulty: 'hard', types: ['multiple_choice', 'true_false'] }),
    ).toBe('Hard · multiple choice, true/false');
  });
});
