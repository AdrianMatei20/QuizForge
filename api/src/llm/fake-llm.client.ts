import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type LlmClient,
  LlmProviderError,
  type LlmRequest,
  type LlmResponse,
  type LlmStopReason,
  type LlmStreamEvent,
  type LlmUsage,
} from './llm-client.js';

/** api/test/fixtures/llm, from both src/llm and dist/llm. */
export const DEFAULT_FIXTURES_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  'test',
  'fixtures',
  'llm',
);

export type FakeFailure = 'rate_limited' | 'server' | 'timeout' | 'bad_request';

export interface FakeFailureOptions {
  /** Simulates a Retry-After header on the error. */
  retryAfterSeconds?: number;
}

type Step =
  | { kind: 'fail'; failure: FakeFailure; retryAfterSeconds?: number }
  | {
      kind: 'respond';
      text: string;
      usage?: LlmUsage;
      stopReason?: LlmStopReason;
    }
  | { kind: 'fixture'; name: string; chunkDelayMs?: number };

const FAILURES: Record<
  FakeFailure,
  (options: { retryAfterSeconds?: number }) => LlmProviderError
> = {
  rate_limited: (options) =>
    new LlmProviderError('rate_limited', 'Fake 429', {
      status: 429,
      ...options,
    }),
  server: (options) =>
    new LlmProviderError('server', 'Fake 500', { status: 500, ...options }),
  timeout: () => new LlmProviderError('timeout', 'Fake timeout'),
  bad_request: () =>
    new LlmProviderError('client', 'Fake 400', { status: 400 }),
};

/**
 * A deterministic, offline LlmClient used by every test and by
 * LLM_PROVIDER=fake. By default it answers with the fixture
 * <fixturesDir>/<promptId>/default.txt. Tests queue one-off behaviour for the
 * next calls (failures, specific text, other fixtures); each queued step is
 * used by exactly one call, in order.
 */
export class FakeLlmClient implements LlmClient {
  /** Every request received, in order, for assertions. */
  readonly requests: LlmRequest[] = [];
  private readonly steps: Step[] = [];
  private streamChunkSize: number | undefined;

  constructor(
    private readonly options: { fixturesDir?: string; chunkSize?: number } = {},
  ) {}

  /**
   * The next `count` calls throw the given provider error. Timeouts fail at
   * once, without waiting. `retryAfterSeconds` applies to rate_limited and server.
   */
  failNext(
    count: number,
    failure: FakeFailure,
    options: FakeFailureOptions = {},
  ): this {
    for (let i = 0; i < count; i++) {
      this.steps.push({ kind: 'fail', failure, ...options });
    }
    return this;
  }

  /** The next call returns this text, with the given usage (or an estimate) and stop reason (default complete). */
  respondNext(
    text: string,
    usage?: LlmUsage,
    stopReason?: LlmStopReason,
  ): this {
    this.steps.push({
      kind: 'respond',
      text,
      ...(usage ? { usage } : {}),
      ...(stopReason ? { stopReason } : {}),
    });
    return this;
  }

  /**
   * The next call returns <fixturesDir>/<promptId>/<name>.txt. When streamed,
   * `chunkDelayMs` waits between chunks, to simulate a slow model.
   */
  respondWithFixture(
    name: string,
    options: { chunkDelayMs?: number } = {},
  ): this {
    this.steps.push({ kind: 'fixture', name, ...options });
    return this;
  }

  /** Characters per streamed chunk. Small values exercise lines split across chunks. */
  get chunkSize(): number {
    return this.streamChunkSize ?? this.options.chunkSize ?? 8;
  }

  set chunkSize(size: number) {
    this.streamChunkSize = size;
  }

  /** The next call returns text that is not JSON at all. */
  nextMalformedJson(): this {
    return this.respondNext('{"questions": [ {"text": "Unfinished');
  }

  /** The next call returns valid JSON that matches no real schema. */
  nextOffSchema(): this {
    return this.respondNext('{"unexpected":true}');
  }

  /** The next call is a refusal (stop reason "refusal"). */
  nextRefusal(): this {
    return this.respondNext("I can't help with that.", undefined, 'refusal');
  }

  /** The next call is cut off by the token limit (stop reason "max_tokens"). */
  nextTruncated(): this {
    return this.respondNext(
      '{"questions":[{"text":"Cut off mid',
      undefined,
      'max_tokens',
    );
  }

  generate(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request);
    try {
      return Promise.resolve(this.answer(request));
    } catch (error) {
      return Promise.reject(error as Error);
    }
  }

  async *stream(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
    const delayMs = this.peekChunkDelay();
    const response = await this.generate(request);
    yield { type: 'start', inputTokens: response.usage.inputTokens };
    const chunkSize = this.chunkSize;
    for (let i = 0; i < response.text.length; i += chunkSize) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        request.signal?.throwIfAborted();
      }
      yield { type: 'text', text: response.text.slice(i, i + chunkSize) };
    }
    yield {
      type: 'done',
      usage: response.usage,
      stopReason: response.stopReason,
    };
  }

  private peekChunkDelay(): number {
    const next = this.steps[0];
    return next?.kind === 'fixture' ? (next.chunkDelayMs ?? 0) : 0;
  }

  private answer(request: LlmRequest): LlmResponse {
    request.signal?.throwIfAborted();
    const step = this.steps.shift() ?? { kind: 'fixture', name: 'default' };
    if (step.kind === 'fail') {
      throw FAILURES[step.failure](
        step.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: step.retryAfterSeconds },
      );
    }
    const text =
      step.kind === 'respond'
        ? step.text
        : this.readFixture(request.promptId, step.name);
    const usage =
      (step.kind === 'respond' ? step.usage : undefined) ??
      estimateUsage(request, text);
    const stopReason =
      (step.kind === 'respond' ? step.stopReason : undefined) ?? 'complete';
    return { text, usage, stopReason };
  }

  private readFixture(promptId: string, name: string): string {
    const path = join(
      this.options.fixturesDir ?? DEFAULT_FIXTURES_DIR,
      promptId,
      `${name}.txt`,
    );
    try {
      return readFileSync(path, 'utf8');
    } catch (error) {
      throw new Error(`FakeLlmClient has no fixture at ${path}`, {
        cause: error,
      });
    }
  }
}

/** Roughly 4 characters per token: deterministic, and close enough for cost tests. */
function estimateUsage(request: LlmRequest, output: string): LlmUsage {
  const inputChars =
    (request.system?.length ?? 0) +
    request.messages.reduce((sum, message) => sum + message.content.length, 0);
  return {
    inputTokens: Math.ceil(inputChars / 4),
    outputTokens: Math.ceil(output.length / 4),
  };
}
