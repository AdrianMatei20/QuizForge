import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import type { FakeLlmClient } from '../src/llm/fake-llm.client.js';
import type { Env } from '../src/config/env.schema.js';
import { LLM_CLIENT } from '../src/llm/llm-client.js';
import { llmServiceOptionsFromConfig } from '../src/llm/llm.module.js';
import {
  LLM_SERVICE_OPTIONS,
  type LlmServiceOptions,
} from '../src/llm/llm.service.js';
import { QUIZ_RANDOM } from '../src/quiz/shuffle.js';
import { loadSampleLesson } from './support/lessons.js';
import { seededRandom, TEST_SEED } from './support/random.js';

/** The HTTP API end to end, through the real pipe, filter and database. */
describe('Lessons and quizzes (e2e)', () => {
  let app: NestExpressApplication;
  let fake: FakeLlmClient;

  const http = () => request(app.getHttpServer());
  const settings = {
    count: 5,
    difficulty: 'easy',
    types: ['multiple_choice', 'true_false'],
  };

  async function createApp(
    customize: (builder: TestingModuleBuilder) => TestingModuleBuilder = (
      builder,
    ) => builder,
  ): Promise<NestExpressApplication> {
    const moduleRef = await customize(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(QUIZ_RANDOM)
        .useValue(seededRandom(TEST_SEED)),
    ).compile();
    const created = moduleRef.createNestApplication<NestExpressApplication>({
      logger: false,
    });
    configureApp(created);
    await created.init();
    return created;
  }

  beforeAll(async () => {
    app = await createApp();
    fake = app.get<FakeLlmClient>(LLM_CLIENT, { strict: false });
  });

  afterAll(async () => {
    await app.close();
  });

  async function createLesson(
    server: NestExpressApplication = app,
  ): Promise<string> {
    const response = await request(server.getHttpServer())
      .post('/api/lessons')
      .send(loadSampleLesson('recursion'))
      .expect(201);
    return (response.body as { id: string }).id;
  }

  /**
   * A failed generation: problem details with the expected status and type,
   * a quizId member, and that quiz stored as failed with the expected reason,
   * findable both directly and in the lesson's quiz list.
   */
  async function expectFailedQuiz(
    response: Response,
    lessonId: string,
    expected: { status: number; type: string; reason: string },
    server: NestExpressApplication = app,
  ): Promise<void> {
    expect(response.status).toBe(expected.status);
    expect(response.headers['content-type']).toMatch(
      /application\/problem\+json/,
    );
    const body = response.body as Record<string, unknown>;
    expect(body).toMatchObject({
      type: expected.type,
      title: expect.any(String),
      status: expected.status,
      detail: expect.any(String),
      instance: `/api/lessons/${lessonId}/quizzes`,
      quizId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });

    const quizId = body['quizId'] as string;
    const quiz = await request(server.getHttpServer())
      .get(`/api/quizzes/${quizId}`)
      .expect(200);
    expect(quiz.body).toMatchObject({
      id: quizId,
      status: 'failed',
      failureReason: expected.reason,
      questions: [],
    });

    const list = await request(server.getHttpServer())
      .get(`/api/lessons/${lessonId}/quizzes`)
      .expect(200);
    expect(list.body).toEqual([
      expect.objectContaining({
        id: quizId,
        status: 'failed',
        failureReason: expected.reason,
      }),
    ]);
  }

  describe('lessons', () => {
    it('creates a lesson and reads it back', async () => {
      const sample = loadSampleLesson('recursion');

      const created = await http()
        .post('/api/lessons')
        .send(sample)
        .expect(201);

      expect(created.body).toMatchObject({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        title: 'Recursion',
        content: sample.content,
        contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      const read = await http()
        .get(`/api/lessons/${(created.body as { id: string }).id}`)
        .expect(200);
      expect(read.body).toEqual(created.body);
    });

    it('returns 400 problem details for content under 200 characters', async () => {
      const response = await http()
        .post('/api/lessons')
        .send({ title: 'Short', content: 'Too short.' })
        .expect(400)
        .expect('Content-Type', /application\/problem\+json/);

      expect(response.body).toMatchObject({
        type: 'urn:quizforge:problem:validation-error',
        errors: [{ pointer: '#/content' }],
      });
    });

    it('returns 413 problem details for content over 20,000 characters', async () => {
      const response = await http()
        .post('/api/lessons')
        .send({ title: 'Huge', content: 'a'.repeat(20_001) })
        .expect(413)
        .expect('Content-Type', /application\/problem\+json/);

      expect(response.body).toMatchObject({
        type: 'urn:quizforge:problem:lesson-too-large',
        title: 'Lesson too large',
        status: 413,
        maxLength: 20_000,
        instance: '/api/lessons',
      });
    });

    it('accepts a valid lesson whose JSON body is over the default 100 KB limit', async () => {
      // Worst case: every emoji \u-escaped as two UTF-16 units, 12 bytes each.
      // 20,000 characters -> about 240 KB of JSON.
      const json = JSON.stringify({
        title: 'Emoji',
        content: '\u{1F600}'.repeat(20_000),
      }).replace(
        /[\u0080-￿]/g,
        (unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`,
      );
      expect(json.length).toBeGreaterThan(200_000);

      await http()
        .post('/api/lessons')
        .set('Content-Type', 'application/json')
        .send(json)
        .expect(201);
    });

    it('returns 413 problem details for a body over the JSON limit', async () => {
      const response = await http()
        .post('/api/lessons')
        .send({ title: 'Too big', content: 'a'.repeat(300_000) })
        .expect(413)
        .expect('Content-Type', /application\/problem\+json/);

      expect(response.body).toMatchObject({ status: 413 });
    });

    it('returns 400 for a missing title', async () => {
      await http()
        .post('/api/lessons')
        .send({ content: loadSampleLesson('recursion').content })
        .expect(400);
    });

    it('returns 404 for an unknown lesson and 400 for a malformed id', async () => {
      await http()
        .get('/api/lessons/00000000-0000-4000-8000-000000000000')
        .expect(404)
        .expect('Content-Type', /application\/problem\+json/);
      const malformed = await http().get('/api/lessons/not-a-uuid').expect(400);
      expect(malformed.body).toMatchObject({
        type: 'urn:quizforge:problem:validation-error',
        errors: [{ parameter: 'id', detail: 'id must be a UUID' }],
      });
      expect(malformed.body).not.toHaveProperty(['errors', 0, 'pointer']);
    });
  });

  describe('quizzes', () => {
    it('generates a quiz and returns it with draft questions on GET', async () => {
      const lessonId = await createLesson();
      fake.respondWithFixture('recursion');

      const generated = await http()
        .post(`/api/lessons/${lessonId}/quizzes`)
        .send(settings)
        .expect(201);

      expect(generated.body).toMatchObject({
        lessonId,
        status: 'draft',
        failureReason: null,
        promptId: 'quiz',
        promptVersion: 1,
        model: 'fake-model',
        settings,
      });

      const read = await http()
        .get(`/api/quizzes/${(generated.body as { id: string }).id}`)
        .expect(200);
      const body = read.body as {
        status: string;
        questions: Record<string, unknown>[];
      };
      expect(body.status).toBe('draft');
      expect(body.questions).toHaveLength(5);
      expect(body.questions.every((q) => q['status'] === 'draft')).toBe(true);
      expect(body.questions[0]).toMatchObject({
        position: 1,
        type: 'multiple_choice',
        stem: 'What is the base case of a recursive function?',
        correctIndex: expect.any(Number),
        sourceQuote: expect.any(String),
        explanation: expect.any(String),
        editedAt: null,
      });
      const first = body.questions[0] as {
        options: string[];
        correctIndex: number;
      };
      expect(first.options[first.correctIndex]).toBe(
        'A condition where the function returns a result without calling itself',
      );
      expect(body.questions[0]).not.toHaveProperty('original');
      expect(body.questions[0]).not.toHaveProperty('promptId');
    });

    it.each([
      [{ ...settings, count: 11 }],
      [{ ...settings, count: 2 }],
      [{ ...settings, difficulty: 'impossible' }],
      [{ ...settings, types: [] }],
      [{ ...settings, types: ['essay'] }],
      [{ ...settings, types: ['true_false', 'true_false'] }],
    ])('rejects invalid settings %j with 400', async (body) => {
      const lessonId = await createLesson();
      const before = fake.requests.length;

      await http()
        .post(`/api/lessons/${lessonId}/quizzes`)
        .send(body)
        .expect(400)
        .expect('Content-Type', /application\/problem\+json/);
      expect(fake.requests).toHaveLength(before);
    });

    it('returns 502 problem details when the output stays invalid, without model output', async () => {
      const lessonId = await createLesson();
      fake.nextOffSchema().nextOffSchema();

      const response = await http()
        .post(`/api/lessons/${lessonId}/quizzes`)
        .send(settings);

      await expectFailedQuiz(response, lessonId, {
        status: 502,
        type: 'urn:quizforge:problem:llm-invalid-output',
        reason: 'invalid_output',
      });
      expect(JSON.stringify(response.body)).not.toContain('unexpected');
    });

    it('returns 422 with quizId when the model refuses', async () => {
      const lessonId = await createLesson();
      fake.nextRefusal();

      const response = await http()
        .post(`/api/lessons/${lessonId}/quizzes`)
        .send(settings);

      await expectFailedQuiz(response, lessonId, {
        status: 422,
        type: 'urn:quizforge:problem:llm-refused',
        reason: 'refusal',
      });
    });

    it('returns 503 with Retry-After and quizId when the provider stays rate limited', async () => {
      const lessonId = await createLesson();
      const before = fake.requests.length;
      fake.failNext(3, 'rate_limited');

      const response = await http()
        .post(`/api/lessons/${lessonId}/quizzes`)
        .send(settings);

      await expectFailedQuiz(response, lessonId, {
        status: 503,
        type: 'urn:quizforge:problem:llm-rate-limited',
        reason: 'rate_limited',
      });
      // No Retry-After from the provider, so our default for clients applies.
      expect(response.headers['retry-after']).toBe('30');
      expect(fake.requests).toHaveLength(before + 3);
    });

    it('returns 504 with quizId when every attempt times out', async () => {
      const lessonId = await createLesson();
      const before = fake.requests.length;
      fake.failNext(3, 'timeout');

      const response = await http()
        .post(`/api/lessons/${lessonId}/quizzes`)
        .send(settings);

      await expectFailedQuiz(response, lessonId, {
        status: 504,
        type: 'urn:quizforge:problem:llm-timeout',
        reason: 'timeout',
      });
      expect(fake.requests).toHaveLength(before + 3);
    });

    describe('with a daily budget of 0', () => {
      let budgetApp: NestExpressApplication;

      beforeAll(async () => {
        // ConfigModule validates env vars once per process, when AppModule is
        // first imported, so setting LLM_DAILY_BUDGET_USD here would have no
        // effect. Instead this app uses the real config-built options with
        // only the budget replaced. (env.schema.spec checks that "0" is a
        // valid LLM_DAILY_BUDGET_USD.)
        budgetApp = await createApp((builder) =>
          builder.overrideProvider(LLM_SERVICE_OPTIONS).useFactory({
            inject: [ConfigService],
            factory: (config: ConfigService<Env, true>): LlmServiceOptions => ({
              ...llmServiceOptionsFromConfig(config),
              dailyBudgetUsd: '0',
            }),
          }),
        );
      });

      afterAll(async () => {
        await budgetApp.close();
      });

      it('returns 429 with Retry-After and quizId without calling the provider', async () => {
        const budgetFake = budgetApp.get<FakeLlmClient>(LLM_CLIENT, {
          strict: false,
        });
        const lessonId = await createLesson(budgetApp);

        const response = await request(budgetApp.getHttpServer())
          .post(`/api/lessons/${lessonId}/quizzes`)
          .send(settings);

        await expectFailedQuiz(
          response,
          lessonId,
          {
            status: 429,
            type: 'urn:quizforge:problem:llm-budget-exceeded',
            reason: 'budget_exceeded',
          },
          budgetApp,
        );
        expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
        expect(budgetFake.requests).toHaveLength(0);
      });
    });

    it("lists a lesson's quizzes newest first, honouring limit", async () => {
      const lessonId = await createLesson();
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        fake.respondWithFixture('recursion');
        const generated = await http()
          .post(`/api/lessons/${lessonId}/quizzes`)
          .send(settings)
          .expect(201);
        ids.push((generated.body as { id: string }).id);
      }

      const all = await http()
        .get(`/api/lessons/${lessonId}/quizzes`)
        .expect(200);
      expect(all.body).toEqual(
        [...ids].reverse().map((id) => ({
          id,
          status: 'draft',
          failureReason: null,
          settings,
          createdAt: expect.any(String),
        })),
      );

      const limited = await http()
        .get(`/api/lessons/${lessonId}/quizzes?limit=1`)
        .expect(200);
      expect((limited.body as { id: string }[]).map((q) => q.id)).toEqual([
        ids[2],
      ]);
    });

    it.each(['0', '101', 'abc', '1.5'])(
      'rejects limit=%s with 400',
      async (limit) => {
        const lessonId = await createLesson();

        const response = await http()
          .get(`/api/lessons/${lessonId}/quizzes?limit=${limit}`)
          .expect(400);
        const { errors } = response.body as {
          errors: { parameter?: string; pointer?: string }[];
        };
        // A query parameter is named, never given a body-style pointer.
        expect(errors.length).toBeGreaterThan(0);
        for (const error of errors) {
          expect(error.parameter).toBe('limit');
          expect(error).not.toHaveProperty('pointer');
        }
      },
    );

    it('returns the cost of a quiz across its LLM calls', async () => {
      const lessonId = await createLesson();
      fake.respondWithFixture('recursion');
      const generated = await http()
        .post(`/api/lessons/${lessonId}/quizzes`)
        .send(settings)
        .expect(201);
      const quizId = (generated.body as { id: string }).id;

      const response = await http()
        .get(`/api/quizzes/${quizId}/cost`)
        .expect(200);

      const body = response.body as Record<string, unknown>;
      expect(body).toEqual({
        quizId,
        calls: 1,
        attempts: 1,
        inputTokens: expect.any(Number),
        outputTokens: expect.any(Number),
        totalTokens: expect.any(Number),
        costUsd: '0.000000',
      });
      expect(body['totalTokens']).toBe(
        (body['inputTokens'] as number) + (body['outputTokens'] as number),
      );
    });

    it('returns 404 for an unknown lesson or quiz', async () => {
      const missing = '00000000-0000-4000-8000-000000000000';

      await http()
        .post(`/api/lessons/${missing}/quizzes`)
        .send(settings)
        .expect(404);
      await http().get(`/api/quizzes/${missing}`).expect(404);
      await http().get(`/api/quizzes/${missing}/cost`).expect(404);
      await http().get(`/api/lessons/${missing}/quizzes`).expect(404);
      await http().get('/api/quizzes/not-a-uuid/cost').expect(400);
    });
  });
});
