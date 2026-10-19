import { max, min, schema, validate } from '@angular/forms/signals';
import type { Difficulty, GenerateQuizRequest, QuestionType } from '../core/api/api.types';
import { LIMITS } from '../core/limits';

/** The quiz settings as the form edits them: one checkbox per question type. */
export interface QuizSettingsModel {
  count: number;
  difficulty: Difficulty;
  multipleChoice: boolean;
  trueFalse: boolean;
}

export function defaultQuizSettings(): QuizSettingsModel {
  return { count: 5, difficulty: 'medium', multipleChoice: true, trueFalse: true };
}

/** The settings rules, shared by every form that starts a quiz. */
export const quizSettingsSchema = schema<QuizSettingsModel>((path) => {
  min(path.count, LIMITS.quizCountMin, {
    message: `Ask for at least ${LIMITS.quizCountMin} questions.`,
  });
  max(path.count, LIMITS.quizCountMax, {
    message: `Ask for at most ${LIMITS.quizCountMax} questions.`,
  });
  validate(path.count, ({ value }) =>
    Number.isInteger(value()) ? undefined : { kind: 'integer', message: 'Enter a whole number.' },
  );
  validate(path.multipleChoice, ({ value, valueOf }) =>
    value() || valueOf(path.trueFalse)
      ? undefined
      : { kind: 'no-type', message: 'Choose at least one question type.' },
  );
});

export function toQuizRequest(settings: QuizSettingsModel): Omit<GenerateQuizRequest, 'stream'> {
  const types: QuestionType[] = [
    ...(settings.multipleChoice ? (['multiple_choice'] as const) : []),
    ...(settings.trueFalse ? (['true_false'] as const) : []),
  ];
  return { count: settings.count, difficulty: settings.difficulty, types };
}
