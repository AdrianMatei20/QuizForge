import { AppError } from './app-error';

/**
 * A sentence a teacher can act on. Uses the API's `detail` where it is
 * specific (validation, conflicts), and our own wording where the API's
 * would be too technical. Never shows raw JSON or status codes alone.
 */
export function errorMessage(error: unknown): string {
  if (!(error instanceof AppError)) {
    return 'Something went wrong. Please try again.';
  }
  switch (error.kind) {
    case 'invalid-output':
      return "The AI returned an answer we couldn't use. Try again.";
    case 'budget-exceeded':
      return "Today's AI budget is used up. Try again after midnight UTC.";
    case 'too-many-requests':
      return 'Too many requests in a short time. Wait a minute and try again.';
    case 'rate-limited':
      return 'The AI service is busy right now. Wait a moment and try again.';
    case 'timeout':
      return 'The AI service took too long to answer. Try again.';
    case 'provider-error':
      return 'The AI service had a problem. Try again in a moment.';
    case 'demo-mode-lesson':
      return 'Demo mode only works with the sample lessons. Open one under Lessons and generate a quiz there, or run the API with an API key to use your own lesson.';
    case 'refused':
      return 'The AI declined to write questions for this lesson. Try changing the lesson text.';
    case 'network':
      return "Couldn't reach the server. Check that the API is running and try again.";
    case 'not-found':
      return error.detail ?? "That item doesn't exist (any more).";
    case 'validation':
      return error.detail ?? 'Some fields are not valid.';
    case 'conflict':
    case 'too-large':
      return error.detail ?? 'The request could not be completed.';
    case 'server':
    case 'unknown':
      return 'Something went wrong on our side. Please try again.';
  }
}
