import { Component, computed, input, output } from '@angular/core';
import { AppError } from '../core/errors/app-error';
import { errorMessage } from '../core/errors/error-message';

/**
 * A readable error, announced to screen readers (role="alert"), with a Retry
 * button when trying again might work.
 */
@Component({
  selector: 'app-error-message',
  template: `
    @if (error(); as error) {
      <div class="error-message" role="alert">
        <p>{{ message() }}</p>
        @if (canRetry()) {
          <button type="button" class="button secondary" (click)="retry.emit()">Try again</button>
        }
      </div>
    }
  `,
  styleUrl: './error-message.scss',
})
export class ErrorMessage {
  readonly error = input<unknown>(null);
  /** Show Retry only where the parent can actually retry. */
  readonly retryable = input(false);
  readonly retry = output<void>();

  protected readonly message = computed(() => errorMessage(this.error()));
  protected readonly canRetry = computed(() => {
    const error = this.error();
    return this.retryable() && error instanceof AppError && error.retryable;
  });
}
