import { z } from 'zod';
import { AnthropicLlmClient, toStopReason } from './anthropic-llm.client.js';
import {
  LlmProviderError,
  type LlmRequest,
  type LlmStreamEvent,
} from './llm-client.js';

// Every test injects `fetch`, so nothing ever reaches the network.
type FetchInput = string | URL | Request;
type FetchArgs = [url: FetchInput, init: RequestInit | undefined];

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const message = {
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-test',
  content: [
    { type: 'thinking', thinking: 'internal', signature: 'sig' },
    { type: 'text', text: '{"answer":' },
    { type: 'text', text: '42}' },
  ],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 120, output_tokens: 30 },
};

const request: LlmRequest = {
  promptId: 'test-quiz',
  model: 'claude-test',
  system: 'You answer in JSON.',
  messages: [{ role: 'user', content: 'What is the answer?' }],
  maxTokens: 256,
  outputSchema: z.object({ answer: z.number().int().min(0) }),
  timeoutMs: 5_000,
};

function clientReturning(response: () => Response | Promise<Response>) {
  const calls: FetchArgs[] = [];
  const fetch = (url: FetchInput, init?: RequestInit) => {
    calls.push([url, init]);
    return Promise.resolve(response());
  };
  return {
    client: new AnthropicLlmClient({ apiKey: 'test-key', fetch }),
    calls,
  };
}

function sentBody(calls: FetchArgs[]): Record<string, unknown> {
  return JSON.parse(calls[0]?.[1]?.body as string) as Record<string, unknown>;
}

function errorBody(type: string) {
  return {
    type: 'error',
    error: { type, message: 'details from the provider' },
  };
}

describe('AnthropicLlmClient', () => {
  describe('generate', () => {
    it('returns the joined text blocks and the usage', async () => {
      const { client } = clientReturning(() => jsonResponse(200, message));

      const response = await client.generate(request);

      expect(response).toEqual({
        text: '{"answer":42}',
        usage: { inputTokens: 120, outputTokens: 30 },
        stopReason: 'complete',
      });
    });

    it('asks for structured output with a JSON schema built from the zod schema', async () => {
      const { client, calls } = clientReturning(() =>
        jsonResponse(200, message),
      );

      await client.generate(request);

      expect(calls[0]?.[0]).toMatch(/\/v1\/messages$/);
      const body = sentBody(calls);
      expect(body).toMatchObject({
        model: 'claude-test',
        max_tokens: 256,
        system: 'You answer in JSON.',
        messages: [{ role: 'user', content: 'What is the answer?' }],
        output_config: {
          format: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: { answer: { type: 'integer' } },
              required: ['answer'],
              additionalProperties: false,
            },
          },
        },
      });
      expect(body).not.toHaveProperty('temperature');
    });

    it('sends effort in output_config, next to the format', async () => {
      const { client, calls } = clientReturning(() =>
        jsonResponse(200, message),
      );

      await client.generate({ ...request, effort: 'low' });

      expect(sentBody(calls)).toMatchObject({
        output_config: { effort: 'low', format: { type: 'json_schema' } },
      });
    });

    it('sends effort alone when there is no output schema', async () => {
      const { client, calls } = clientReturning(() =>
        jsonResponse(200, message),
      );
      const { outputSchema: _schema, ...plain } = request;

      await client.generate({ ...plain, effort: 'high' });

      expect(sentBody(calls)).toMatchObject({
        output_config: { effort: 'high' },
      });
      expect(sentBody(calls)).not.toHaveProperty('output_config.format');
    });

    it('omits output_config and system when they are not set', async () => {
      const { client, calls } = clientReturning(() =>
        jsonResponse(200, message),
      );
      const { outputSchema: _schema, system: _system, ...plain } = request;

      await client.generate(plain);

      expect(sentBody(calls)).not.toHaveProperty('output_config');
      expect(sentBody(calls)).not.toHaveProperty('system');
    });

    it('sends the API key and makes exactly one request (SDK retries are off)', async () => {
      const { client, calls } = clientReturning(() =>
        jsonResponse(500, errorBody('api_error')),
      );

      await expect(client.generate(request)).rejects.toBeInstanceOf(
        LlmProviderError,
      );
      expect(calls).toHaveLength(1);
      expect(new Headers(calls[0]?.[1]?.headers).get('x-api-key')).toBe(
        'test-key',
      );
    });
  });

  describe('error mapping', () => {
    it.each([
      [500, 'api_error', 'server'],
      [529, 'overloaded_error', 'server'],
      [400, 'invalid_request_error', 'client'],
      [401, 'authentication_error', 'client'],
      [404, 'not_found_error', 'client'],
    ] as const)('maps %d %s to %s', async (status, type, kind) => {
      const { client } = clientReturning(() =>
        jsonResponse(status, errorBody(type)),
      );

      const error = await client
        .generate(request)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(LlmProviderError);
      expect(error).toMatchObject({ kind, status });
    });

    it('maps 429 to rate_limited and reads retry-after', async () => {
      const { client } = clientReturning(() =>
        jsonResponse(429, errorBody('rate_limit_error'), {
          'retry-after': '12',
        }),
      );

      await expect(client.generate(request)).rejects.toMatchObject({
        kind: 'rate_limited',
        status: 429,
        retryAfterSeconds: 12,
      });
    });

    it('reads retry-after on a 5xx as well', async () => {
      const { client } = clientReturning(() =>
        jsonResponse(529, errorBody('overloaded_error'), {
          'retry-after': '3',
        }),
      );

      await expect(client.generate(request)).rejects.toMatchObject({
        kind: 'server',
        status: 529,
        retryAfterSeconds: 3,
      });
    });

    it('ignores a retry-after that is not a number of seconds', async () => {
      const { client } = clientReturning(() =>
        jsonResponse(429, errorBody('rate_limit_error'), {
          'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT',
        }),
      );

      const error = await client.generate(request).catch((e: unknown) => e);

      expect((error as LlmProviderError).retryAfterSeconds).toBeUndefined();
    });

    it('maps a connection failure to server', async () => {
      const { client } = clientReturning(() => {
        throw new TypeError('fetch failed');
      });

      await expect(client.generate(request)).rejects.toMatchObject({
        kind: 'server',
      });
    });

    it('maps the per-call timeout to timeout', async () => {
      const client = new AnthropicLlmClient({
        apiKey: 'test-key',
        fetch: hangUntilAborted,
      });

      await expect(
        client.generate({ ...request, timeoutMs: 20 }),
      ).rejects.toMatchObject({
        kind: 'timeout',
      });
    });

    it('maps the caller aborting to aborted', async () => {
      const client = new AnthropicLlmClient({
        apiKey: 'test-key',
        fetch: hangUntilAborted,
      });
      const controller = new AbortController();

      const pending = client.generate({
        ...request,
        signal: controller.signal,
      });
      controller.abort();

      await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
    });

    it('does not put the prompt in the error message', async () => {
      const { client } = clientReturning(() =>
        jsonResponse(400, errorBody('invalid_request_error')),
      );

      const error = (await client
        .generate(request)
        .catch((e: unknown) => e)) as Error;

      expect(error.message).toBe('Anthropic request failed with status 400');
    });
  });

  describe('stop reasons', () => {
    it.each([
      ['end_turn', 'complete'],
      ['stop_sequence', 'complete'],
      ['max_tokens', 'max_tokens'],
      ['model_context_window_exceeded', 'max_tokens'],
      ['refusal', 'refusal'],
      ['tool_use', 'other'],
      ['pause_turn', 'other'],
      [null, 'other'],
    ] as const)('maps %s to %s', (anthropic, neutral) => {
      expect(toStopReason(anthropic)).toBe(neutral);
    });

    it('returns the mapped stop reason from generate', async () => {
      const { client } = clientReturning(() =>
        jsonResponse(200, { ...message, stop_reason: 'refusal' }),
      );

      await expect(client.generate(request)).resolves.toMatchObject({
        stopReason: 'refusal',
      });
    });
  });

  describe('stream', () => {
    it('yields text deltas, then the final usage', async () => {
      const { client, calls } = clientReturning(
        () =>
          new Response(sse(streamEvents), {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          }),
      );

      const events: LlmStreamEvent[] = [];
      for await (const event of client.stream(request)) {
        events.push(event);
      }

      expect(sentBody(calls)).toMatchObject({ stream: true });
      expect(events).toEqual([
        // From message_start: the input tokens are known before any text.
        { type: 'start', inputTokens: 12 },
        { type: 'text', text: '{"answer"' },
        { type: 'text', text: ':42}' },
        {
          type: 'done',
          usage: { inputTokens: 12, outputTokens: 7 },
          stopReason: 'complete',
        },
      ]);
    });

    it('maps stream errors like generate errors', async () => {
      const { client } = clientReturning(() =>
        jsonResponse(429, errorBody('rate_limit_error')),
      );

      const consume = async () => {
        for await (const _event of client.stream(request)) {
          // drain
        }
      };

      await expect(consume()).rejects.toMatchObject({ kind: 'rate_limited' });
    });
  });
});

function hangUntilAborted(
  _url: FetchInput,
  init?: RequestInit,
): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () =>
      reject(new DOMException('The operation was aborted.', 'AbortError')),
    );
  });
}

const streamEvents = [
  {
    type: 'message_start',
    message: {
      ...message,
      content: [],
      stop_reason: null,
      usage: { input_tokens: 12, output_tokens: 1 },
    },
  },
  {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  },
  {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: '{"answer"' },
  },
  {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: ':42}' },
  },
  { type: 'content_block_stop', index: 0 },
  {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 7 },
  },
  { type: 'message_stop' },
];

function sse(events: { type: string }[]): string {
  return events
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('');
}
