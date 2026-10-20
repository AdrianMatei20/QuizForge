import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import type { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import type { Env } from '../src/config/env.schema.js';
import { DemoMode } from '../src/demo/demo-mode.js';
import { loadSampleLesson } from './support/lessons.js';

/**
 * Demo mode: LLM_PROVIDER=fake with FAKE_LLM_SAMPLE_LESSONS_ONLY on (the
 * default outside tests). .env.test turns the restriction off, so here
 * DemoMode gets a config with it on.
 */
describe('Demo mode (e2e)', () => {
  const demoConfig = {
    get: (key: keyof Env) =>
      key === 'LLM_PROVIDER' ? 'fake' : key === 'FAKE_LLM_SAMPLE_LESSONS_ONLY',
  } as unknown as ConfigService<Env, true>;

  async function createApp(
    customize: (builder: TestingModuleBuilder) => TestingModuleBuilder,
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

  let demo: NestExpressApplication;
  let normal: NestExpressApplication;

  beforeAll(async () => {
    demo = await createApp((builder) =>
      builder.overrideProvider(DemoMode).useValue(new DemoMode(demoConfig)),
    );
    normal = await createApp((builder) => builder);
  });

  afterAll(async () => {
    await demo.close();
    await normal.close();
  });

  const settings = {
    count: 5,
    difficulty: 'medium',
    types: ['multiple_choice', 'true_false'],
  };

  async function createLesson(
    content: string,
    title = 'Lesson',
  ): Promise<string> {
    const response = await request(demo.getHttpServer())
      .post('/api/lessons')
      .send({ title, content })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  it('says in GET /api/info whether demo mode is on, and which lessons work', async () => {
    const on = await request(demo.getHttpServer()).get('/api/info').expect(200);
    const off = await request(normal.getHttpServer())
      .get('/api/info')
      .expect(200);

    expect(on.body).toEqual({
      demoMode: true,
      sampleLessons: ['Binary search', 'HTTP caching', 'Recursion'],
    });
    expect((off.body as { demoMode: boolean }).demoMode).toBe(false);
  });

  it.each([false, true])(
    'refuses a lesson that is not a sample with 422 problem details, and stores no quiz (stream: %s)',
    async (stream) => {
      const lessonId = await createLesson(
        `${loadSampleLesson('recursion').content}\n\nOne more sentence makes this lesson different.`,
      );

      const response = await request(demo.getHttpServer())
        .post(`/api/lessons/${lessonId}/quizzes`)
        .send({ ...settings, stream })
        .expect(422);

      expect(response.headers['content-type']).toMatch(
        /application\/problem\+json/,
      );
      expect(response.body).toMatchObject({
        type: 'urn:quizforge:problem:demo-mode-lesson',
        status: 422,
        detail:
          'demo mode supports the sample lessons only; set an API key to use your own',
        sampleLessons: ['Binary search', 'HTTP caching', 'Recursion'],
      });
      const quizzes = await request(demo.getHttpServer())
        .get(`/api/lessons/${lessonId}/quizzes`)
        .expect(200);
      expect(quizzes.body).toEqual([]);
    },
  );

  it("answers each sample lesson with that lesson's own fixture, with nothing queued", async () => {
    const sample = loadSampleLesson('binary-search');
    const lessonId = await createLesson(sample.content, sample.title);

    const response = await request(demo.getHttpServer())
      .post(`/api/lessons/${lessonId}/quizzes`)
      .send(settings)
      .expect(201);

    const stems = (
      response.body as { questions: { stem: string }[] }
    ).questions.map((question) => question.stem);
    expect(stems).toContain('Binary search works on unsorted lists.');
  });
});
