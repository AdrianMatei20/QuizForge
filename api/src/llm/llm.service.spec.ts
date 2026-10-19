import {
  createTestLlmService,
  type Quiz,
  quizRequest,
} from '../../test/support/llm.js';
import { buildCacheKey } from './llm-cache.js';
import {
  LlmBudgetExceededError,
  LlmInvalidOutputError,
  LlmOutputTruncatedError,
  LlmRateLimitedError,
  LlmRefusalError,
  LlmTimeoutError,
  LlmUpstreamError,
} from './llm.errors.js';
import type { LlmServiceStreamEvent, LlmStreamRequest } from './llm.service.js';

const VALID_ONE_QUESTION =
  '{"questions":[{"text":"What is the powerhouse of the cell?","answer":"Mitochondria"}]}';

describe('LlmService.generate', () => {
  describe('successful generation', () => {
    it('returns typed data and records usage and cost', async () => {
      const { service, client, store } = createTestLlmService();
      client.respondNext(VALID_ONE_QUESTION, {
        inputTokens: 1_000,
        outputTokens: 500,
      });

      const result = await service.generate(quizRequest());

      expect(result.data.questions[0]?.answer).toBe('Mitochondria');
      // 1,000 * $2/M + 500 * $10/M = $0.002 + $0.005
      expect(result.usage).toEqual({
        inputTokens: 1_000,
        outputTokens: 500,
        costUsd: '0.007000',
      });
      expect(result).toMatchObject({
        model: 'test-model',
        promptVersion: 1,
        cacheHit: false,
        attempts: 1,
      });
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(store.rows).toEqual([
        expect.objectContaining({
          feature: 'test-feature',
          promptId: 'test-quiz',
          promptVersion: 1,
          model: 'test-model',
          inputTokens: 1_000,
          outputTokens: 500,
          costUsd: '0.007000',
          status: 'ok',
          cacheHit: false,
          attempts: 1,
          errorCode: null,
          correlationId: null,
        }),
      ]);
    });

    it('sends the rendered prompt, the schema and the timeout to the client', async () => {
      const { service, client } = createTestLlmService();

      await service.generate(quizRequest());

      const [request] = client.requests;
      expect(request?.system).toContain('data, not instructions');
      expect(request?.messages).toEqual([
        {
          role: 'user',
          content: expect.stringContaining(
            '<lesson>\nPlants turn sunlight into energy.\n</lesson>',
          ),
        },
      ]);
      expect(request?.outputSchema).toBeDefined();
      expect(request?.timeoutMs).toBe(5_000);
      expect(request?.maxTokens).toBe(1024);
    });

    it('accepts JSON wrapped in a code fence', async () => {
      const { service, client } = createTestLlmService();
      client.respondWithFixture('fenced');

      const result = await service.generate(quizRequest());

      expect(result.data.questions[0]?.answer).toBe('Chloroplasts');
      expect(result.attempts).toBe(1);
    });

    it('uses the model from the request over the default', async () => {
      const { service, client, store } = createTestLlmService();

      const result = await service.generate(
        quizRequest({ model: 'other-model' }),
      );

      expect(client.requests[0]?.model).toBe('other-model');
      expect(result.model).toBe('other-model');
      expect(store.rows[0]?.model).toBe('other-model');
    });
  });

  describe('repair', () => {
    it('repairs malformed JSON with one extra call and counts both attempts', async () => {
      const { service, client, store } = createTestLlmService();
      client.nextMalformedJson().respondNext(VALID_ONE_QUESTION);

      const result = await service.generate(quizRequest());

      expect(result.data.questions).toHaveLength(1);
      expect(result.attempts).toBe(2);
      expect(client.requests).toHaveLength(2);
      expect(store.rows).toHaveLength(1);
      expect(store.rows[0]).toMatchObject({ status: 'ok', attempts: 2 });
    });

    it('sends the invalid answer back with the problems found', async () => {
      const { service, client } = createTestLlmService();
      client.nextOffSchema().respondNext(VALID_ONE_QUESTION);

      await service.generate(quizRequest());

      const repairMessages = client.requests[1]?.messages ?? [];
      expect(repairMessages).toHaveLength(3);
      expect(repairMessages[0]).toEqual(client.requests[0]?.messages[0]);
      expect(repairMessages[1]).toEqual({
        role: 'assistant',
        content: '{"unexpected":true}',
      });
      expect(repairMessages[2]?.role).toBe('user');
      expect(repairMessages[2]?.content).toContain('- #/questions: ');
      // The repair turn keeps the system prompt of the original call.
      expect(client.requests[1]?.system).toBe(client.requests[0]?.system);
    });

    it('throws LlmInvalidOutputError after two off-schema answers and records one invalid_output row', async () => {
      const { service, client, store } = createTestLlmService();
      client.nextOffSchema().nextOffSchema();

      const error = await service
        .generate(quizRequest())
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(LlmInvalidOutputError);
      expect((error as LlmInvalidOutputError).violations).toEqual([
        { pointer: '#/questions', message: expect.any(String) },
      ]);
      expect(client.requests).toHaveLength(2);
      expect(store.rows).toHaveLength(1);
      expect(store.rows[0]).toMatchObject({
        status: 'invalid_output',
        attempts: 2,
        errorCode: null,
      });
      // Tokens spent on rejected output still count against the budget.
      expect(store.rows[0]?.inputTokens).toBeGreaterThan(0);
    });

    it('puts rule violations in the repair prompt', async () => {
      const { service, client } = createTestLlmService();
      const twoQuestions = (quiz: Quiz) =>
        quiz.questions.length === 2
          ? []
          : [`Expected exactly 2 questions, got ${quiz.questions.length}`];
      client.respondNext(VALID_ONE_QUESTION); // schema-valid, breaks the rule

      const result = await service.generate(
        quizRequest({ rules: twoQuestions }),
      );

      expect(result.data.questions).toHaveLength(2); // the default fixture, on repair
      expect(client.requests[1]?.messages[2]?.content).toContain(
        '- Expected exactly 2 questions, got 1',
      );
    });

    it('rejects output that still breaks a rule after the repair', async () => {
      const { service, client } = createTestLlmService();
      client.respondNext(VALID_ONE_QUESTION).respondNext(VALID_ONE_QUESTION);

      const error = await service
        .generate(quizRequest({ rules: () => ['Always wrong'] }))
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(LlmInvalidOutputError);
      expect((error as LlmInvalidOutputError).violations).toEqual([
        { message: 'Always wrong' },
      ]);
    });
  });

  describe('retries', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('retries 429, 429, then succeeds after full-jitter backoff (3 attempts)', async () => {
      vi.useFakeTimers();
      // Real setTimeout-based sleep, so the fake timers control it.
      const { service, client } = createTestLlmService({
        random: () => 0.5,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      });
      client.failNext(2, 'rate_limited');

      const pending = service.generate(quizRequest());

      // Attempt 1 fails at once. Next delay: 0.5 * min(8000, 500 * 2^0) = 250ms.
      await vi.advanceTimersByTimeAsync(0);
      expect(client.requests).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(249);
      expect(client.requests).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(client.requests).toHaveLength(2);

      // Attempt 2 fails. Next delay: 0.5 * min(8000, 500 * 2^1) = 500ms.
      await vi.advanceTimersByTimeAsync(499);
      expect(client.requests).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(client.requests).toHaveLength(3);

      const result = await pending;
      expect(result.attempts).toBe(3);
      expect(result.data.questions).toHaveLength(2);
    });

    it('does not retry a 400', async () => {
      const { service, client, store } = createTestLlmService();
      client.failNext(1, 'bad_request');

      await expect(service.generate(quizRequest())).rejects.toBeInstanceOf(
        LlmUpstreamError,
      );
      expect(client.requests).toHaveLength(1);
      expect(store.rows[0]).toMatchObject({
        status: 'error',
        errorCode: 'upstream_error',
        attempts: 1,
      });
    });

    it('gives up after 3 rate-limited attempts with LlmRateLimitedError', async () => {
      const { service, client, store } = createTestLlmService();
      client.failNext(3, 'rate_limited', { retryAfterSeconds: 7 });

      const error = await service
        .generate(quizRequest())
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(LlmRateLimitedError);
      // The provider's Retry-After is passed on to our client.
      expect((error as LlmRateLimitedError).retryAfterSeconds).toBe(7);
      expect(client.requests).toHaveLength(3);
      expect(store.rows[0]).toMatchObject({
        errorCode: 'rate_limited',
        attempts: 3,
      });
    });

    it('gives up after 3 timeouts with LlmTimeoutError', async () => {
      const { service, client } = createTestLlmService();
      client.failNext(3, 'timeout');

      await expect(service.generate(quizRequest())).rejects.toBeInstanceOf(
        LlmTimeoutError,
      );
      expect(client.requests).toHaveLength(3);
    });

    it('retries a 500 and recovers', async () => {
      const { service, client } = createTestLlmService();
      client.failNext(1, 'server');

      const result = await service.generate(quizRequest());

      expect(result.attempts).toBe(2);
    });

    it('gives the repair call its own retry budget', async () => {
      const { service, client } = createTestLlmService();
      client.nextMalformedJson().failNext(2, 'server');

      const result = await service.generate(quizRequest());

      // 1 malformed + 2 failed repairs + 1 successful repair
      expect(result.attempts).toBe(4);
    });

    it('stops without calling the client when the signal is already aborted', async () => {
      const { service, client, store } = createTestLlmService();
      const controller = new AbortController();
      controller.abort();

      await expect(
        service.generate(quizRequest({ signal: controller.signal })),
      ).rejects.toThrow();
      expect(client.requests).toHaveLength(0);
      expect(store.rows[0]).toMatchObject({
        status: 'error',
        errorCode: 'aborted',
      });
    });

    it('tells our client to retry after 30 s when the provider sends no Retry-After', async () => {
      const { service, client } = createTestLlmService();
      client.failNext(3, 'rate_limited');

      const error = await service
        .generate(quizRequest())
        .catch((caught: unknown) => caught);

      expect((error as LlmRateLimitedError).retryAfterSeconds).toBe(30);
    });
  });

  describe('Retry-After', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    /** random() = 0.5, so the first jittered delay alone would be 250 ms. */
    function serviceWithRealSleep(maxRetryAfterMs = 5_000) {
      vi.useFakeTimers();
      return createTestLlmService({
        random: () => 0.5,
        maxRetryAfterMs,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      });
    }

    it('waits at least the Retry-After of a 429 before the next attempt', async () => {
      const { service, client } = serviceWithRealSleep();
      client.failNext(1, 'rate_limited', { retryAfterSeconds: 2 });

      const pending = service.generate(quizRequest());

      await vi.advanceTimersByTimeAsync(1_999);
      expect(client.requests).toHaveLength(1); // jitter alone would have retried at 250 ms
      await vi.advanceTimersByTimeAsync(1);
      expect(client.requests).toHaveLength(2);
      await expect(pending).resolves.toMatchObject({ attempts: 2 });
    });

    it('honours Retry-After on a 5xx too', async () => {
      const { service, client } = serviceWithRealSleep();
      client.failNext(1, 'server', { retryAfterSeconds: 1 });

      const pending = service.generate(quizRequest());

      await vi.advanceTimersByTimeAsync(999);
      expect(client.requests).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(client.requests).toHaveLength(2);
      await pending;
    });

    it('caps a long Retry-After at LLM_RETRY_AFTER_MAX_MS', async () => {
      const { service, client } = serviceWithRealSleep(3_000);
      client.failNext(1, 'rate_limited', { retryAfterSeconds: 60 });

      const pending = service.generate(quizRequest());

      await vi.advanceTimersByTimeAsync(2_999);
      expect(client.requests).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(client.requests).toHaveLength(2);
      await pending;
    });

    it('keeps full-jitter backoff when there is no Retry-After', async () => {
      const { service, client } = serviceWithRealSleep();
      client.failNext(1, 'rate_limited');

      const pending = service.generate(quizRequest());

      await vi.advanceTimersByTimeAsync(249);
      expect(client.requests).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(client.requests).toHaveLength(2);
      await pending;
    });
  });

  describe('refusals and truncation', () => {
    it('throws LlmRefusalError without a repair call and records status refused', async () => {
      const { service, client, store } = createTestLlmService();
      client.nextRefusal();

      await expect(service.generate(quizRequest())).rejects.toBeInstanceOf(
        LlmRefusalError,
      );
      expect(client.requests).toHaveLength(1);
      expect(store.rows).toEqual([
        expect.objectContaining({
          status: 'refused',
          attempts: 1,
          errorCode: null,
        }),
      ]);
      // The tokens of the refused call still count toward cost and budget.
      expect(store.rows[0]?.outputTokens).toBeGreaterThan(0);
    });

    it('throws LlmOutputTruncatedError without a repair call and records status truncated', async () => {
      const { service, client, store } = createTestLlmService();
      client.nextTruncated();

      const error = await service
        .generate(quizRequest({ maxTokens: 300 }))
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(LlmOutputTruncatedError);
      expect((error as LlmOutputTruncatedError).maxTokens).toBe(300);
      expect(client.requests).toHaveLength(1);
      expect(store.rows[0]).toMatchObject({ status: 'truncated', attempts: 1 });
    });

    it('rejects truncated output even when the text happens to parse', async () => {
      const { service, client } = createTestLlmService();
      client.respondNext(VALID_ONE_QUESTION, undefined, 'max_tokens');

      await expect(service.generate(quizRequest())).rejects.toBeInstanceOf(
        LlmOutputTruncatedError,
      );
    });

    it('stops at a refusal on the repair call', async () => {
      const { service, client, store } = createTestLlmService();
      client.nextOffSchema().nextRefusal();

      await expect(service.generate(quizRequest())).rejects.toBeInstanceOf(
        LlmRefusalError,
      );
      expect(client.requests).toHaveLength(2);
      expect(store.rows[0]).toMatchObject({ status: 'refused', attempts: 2 });
    });

    it('does not cache a refused response', async () => {
      const { service, client, cache } = createTestLlmService();
      client.nextRefusal();
      await service.generate(quizRequest()).catch(() => undefined);

      expect(cache.entries.size).toBe(0);
      await service.generate(quizRequest());
      expect(client.requests).toHaveLength(2);
    });
  });

  describe('cache', () => {
    it('returns a cache hit without calling the client and records it', async () => {
      const { service, client, store } = createTestLlmService();
      await service.generate(quizRequest());

      const second = await service.generate(quizRequest());

      expect(client.requests).toHaveLength(1);
      expect(second).toMatchObject({
        cacheHit: true,
        attempts: 0,
        usage: { inputTokens: 0, outputTokens: 0, costUsd: '0.000000' },
      });
      expect(second.data.questions).toHaveLength(2);
      expect(store.rows.map((row) => row.cacheHit)).toEqual([false, true]);
      expect(store.rows[1]).toMatchObject({
        status: 'ok',
        costUsd: '0.000000',
      });
    });

    it('stores entries with the configured TTL under the documented key', async () => {
      const { service, cache } = createTestLlmService({ cacheTtlSeconds: 42 });

      await service.generate(quizRequest());

      const key = buildCacheKey({
        feature: 'test-feature',
        promptId: 'test-quiz',
        promptVersion: 1,
        model: 'test-model',
        variables: { lesson: 'Plants turn sunlight into energy.', count: 2 },
      });
      expect(cache.entries.get(key)?.ttlSeconds).toBe(42);
    });

    it('skips the cache when the request opts out', async () => {
      const { service, client, cache } = createTestLlmService();
      await service.generate(quizRequest());

      const result = await service.generate(quizRequest({ cache: false }));

      expect(result.cacheHit).toBe(false);
      expect(client.requests).toHaveLength(2);
      expect(cache.entries.size).toBe(1);
    });

    it('misses when the variables differ', async () => {
      const { service, client } = createTestLlmService();
      await service.generate(quizRequest());

      await service.generate(
        quizRequest({
          variables: { count: 3, lesson: 'Plants turn sunlight into energy.' },
        }),
      );

      expect(client.requests).toHaveLength(2);
    });

    it('is disabled when the TTL is 0', async () => {
      const { service, client, cache } = createTestLlmService({
        cacheTtlSeconds: 0,
      });
      await service.generate(quizRequest());
      await service.generate(quizRequest());

      expect(client.requests).toHaveLength(2);
      expect(cache.entries.size).toBe(0);
    });

    it('keeps generating when the cache is down', async () => {
      const { service, cache } = createTestLlmService();
      cache.failing = true;

      const result = await service.generate(quizRequest());

      expect(result.cacheHit).toBe(false);
      expect(result.data.questions).toHaveLength(2);
    });

    it('ignores a cached entry that no longer passes the schema', async () => {
      const { service, client, cache } = createTestLlmService();
      await service.generate(quizRequest());
      const [key] = [...cache.entries.keys()];
      cache.entries.set(key ?? '', { value: '{"stale":true}', ttlSeconds: 60 });

      const result = await service.generate(quizRequest());

      expect(result.cacheHit).toBe(false);
      expect(client.requests).toHaveLength(2);
    });
  });

  describe('correlation id', () => {
    it('records the correlation id on a successful call', async () => {
      const { service, store } = createTestLlmService();

      await service.generate(quizRequest({ correlationId: 'quiz-1' }));

      expect(store.rows[0]?.correlationId).toBe('quiz-1');
    });

    it('records it on a cache hit and on a failed call too', async () => {
      const { service, client, store } = createTestLlmService();
      await service.generate(quizRequest({ correlationId: 'quiz-1' }));
      await service.generate(quizRequest({ correlationId: 'quiz-2' }));
      client.nextRefusal();

      await expect(
        service.generate(
          quizRequest({ correlationId: 'quiz-3', cache: false }),
        ),
      ).rejects.toBeInstanceOf(LlmRefusalError);

      expect(
        store.rows.map(({ correlationId, cacheHit, status }) => ({
          correlationId,
          cacheHit,
          status,
        })),
      ).toEqual([
        { correlationId: 'quiz-1', cacheHit: false, status: 'ok' },
        { correlationId: 'quiz-2', cacheHit: true, status: 'ok' },
        { correlationId: 'quiz-3', cacheHit: false, status: 'refused' },
      ]);
    });

    it('sums usage per correlation id, ignoring other ids and uncorrelated calls', async () => {
      const { service, client } = createTestLlmService();
      client
        .respondNext(VALID_ONE_QUESTION, {
          inputTokens: 1_000,
          outputTokens: 500,
        })
        .respondNext('not json', { inputTokens: 100, outputTokens: 10 })
        .respondNext(VALID_ONE_QUESTION, { inputTokens: 200, outputTokens: 20 })
        .respondNext(VALID_ONE_QUESTION, { inputTokens: 7, outputTokens: 7 });
      const request = (correlationId?: string) =>
        quizRequest({
          cache: false,
          ...(correlationId === undefined ? {} : { correlationId }),
        });

      await service.generate(request('quiz-1'));
      await service.generate(request('quiz-1')); // repaired: 2 attempts
      await service.generate(request());

      // test-model: $2 / M input, $10 / M output.
      expect(await service.getUsage('quiz-1')).toEqual({
        calls: 2,
        attempts: 3,
        inputTokens: 1_300,
        outputTokens: 530,
        costUsd: '0.007900',
      });
      expect(await service.getUsage('unknown')).toEqual({
        calls: 0,
        attempts: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: '0.000000',
      });
    });
  });

  describe('stream', () => {
    const streamRequest = (
      overrides: Partial<LlmStreamRequest> = {},
    ): LlmStreamRequest => ({
      feature: 'test-stream',
      promptId: 'test-quiz',
      promptVersion: 1,
      variables: { count: 2, lesson: 'Plants turn sunlight into energy.' },
      maxTokens: 1024,
      correlationId: 'quiz-1',
      ...overrides,
    });

    async function collect(events: AsyncIterable<LlmServiceStreamEvent>) {
      const collected: LlmServiceStreamEvent[] = [];
      for await (const event of events) {
        collected.push(event);
      }
      return collected;
    }

    it('streams the text in chunks, then done with usage, and records one llm_calls row', async () => {
      const { service, client, store } = createTestLlmService();
      client.chunkSize = 5;
      client.respondNext('line one\nline two\n', {
        inputTokens: 1_000,
        outputTokens: 500,
      });

      const events = await collect(service.stream(streamRequest()));

      const text = events
        .flatMap((event) => (event.type === 'text' ? [event.text] : []))
        .join('');
      expect(text).toBe('line one\nline two\n');
      expect(
        events.filter((event) => event.type === 'text').length,
      ).toBeGreaterThan(1);
      expect(events.at(-1)).toMatchObject({
        type: 'done',
        stopReason: 'complete',
        usage: { inputTokens: 1_000, outputTokens: 500, costUsd: '0.007000' },
        attempts: 1,
      });
      expect(store.rows).toEqual([
        expect.objectContaining({
          feature: 'test-stream',
          status: 'ok',
          inputTokens: 1_000,
          outputTokens: 500,
          costUsd: '0.007000',
          correlationId: 'quiz-1',
        }),
      ]);
      // Free text: no structured-output schema is sent with a stream.
      expect(client.requests[0]?.outputSchema).toBeUndefined();
    });

    it('runs the budget guard before any provider call', async () => {
      const { service, client, store } = createTestLlmService({
        dailyBudgetUsd: '0.00',
      });

      await expect(
        collect(service.stream(streamRequest())),
      ).rejects.toBeInstanceOf(LlmBudgetExceededError);
      expect(client.requests).toHaveLength(0);
      expect(store.rows).toEqual([
        expect.objectContaining({ status: 'budget_exceeded', attempts: 0 }),
      ]);
    });

    it('retries a failure before the first chunk', async () => {
      const { service, client, store } = createTestLlmService();
      client.failNext(1, 'server').respondNext('ok\n');

      const events = await collect(service.stream(streamRequest()));

      expect(events.at(-1)).toMatchObject({ type: 'done', attempts: 2 });
      expect(store.rows).toHaveLength(1);
    });

    it('throws LlmRefusalError on a refusal and records it', async () => {
      const { service, client, store } = createTestLlmService();
      client.nextRefusal();

      await expect(
        collect(service.stream(streamRequest())),
      ).rejects.toBeInstanceOf(LlmRefusalError);
      expect(store.rows).toEqual([
        expect.objectContaining({ status: 'refused' }),
      ]);
    });

    it('does not throw at the token limit, but records the call as truncated', async () => {
      const { service, client, store } = createTestLlmService();
      client.respondNext('{"a":1}\n{"b":', undefined, 'max_tokens');

      const events = await collect(service.stream(streamRequest()));

      expect(events.at(-1)).toMatchObject({
        type: 'done',
        stopReason: 'max_tokens',
      });
      expect(store.rows).toEqual([
        expect.objectContaining({ status: 'truncated' }),
      ]);
    });

    it('records one row when the consumer stops reading early', async () => {
      const { service, client, store } = createTestLlmService();
      client.chunkSize = 2;
      client.respondNext('a long answer that will not be read to the end');

      for await (const event of service.stream(streamRequest())) {
        expect(event.type).toBe('text');
        break;
      }

      expect(store.rows).toEqual([
        expect.objectContaining({ status: 'error', errorCode: 'aborted' }),
      ]);
    });

    it('stops when the signal is aborted mid-stream', async () => {
      const { service, client, store } = createTestLlmService();
      client.chunkSize = 1;
      client.respondNext('abcdef');
      const controller = new AbortController();
      const events: LlmServiceStreamEvent[] = [];

      const error = await (async () => {
        for await (const event of service.stream(
          streamRequest({ signal: controller.signal }),
        )) {
          events.push(event);
          controller.abort();
        }
      })().catch((caught: unknown) => caught);

      expect(events).toHaveLength(1);
      expect((error as Error).name).toBe('AbortError');
      expect(store.rows).toEqual([
        expect.objectContaining({ status: 'error', errorCode: 'aborted' }),
      ]);
    });
  });

  describe('budget', () => {
    it('throws LlmBudgetExceededError without calling the client', async () => {
      const { service, client, store } = createTestLlmService({
        dailyBudgetUsd: '0.01',
      });
      client.respondNext(VALID_ONE_QUESTION, {
        inputTokens: 0,
        outputTokens: 1_000, // exactly $0.01 at $10/M
      });
      await service.generate(quizRequest({ cache: false }));

      const error = await service
        .generate(quizRequest({ cache: false }))
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(LlmBudgetExceededError);
      // NOW is 15:00 UTC, so the budget resets in 9 hours.
      expect((error as LlmBudgetExceededError).retryAfterSeconds).toBe(
        9 * 3600,
      );
      expect(client.requests).toHaveLength(1);
      expect(store.rows[1]).toMatchObject({
        status: 'budget_exceeded',
        attempts: 0,
        costUsd: '0.000000',
      });
    });

    it('allows calls while spend is below the budget', async () => {
      const { service, client } = createTestLlmService({
        dailyBudgetUsd: '0.01',
      });
      client.respondNext(VALID_ONE_QUESTION, {
        inputTokens: 0,
        outputTokens: 999,
      });
      await service.generate(quizRequest({ cache: false }));

      await expect(
        service.generate(quizRequest({ cache: false })),
      ).resolves.toBeDefined();
    });

    it('only counts spend since UTC midnight', async () => {
      const { service, client, store } = createTestLlmService({
        dailyBudgetUsd: '0.01',
      });
      // Yesterday's spend alone is far over today's budget, but it no longer counts.
      store.rows.push({
        feature: 'f',
        promptId: 'p',
        promptVersion: 1,
        model: 'test-model',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: '5.000000',
        latencyMs: 1,
        status: 'ok',
        cacheHit: false,
        attempts: 1,
        errorCode: null,
        correlationId: null,
        usageEstimated: false,
        createdAt: new Date('2026-10-18T23:59:59.999Z'),
      });

      await service.generate(quizRequest());

      expect(client.requests).toHaveLength(1);
    });
  });

  it('records an error row when the prompt is missing a variable', async () => {
    const { service, client, store } = createTestLlmService();

    await expect(
      service.generate(quizRequest({ variables: { count: 2 } })),
    ).rejects.toThrow('missing variable "lesson"');
    expect(client.requests).toHaveLength(0);
    expect(store.rows[0]).toMatchObject({
      status: 'error',
      errorCode: 'unexpected',
    });
  });
});
