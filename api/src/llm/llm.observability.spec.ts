import { SpanStatusCode, trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { createTestLlmService, quizRequest } from '../../test/support/llm.js';
import type { LlmMetrics } from '../metrics/llm-metrics.js';
import type { LlmStreamRequest } from './llm.service.js';

const VALID =
  '{"questions":[{"text":"What is the powerhouse of the cell?","answer":"Mitochondria"}]}';

/**
 * The value of one series, e.g. llm_requests_total{feature="x",status="ok"}.
 * A histogram's _count/_sum/_bucket series live inside the histogram metric.
 */
async function valueOf(
  metrics: LlmMetrics,
  name: string,
  labels: Record<string, string>,
): Promise<number | undefined> {
  const base = name.replace(/_(count|sum|bucket)$/, '');
  const metric = (await metrics.registry.getMetricsAsJSON()).find(
    (candidate) => candidate.name === name || candidate.name === base,
  );
  return metric?.values.find(
    (value) =>
      ((value as { metricName?: string }).metricName ?? metric.name) === name &&
      Object.entries(labels).every(
        ([key, expected]) => value.labels[key] === expected,
      ),
  )?.value;
}

describe('LlmService metrics', () => {
  it('counts a successful call with its latency, tokens and cost', async () => {
    const { service, client, metrics } = createTestLlmService();
    client.respondNext(VALID, { inputTokens: 1_000, outputTokens: 500 });

    await service.generate(quizRequest());

    const feature = 'test-feature';
    expect(
      await valueOf(metrics, 'llm_requests_total', { feature, status: 'ok' }),
    ).toBe(1);
    expect(
      await valueOf(metrics, 'llm_tokens_total', {
        feature,
        direction: 'input',
      }),
    ).toBe(1_000);
    expect(
      await valueOf(metrics, 'llm_tokens_total', {
        feature,
        direction: 'output',
      }),
    ).toBe(500);
    // test-model: $2/M input + $10/M output.
    expect(
      await valueOf(metrics, 'llm_cost_usd_total', { feature }),
    ).toBeCloseTo(0.007, 9);
    expect(
      await valueOf(metrics, 'llm_latency_seconds_count', { feature }),
    ).toBe(1);
  });

  it('labels a failed call with its status, and a cache hit as ok without tokens', async () => {
    const { service, client, metrics } = createTestLlmService();
    client.nextOffSchema().nextOffSchema();
    await service
      .generate(quizRequest({ cache: false }))
      .catch(() => undefined);
    await service.generate(quizRequest());
    await service.generate(quizRequest()); // cache hit

    const feature = 'test-feature';
    expect(
      await valueOf(metrics, 'llm_requests_total', {
        feature,
        status: 'invalid_output',
      }),
    ).toBe(1);
    expect(
      await valueOf(metrics, 'llm_requests_total', { feature, status: 'ok' }),
    ).toBe(2);
    expect(
      await valueOf(metrics, 'llm_latency_seconds_count', { feature }),
    ).toBe(3);
  });

  it('counts streamed calls too', async () => {
    const { service, client, metrics } = createTestLlmService();
    client.respondNext('a line\n', { inputTokens: 10, outputTokens: 3 });

    for await (const event of service.stream({
      feature: 'test-stream',
      promptId: 'test-quiz',
      promptVersion: 1,
      variables: { count: 1, lesson: 'x' },
      maxTokens: 100,
    })) {
      void event;
    }

    expect(
      await valueOf(metrics, 'llm_requests_total', {
        feature: 'test-stream',
        status: 'ok',
      }),
    ).toBe(1);
    expect(
      await valueOf(metrics, 'llm_tokens_total', {
        feature: 'test-stream',
        direction: 'output',
      }),
    ).toBe(3);
  });
});

describe('LlmService llm.generate span', () => {
  const exporter = new InMemorySpanExporter();

  beforeAll(() => {
    trace.setGlobalTracerProvider(
      new BasicTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      }),
    );
  });

  afterAll(() => {
    trace.disable();
  });

  beforeEach(() => exporter.reset());

  it('wraps each call in an llm.generate span with the call attributes', async () => {
    const { service, client } = createTestLlmService();
    client.respondNext(VALID, { inputTokens: 1_000, outputTokens: 500 });

    await service.generate(quizRequest());

    const [span] = exporter.getFinishedSpans();
    expect(span?.name).toBe('llm.generate');
    expect(span?.attributes).toMatchObject({
      'llm.feature': 'test-feature',
      'llm.model': 'test-model',
      'llm.prompt_version': 1,
      'llm.input_tokens': 1_000,
      'llm.output_tokens': 500,
      'llm.cache_hit': false,
      'llm.attempts': 1,
      'llm.status': 'ok',
    });
    expect(span?.status.code).not.toBe(SpanStatusCode.ERROR);
  });

  it('marks a failed call as an error without the error message', async () => {
    const { service, client } = createTestLlmService();
    client.nextOffSchema().nextOffSchema();

    await service.generate(quizRequest()).catch(() => undefined);

    const [span] = exporter.getFinishedSpans();
    expect(span?.status).toEqual({
      code: SpanStatusCode.ERROR,
      message: 'invalid_output',
    });
    expect(span?.attributes['llm.attempts']).toBe(2);
    expect(span?.events).toEqual([]);
  });

  it('ends exactly one span for a cache hit, marked as such', async () => {
    const { service } = createTestLlmService();
    await service.generate(quizRequest());
    exporter.reset();

    await service.generate(quizRequest());

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.attributes).toMatchObject({
      'llm.cache_hit': true,
      'llm.attempts': 0,
    });
  });
});

describe('LlmService estimated stream usage', () => {
  const streamRequest = (signal?: AbortSignal): LlmStreamRequest => ({
    feature: 'test-stream',
    promptId: 'test-quiz',
    promptVersion: 1,
    variables: { count: 1, lesson: 'Plants turn sunlight into energy.' },
    maxTokens: 100,
    ...(signal ? { signal } : {}),
  });

  it('estimates the usage of a stream aborted before the provider reported it', async () => {
    const { service, client, store } = createTestLlmService();
    client.chunkSize = 4;
    // The provider reports 1,234 input tokens up front (the start event).
    client.respondNext('0123456789abcdef', {
      inputTokens: 1_234,
      outputTokens: 999,
    });
    const controller = new AbortController();
    let received = '';

    await (async () => {
      for await (const event of service.stream(
        streamRequest(controller.signal),
      )) {
        if (event.type === 'text') {
          received += event.text;
          if (received.length >= 8) controller.abort();
        }
      }
    })().catch(() => undefined);

    expect(received).toBe('01234567');
    expect(store.rows).toEqual([
      expect.objectContaining({
        status: 'error',
        errorCode: 'aborted',
        usageEstimated: true,
        // From the start event, not estimated.
        inputTokens: 1_234,
        // 8 characters received, at about 4 characters per token.
        outputTokens: 2,
        // test-model: 1,234 * $2/M + 2 * $10/M = $0.002488.
        costUsd: '0.002488',
      }),
    ]);
  });

  it('does not mark a completed stream as estimated', async () => {
    const { service, client, store } = createTestLlmService();
    client.respondNext('line\n', { inputTokens: 10, outputTokens: 2 });

    for await (const event of service.stream(streamRequest())) {
      void event;
    }

    expect(store.rows[0]).toMatchObject({
      usageEstimated: false,
      inputTokens: 10,
    });
  });

  it('records no usage at all when the budget guard stopped the call first', async () => {
    const { service, store } = createTestLlmService({ dailyBudgetUsd: '0.00' });

    await (async () => {
      for await (const event of service.stream(streamRequest())) {
        void event;
      }
    })().catch(() => undefined);

    expect(store.rows[0]).toMatchObject({
      status: 'budget_exceeded',
      usageEstimated: false,
      inputTokens: 0,
      outputTokens: 0,
    });
  });
});
