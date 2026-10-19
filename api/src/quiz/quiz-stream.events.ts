import type { ProblemDetails } from '../common/problem-details/problem-details.js';
import type {
  QuestionRejectedEvent,
  QuestionResponse,
  StreamDoneEvent,
} from './quiz.mapper.js';

/**
 * The events of GET /quizzes/:id/stream. Shaped like Nest's SSE MessageEvent
 * ({ type, data }), so they can be returned from an @Sse() handler as they
 * are: `type` becomes the SSE `event:` line, `data` its JSON payload.
 *
 * `problem`, not `error`: browsers already fire an "error" event on an
 * EventSource when the connection drops, and the two must not be confused.
 */
export type QuizStreamEvent =
  | { type: 'question'; data: QuestionResponse }
  | { type: 'question_rejected'; data: QuestionRejectedEvent }
  | { type: 'done'; data: StreamDoneEvent }
  | { type: 'problem'; data: ProblemDetails };

/** After one of these, the stream ends. */
export function isFinalEvent(event: QuizStreamEvent): boolean {
  return event.type === 'done' || event.type === 'problem';
}
