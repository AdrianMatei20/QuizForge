import {
  afterNextRender,
  Component,
  computed,
  type ElementRef,
  input,
  linkedSignal,
  type OnInit,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  applyEach,
  type FieldTree,
  form,
  FormField,
  maxLength,
  validate,
} from '@angular/forms/signals';
import type { ProblemFieldError, QuestionResponse } from '../core/api/api.types';
import { isCatchAllOption, LIMITS, normalizeStem, normalizeText } from '../core/limits';
import type { QuestionEdit } from './quiz-review.store';

/** Another question of the quiz, for the "no duplicate stems" check. */
export interface OtherStem {
  position: number;
  stem: string;
}

const letter = (index: number) => String.fromCharCode(65 + index);

function blank(value: string, message: string) {
  return value.trim() === '' ? { kind: 'blank', message } : undefined;
}

/**
 * Inline editor for one question, with the same checks as the API (see
 * api/src/quiz/rules.ts editedQuestionViolations). API errors that still come
 * back are shown next to the field their pointer names, and cleared as soon
 * as the teacher changes anything.
 */
@Component({
  selector: 'app-question-edit-form',
  imports: [FormField],
  templateUrl: './question-edit-form.html',
  styleUrl: './question-edit-form.scss',
})
export class QuestionEditForm implements OnInit {
  readonly question = input.required<QuestionResponse>();
  readonly otherStems = input<readonly OtherStem[]>([]);
  /** From the last failed save. */
  readonly fieldErrors = input<readonly ProblemFieldError[]>([]);
  readonly saving = input(false);

  readonly save = output<QuestionEdit>();
  readonly cancelled = output<void>();

  private readonly stemInput = viewChild<ElementRef<HTMLTextAreaElement>>('stemInput');

  protected readonly model = signal<QuestionEdit>({
    stem: '',
    options: [],
    correctIndex: 0,
    explanation: '',
  });

  protected readonly editForm = form(this.model, (path) => {
    validate(path.stem, ({ value }) => blank(value(), 'Enter the question.'));
    maxLength(path.stem, LIMITS.stemMax, {
      message: `Use at most ${LIMITS.stemMax} characters.`,
    });
    validate(path.stem, ({ value }) => {
      const key = normalizeStem(value());
      const duplicate = this.otherStems().find((other) => normalizeStem(other.stem) === key);
      return duplicate && key !== ''
        ? { kind: 'duplicate', message: `This is the same as question ${duplicate.position}.` }
        : undefined;
    });

    applyEach(path.options, (option) => {
      validate(option, ({ value }) => blank(value(), 'Enter this option.'));
      maxLength(option, LIMITS.optionMax, {
        message: `Use at most ${LIMITS.optionMax} characters.`,
      });
      validate(option, ({ value }) =>
        isCatchAllOption(value())
          ? {
              kind: 'catch-all',
              message: '"All of the above" and "None of the above" are not allowed.',
            }
          : undefined,
      );
      // Flags the repeat, not the first one: that is the one to change.
      validate(option, ({ value, index, valueOf }) => {
        const key = normalizeText(value());
        const first = valueOf(path.options).findIndex((other) => normalizeText(other) === key);
        return key !== '' && first !== -1 && first < index()
          ? { kind: 'duplicate', message: `This is the same as option ${letter(first)}.` }
          : undefined;
      });
    });

    validate(path.explanation, ({ value }) => blank(value(), 'Enter an explanation.'));
    maxLength(path.explanation, LIMITS.explanationMax, {
      message: `Use at most ${LIMITS.explanationMax} characters.`,
    });
  });

  /** API errors, until the teacher edits something (or a new save fails). */
  private readonly serverErrors = linkedSignal(() => this.fieldErrors());

  /** API errors that point at no field shown here, listed above the form. */
  protected readonly generalErrors = computed(() =>
    this.serverErrors().filter((error) => !this.isKnownPointer(error.pointer)),
  );

  protected readonly isTrueFalse = computed(() => this.question().type === 'true_false');
  protected readonly idPrefix = computed(() => `edit-${this.question().id}`);

  constructor() {
    afterNextRender(() => this.stemInput()?.nativeElement.focus());
  }

  ngOnInit(): void {
    const { stem, options, correctIndex, explanation } = this.question();
    this.model.set({ stem, options: [...options], correctIndex, explanation });
  }

  protected optionField(index: number): FieldTree<string> {
    return this.editForm.options[index] as FieldTree<string>;
  }

  protected setCorrect(index: number): void {
    this.model.update((model) => ({ ...model, correctIndex: index }));
    this.dismissServerErrors();
  }

  /** Client errors (once the field is touched) plus API errors for this pointer. */
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

  protected letter(index: number): string {
    return letter(index);
  }

  protected dismissServerErrors(): void {
    if (this.serverErrors().length > 0) {
      this.serverErrors.set([]);
    }
  }

  protected submit(event: Event): void {
    event.preventDefault();
    if (this.saving()) {
      return;
    }
    if (this.editForm().invalid()) {
      // Shows every error at once, instead of only those of visited fields.
      this.editForm().markAsTouched();
      return;
    }
    this.save.emit({ ...this.model(), options: [...this.model().options] });
  }

  private isKnownPointer(pointer: string | undefined): boolean {
    if (pointer === undefined) {
      return false;
    }
    if (['#/stem', '#/explanation', '#/correctIndex'].includes(pointer)) {
      return true;
    }
    const match = /^#\/options\/(\d+)$/.exec(pointer);
    return match !== null && Number(match[1]) < this.model().options.length;
  }
}
