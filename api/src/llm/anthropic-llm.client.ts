// The only file that imports the provider SDK (see CLAUDE.md, Architecture rules).
import Anthropic, {
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  type ClientOptions,
} from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type {
  MessageCreateParamsNonStreaming,
  StopReason,
} from '@anthropic-ai/sdk/resources/messages';
import {
  type LlmClient,
  LlmProviderError,
  type LlmRequest,
  type LlmResponse,
  type LlmStopReason,
  type LlmStreamEvent,
} from './llm-client.js';

export interface AnthropicLlmClientOptions {
  apiKey: string;
  /** Tests inject a fake fetch so no request leaves the machine. */
  fetch?: ClientOptions['fetch'];
}

/**
 * LlmClient for the Anthropic Messages API.
 *
 * JSON output uses structured outputs (`output_config.format` with a JSON
 * schema built from the zod schema), which the Anthropic docs recommend for
 * this. The SDK's `messages.parse()` would also parse the result, but here
 * parsing and validation belong to LlmService, so this client returns the raw
 * text from `messages.create()`.
 */
export class AnthropicLlmClient implements LlmClient {
  private readonly client: Anthropic;

  constructor({ apiKey, fetch }: AnthropicLlmClientOptions) {
    this.client = new Anthropic({
      apiKey,
      // LlmService owns retries. SDK retries on top would multiply the attempts
      // (3 x 3) and hide them from the attempts count and the backoff policy.
      maxRetries: 0,
      ...(fetch ? { fetch } : {}),
    });
  }

  async generate(request: LlmRequest): Promise<LlmResponse> {
    try {
      const message = await this.client.messages.create(
        toParams(request),
        requestOptions(request),
      );
      const text = message.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('');
      return {
        text,
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
        },
        stopReason: toStopReason(message.stop_reason),
      };
    } catch (error) {
      throw toProviderError(error);
    }
  }

  async *stream(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
    try {
      const stream = this.client.messages.stream(
        toParams(request),
        requestOptions(request),
      );
      for await (const event of stream) {
        if (event.type === 'message_start') {
          yield {
            type: 'start',
            inputTokens: event.message.usage.input_tokens,
          };
        } else if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield { type: 'text', text: event.delta.text };
        }
      }
      const message = await stream.finalMessage();
      yield {
        type: 'done',
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
        },
        stopReason: toStopReason(message.stop_reason),
      };
    } catch (error) {
      throw toProviderError(error);
    }
  }
}

function toParams(request: LlmRequest): MessageCreateParamsNonStreaming {
  return {
    model: request.model,
    max_tokens: request.maxTokens,
    messages: request.messages,
    ...(request.system === undefined ? {} : { system: request.system }),
    ...(request.outputSchema
      ? { output_config: { format: zodOutputFormat(request.outputSchema) } }
      : {}),
  };
}

function requestOptions(request: LlmRequest) {
  return {
    timeout: request.timeoutMs,
    ...(request.signal ? { signal: request.signal } : {}),
  };
}

/** Maps SDK errors to provider-neutral ones. Order matters: the timeout and abort classes extend APIError. */
export function toProviderError(error: unknown): LlmProviderError {
  if (error instanceof LlmProviderError) {
    return error;
  }
  if (error instanceof APIConnectionTimeoutError) {
    return new LlmProviderError('timeout', 'Anthropic request timed out', {
      cause: error,
    });
  }
  if (error instanceof APIUserAbortError) {
    return new LlmProviderError('aborted', 'Anthropic request was aborted', {
      cause: error,
    });
  }
  if (error instanceof APIError) {
    const status = error.status;
    const message = `Anthropic request failed${status ? ` with status ${status}` : ''}`;
    if (status === 429) {
      return new LlmProviderError('rate_limited', message, {
        status,
        retryAfterSeconds: parseRetryAfter(error.headers?.get('retry-after')),
        cause: error,
      });
    }
    // No status means the connection failed, which is worth a retry like a 5xx.
    // 5xx responses (529 "overloaded" especially) can carry retry-after too.
    if (status === undefined || status >= 500) {
      const retryAfterSeconds = parseRetryAfter(
        error.headers?.get('retry-after'),
      );
      return new LlmProviderError('server', message, {
        ...(status === undefined ? {} : { status }),
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
        cause: error,
      });
    }
    return new LlmProviderError('client', message, { status, cause: error });
  }
  return new LlmProviderError('server', 'Anthropic request failed', {
    cause: error,
  });
}

/**
 * Maps Anthropic stop reasons to provider-neutral ones. A full context window
 * also cuts the output off, so it counts as max_tokens.
 */
export function toStopReason(reason: StopReason | null): LlmStopReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'complete';
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      return 'other';
  }
}

/** Anthropic sends retry-after in seconds; other formats are ignored. */
function parseRetryAfter(value: string | null | undefined): number | undefined {
  const seconds = Number(value);
  return value && Number.isFinite(seconds) && seconds >= 0
    ? Math.ceil(seconds)
    : undefined;
}
