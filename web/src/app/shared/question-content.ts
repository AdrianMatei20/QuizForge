import { Component, input } from '@angular/core';
import type { QuestionResponse } from '../core/api/api.types';

/**
 * A question as text: stem, options with the correct one marked (by a label,
 * not by colour alone), the explanation, and the supporting quote in a
 * native <details> block. Model output is only ever interpolated as text.
 */
@Component({
  selector: 'app-question-content',
  template: `
    <p class="stem">{{ question().stem }}</p>
    <ol class="options" type="A">
      @for (option of question().options; track $index) {
        <li [class.correct]="$index === question().correctIndex">
          <span class="option-text">{{ option }}</span>
          @if ($index === question().correctIndex) {
            <span class="correct-label"><span aria-hidden="true">✓</span> Correct answer</span>
          }
        </li>
      }
    </ol>
    @if (showExplanation()) {
      <p class="explanation"><strong>Why: </strong>{{ question().explanation }}</p>
      <details class="source">
        <summary>From the lesson</summary>
        <blockquote>{{ question().sourceQuote }}</blockquote>
      </details>
    }
  `,
  styleUrl: './question-content.scss',
})
export class QuestionContent {
  readonly question = input.required<QuestionResponse>();
  readonly showExplanation = input(true);
}
