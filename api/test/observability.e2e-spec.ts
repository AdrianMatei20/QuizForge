import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Between, type Repository } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { GENERATE_THROTTLER } from '../src/common/throttling/rate-limit.guard.js';
import { LlmCall } from '../src/llm/llm-call.entity.js';
import type { LlmCallRecord } from '../src/llm/llm-call.store.js';
import { loadSampleLesson } from './support/lessons.js';

async function createApp(
  customize: (builder: TestingModuleBuilder) => TestingModuleBuilder = (b) => b,
): Promise<NestExpressApplication> {
  const moduleRef = await customize(
    Test.createTestingModule({ imports: [AppModule] }),
  ).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    logger: false,
  });
  configureApp(app);
  await app.init();
  return app;
}

describe('Observability (e2e)', () => {
  let app: NestExpressApplication;
  let calls: Repository<LlmCall>;

  beforeAll(async () => {
    app = await createApp();
    calls = app.get(getRepositoryToken(LlmCall));
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /metrics', () => {
    it('serves the LLM metrics and the default Node.js metrics in the Prometheus format', async () => {
      // One LLM call first, so the LLM series have values.
      const lesson = await request(app.getHttpServer())
        .post('/api/lessons')
        .send(loadSampleLesson('recursion'))
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/lessons/${(lesson.body as { id: string }).id}/quizzes`)
        .send({
          count: 5,
          difficulty: 'medium',
          types: ['multiple_choice', 'true_false'],
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get('/metrics')
        .expect(200);

      expect(response.headers['content-type']).toMatch(/^text\/plain/);
      expect(response.text).toContain(
        'llm_requests_total{feature="quiz-generation",status="ok"}',
      );
      expect(response.text).toMatch(
        /llm_latency_seconds_bucket\{le="0\.25",feature="quiz-generation"\}/,
      );
      expect(response.text).toContain(
        'llm_tokens_total{feature="quiz-generation",direction="input"}',
      );
      expect(response.text).toContain(
        'llm_cost_usd_total{feature="quiz-generation"}',
      );
      expect(response.text).toContain('process_cpu_user_seconds_total');
      expect(response.text).toContain('nodejs_eventloop_lag_seconds');
    });

    it('is served at the root, not under /api', async () => {
      await request(app.getHttpServer()).get('/api/metrics').expect(404);
    });
  });

  describe('GET /api/usage', () => {
    // Days far in the past, so rows from other tests never fall in range.
    const DAY_1 = '2001-02-03';
    const DAY_2 = '2001-02-04';

    const seed = (day: string, overrides: Partial<LlmCallRecord>) =>
      calls.save(
        calls.create({
          feature: 'quiz-generation',
          promptId: 'quiz',
          promptVersion: 1,
          model: 'fake-model',
          inputTokens: 100,
          outputTokens: 50,
          costUsd: '0.100000',
          latencyMs: 10,
          status: 'ok',
          cacheHit: false,
          attempts: 1,
          errorCode: null,
          correlationId: null,
          usageEstimated: false,
          ...overrides,
          createdAt: new Date(`${day}T12:00:00.000Z`),
        }),
      );

    beforeAll(async () => {
      await calls.delete({
        createdAt: Between(new Date('2001-01-01'), new Date('2001-12-31')),
      });
      await seed(DAY_1, {});
      await seed(DAY_1, {
        cacheHit: true,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: '0.000000',
        attempts: 0,
      });
      await seed(DAY_1, {
        status: 'invalid_output',
        costUsd: '0.200000',
        attempts: 2,
      });
      await seed(DAY_1, { feature: 'quiz-regeneration', costUsd: '0.000300' });
      await seed(DAY_2, {
        feature: 'quiz-generation-stream',
        status: 'error',
        errorCode: 'aborted',
        inputTokens: 1_234,
        outputTokens: 2,
        costUsd: '0.002488',
        usageEstimated: true,
      });
      // The day after the range: must not be counted.
      await seed('2001-02-05', { costUsd: '9.000000' });
    });

    afterAll(async () => {
      await calls.delete({
        createdAt: Between(new Date('2001-01-01'), new Date('2001-12-31')),
      });
    });

    it('aggregates seeded rows per day and feature, with exact costs, rates and status counts', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/usage?from=${DAY_1}&to=${DAY_2}`)
        .expect(200);

      expect(response.body).toEqual({
        from: DAY_1,
        to: DAY_2,
        totals: {
          calls: 5,
          inputTokens: 1_534,
          outputTokens: 152,
          costUsd: '0.302788',
          cacheHitRate: 0.2,
          errorRate: 0.4,
          byStatus: {
            ok: 3,
            invalid_output: 1,
            error: 1,
            budget_exceeded: 0,
            refused: 0,
            truncated: 0,
          },
          estimated: {
            calls: 1,
            inputTokens: 1_234,
            outputTokens: 2,
            costUsd: '0.002488',
          },
        },
        days: [
          expect.objectContaining({
            date: DAY_1,
            feature: 'quiz-generation',
            calls: 3,
            costUsd: '0.300000',
            cacheHitRate: 1 / 3,
            errorRate: 1 / 3,
          }),
          expect.objectContaining({
            date: DAY_1,
            feature: 'quiz-regeneration',
            calls: 1,
          }),
          expect.objectContaining({
            date: DAY_2,
            feature: 'quiz-generation-stream',
            calls: 1,
            errorRate: 1,
            estimated: {
              calls: 1,
              inputTokens: 1_234,
              outputTokens: 2,
              costUsd: '0.002488',
            },
          }),
        ],
      });
    });

    it('rejects an invalid range with a 400 naming the parameter', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/usage?from=2001-02-10&to=2001-02-01')
        .expect(400);

      expect(response.body).toMatchObject({
        type: 'urn:quizforge:problem:validation-error',
        errors: [{ parameter: 'from', detail: 'from must not be after to' }],
      });
    });
  });
});

describe('Generate throttling (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    // .env.test sets a high limit; this app allows 2 requests per minute.
    app = await createApp((builder) =>
      builder.overrideProvider(getOptionsToken()).useValue({
        throttlers: [{ name: GENERATE_THROTTLER, limit: 2, ttl: 60_000 }],
      }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 429 problem details with Retry-After after the limit, only on the LLM endpoints', async () => {
    const http = () => request(app.getHttpServer());
    const lesson = await http()
      .post('/api/lessons')
      .send(loadSampleLesson('recursion'))
      .expect(201);
    const lessonId = (lesson.body as { id: string }).id;
    const generate = () =>
      http()
        .post(`/api/lessons/${lessonId}/quizzes`)
        .send({
          count: 5,
          difficulty: 'medium',
          types: ['multiple_choice', 'true_false'],
        });

    const first = await generate().expect(201);
    await generate().expect(201);
    const third = await generate();

    expect(third.status).toBe(429);
    expect(third.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(third.body).toMatchObject({
      type: 'urn:quizforge:problem:too-many-requests',
      title: 'Too many requests',
      status: 429,
      detail: expect.stringContaining('Too many generation requests'),
      instance: `/api/lessons/${lessonId}/quizzes`,
    });
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);

    // Regenerate shares the same limit.
    const questionId = (first.body as { questions: { id: string }[] })
      .questions[0]?.id;
    expect(
      (await http().post(`/api/questions/${questionId}/regenerate`)).status,
    ).toBe(429);

    // Other endpoints are not throttled.
    await http().get(`/api/lessons/${lessonId}`).expect(200);
    await http().get(`/api/lessons/${lessonId}/quizzes`).expect(200);
  });
});
