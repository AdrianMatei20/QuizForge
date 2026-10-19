import { Component, computed, input } from '@angular/core';
import { type FieldTree, FormField } from '@angular/forms/signals';
import type { Difficulty, ProblemFieldError } from '../core/api/api.types';
import { LIMITS } from '../core/limits';
import type { QuizSettingsModel } from './quiz-settings.model';

/**
 * The quiz settings fieldset (number of questions, difficulty, question
 * types). The parent owns the form, applies quizSettingsSchema, and passes in
 * the settings part of it, plus the API's field errors from the last attempt.
 */
@Component({
  selector: 'app-quiz-settings-fields',
  imports: [FormField],
  templateUrl: './quiz-settings-fields.html',
  styleUrl: './quiz-settings-fields.scss',
})
export class QuizSettingsFields {
  readonly settings = input.required<FieldTree<QuizSettingsModel>>();
  readonly serverErrors = input<readonly ProblemFieldError[]>([]);

  protected readonly limits = LIMITS;
  /** Short labels fit the dropdown; the selected level's description is shown under it. */
  protected readonly difficulties: readonly {
    value: Difficulty;
    label: string;
    description: string;
  }[] = [
    { value: 'easy', label: 'Easy', description: 'Recall facts stated in the lesson.' },
    {
      value: 'medium',
      label: 'Medium',
      description: 'Understand or apply an idea from the lesson.',
    },
    { value: 'hard', label: 'Hard', description: 'Combine several parts of the lesson.' },
  ];

  protected readonly difficultyDescription = computed(() => {
    const difficulty = this.settings().difficulty().value();
    return this.difficulties.find((option) => option.value === difficulty)?.description;
  });

  /** Client errors once the field is touched, then the API's errors for the same pointer. */
  protected messages(field: FieldTree<unknown>, pointer: string): string[] {
    const state = field();
    const client = state.touched()
      ? state.errors().flatMap((error) => (error.message ? [error.message] : []))
      : [];
    const server = this.serverErrors()
      .filter((error) => error.pointer === pointer)
      .map((error) => error.detail);
    return [...client, ...server];
  }
}
