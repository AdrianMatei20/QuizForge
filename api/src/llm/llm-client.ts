import type { z } from 'zod';

/**
 * The provider boundary. An LlmClient only talks to the provider: it sends a
 * request and returns raw text and token usage. Parsing, validation, retries,
 * caching and cost tracking all live in LlmService, so every provider (and
 * the fake) gets them for free and behaves the same way.
 */
export interface LlmClient {
  generate(request: LlmRequest): Promise<LlmResponse>;
  /** Yields text chunks as they arrive, then exactly one `done` event with the usage. */
  stream(request: LlmRequest): AsyncIterable<LlmStreamEvent>;
}

export const LLM_CLIENT = Symbol('LLM_CLIENT');

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  /** Which prompt this call renders. Providers ignore it; the fake uses it to pick fixtures. */
  promptId: string;
  model: string;
  system?: string;
  messages: LlmMessage[];
  maxTokens: number;
  /** When set, the provider is asked to constrain its output to this JSON shape. */
  outputSchema?: z.ZodType;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Why the model stopped, in provider-neutral terms. Each client maps its
 * provider's values onto these, so LlmService never sees provider strings.
 * - complete: the model finished its answer
 * - max_tokens: the output was cut off (token limit or context window)
 * - refusal: the model declined to answer
 * - other: anything else (e.g. a tool call), treated like complete
 */
export type LlmStopReason = 'complete' | 'max_tokens' | 'refusal' | 'other';

export interface LlmResponse {
  text: string;
  usage: LlmUsage;
  stopReason: LlmStopReason;
}

export type LlmStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'done'; usage: LlmUsage; stopReason: LlmStopReason };

/**
 * - rate_limited: 429
 * - server: 5xx, overloaded, or the connection failed
 * - timeout: the per-call timeout elapsed
 * - client: any other 4xx (bad request, auth, ...), which will not succeed on retry
 * - aborted: the caller's AbortSignal fired
 */
export type LlmProviderErrorKind =
  'rate_limited' | 'server' | 'timeout' | 'client' | 'aborted';

/**
 * The only error an LlmClient throws. Provider SDK errors are translated into
 * it, so LlmService decides about retries without knowing any SDK types.
 * Messages must never contain prompt or model text.
 */
export class LlmProviderError extends Error {
  override readonly name = 'LlmProviderError';
  readonly status: number | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    readonly kind: LlmProviderErrorKind,
    message: string,
    options: {
      status?: number;
      retryAfterSeconds?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}
