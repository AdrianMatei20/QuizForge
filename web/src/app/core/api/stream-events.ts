/**
 * Events of GET /api/quizzes/:id/stream (Server-Sent Events). Hand-written:
 * an OpenAPI spec cannot describe the events of a stream, only its payload
 * schemas, so the event names and their pairing with payloads live here.
 * Payload shapes still come from the generated types.
 * (Mirrors api/src/quiz/quiz-stream.events.ts.)
 */
import type { components } from './openapi.generated';

type Schemas = components['schemas'];

export type QuestionRejectedPayload = Schemas['QuestionRejectedEvent'];
export type StreamDonePayload = Schemas['StreamDoneEvent'];

/** RFC 9457 problem details, as the `problem` event's data. */
export interface ProblemPayload {
  type: string;
  title?: string;
  status?: number;
  detail?: string;
  quizId?: string;
  [extension: string]: unknown;
}

export type QuizStreamEvent =
  | { type: 'question'; data: Schemas['QuestionResponse'] }
  | { type: 'question_rejected'; data: QuestionRejectedPayload }
  | { type: 'done'; data: StreamDonePayload };

/**
 * The SSE event names the server sends. `problem` (not `error`) ends the
 * stream with problem details; the browser's own `error` event only means the
 * connection dropped, and EventSource reconnects by itself.
 */
export const QUIZ_STREAM_EVENT_NAMES = ['question', 'question_rejected', 'done'] as const;
export const PROBLEM_EVENT_NAME = 'problem';
