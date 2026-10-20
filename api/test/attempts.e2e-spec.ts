import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import {
  ATTEMPT_THROTTLER,
  GENERATE_THROTTLER,
} from '../src/common/throttling/rate-limit.guard.js';
import type { FakeLlmClient } from '../src/llm/fake-llm.client.js';
import { LLM_CLIENT } from '../src/llm/llm-client.js';
import type {
  QuestionResponse,
  QuizResponse,
} from '../src/quiz/quiz.mapper.js';
import { QUIZ_RANDOM } from '../src/quiz/shuffle.js';
import { loadSampleLesson } from './support/lessons.js';
import { seededRandom, TEST_SEED } from './support/random.js';

interface PublicQuiz {
  id: string;
  lessonTitle: string;
  questions: { id: string; position: number; options: string[] }[];
}

/** Every key anywhere in a JSON value, however deeply nested. */
function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(allKeys);
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => [
      key,
      ...allKeys(child),
    ]);
  }
  return [];
}

/** Phase 9: taking a published quiz, scoring attempts on the server, and the teacher's attempt stats. */
describe('Attempts (e2e)', () => {
  let app: NestExpressApplication;
  let fake: FakeLlmClient;
  const http = () => request(app.getHttpServer());

  async function createApp(
    customize: (builder: TestingModuleBuilder) => TestingModuleBuilder = (b) =>
      b,
    trustProxyHops = 0,
  ): Promise<NestExpressApplication> {
    const moduleRef = await customize(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(QUIZ_RANDOM)
        .useValue(seededRandom(TEST_SEED)),
    ).compile();
    const created = moduleRef.createNestApplication<NestExpressApplication>({
      logger: false,
    });
    configureApp(created, { trustProxyHops });
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

  /** A draft quiz of 5 questions from the recursion lesson (fake provider). */
  async function createDraftQuiz(): Promise<QuizResponse> {
    const lesson = await http()
      .post('/api/lessons')
      .send(loadSampleLesson('recursion'))
      .expect(201);
    fake.respondWithFixture('recursion');
    const quiz = await http()
      .post(`/api/lessons/${(lesson.body as { id: string }).id}/quizzes`)
      .send({
        count: 5,
        difficulty: 'easy',
        types: ['multiple_choice', 'true_false'],
      })
      .expect(201);
    return quiz.body as QuizResponse;
  }

  /** Approves the first `count` questions and publishes: the quiz is then those questions. */
  async function publishFirst(
    quiz: QuizResponse,
    count: number,
  ): Promise<void> {
    for (const question of quiz.questions.slice(0, count)) {
      await http()
        .patch(`/api/questions/${question.id}`)
        .send({ status: 'approved' })
        .expect(200);
    }
    await http().post(`/api/quizzes/${quiz.id}/publish`).expect(200);
  }

  describe('GET /api/public/quizzes/:id', () => {
    it('returns the published questions with no correct answer, explanation or source quote anywhere', async () => {
      const quiz = await createDraftQuiz();
      await publishFirst(quiz, 4);

      const response = await http()
        .get(`/api/public/quizzes/${quiz.id}`)
        .expect(200);
      const body = response.body as PublicQuiz;

      expect(body).toMatchObject({ id: quiz.id, lessonTitle: 'Recursion' });
      expect(body.questions.map((q) => q.position)).toEqual([1, 2, 3, 4]);
      const keys = allKeys(body);
      for (const secret of [
        'correctIndex',
        'explanation',
        'sourceQuote',
        'original',
        'status',
      ]) {
        expect(keys).not.toContain(secret);
      }
      // Not under another name either: none of the explanations or quotes appear in the response.
      const text = JSON.stringify(body);
      for (const question of quiz.questions) {
        expect(text).not.toContain(question.explanation);
        expect(text).not.toContain(question.sourceQuote);
      }
    });

    it('answers 404 for a draft and for an unknown quiz, with the same message shape', async () => {
      const draft = await createDraftQuiz();

      const forDraft = await http()
        .get(`/api/public/quizzes/${draft.id}`)
        .expect(404);
      const forUnknown = await http()
        .get('/api/public/quizzes/00000000-0000-4000-8000-000000000000')
        .expect(404);

      expect(forDraft.headers['content-type']).toMatch(
        /application\/problem\+json/,
      );
      expect((forDraft.body as { detail: string }).detail).toMatch(
        /not found or is not published/,
      );
      expect((forUnknown.body as { detail: string }).detail).toMatch(
        /not found or is not published/,
      );
    });
  });

  describe('POST /api/public/quizzes/:id/attempts', () => {
    let quizId: string;
    let questions: QuizResponse['questions'];

    beforeAll(async () => {
      const quiz = await createDraftQuiz();
      await publishFirst(quiz, 3);
      quizId = quiz.id;
      questions = quiz.questions.slice(0, 3);
    });

    const attempt = (
      answers: { questionId: string; selectedIndex: number }[],
    ) =>
      http().post(`/api/public/quizzes/${quizId}/attempts`).send({ answers });

    it('scores on the server, stores the attempt, and returns the answers and explanations', async () => {
      const [q1, q2, q3] = questions;
      if (!q1 || !q2 || !q3) throw new Error('need 3 questions');
      const wrong = (q: QuestionResponse) =>
        (q.correctIndex + 1) % q.options.length;

      const response = await attempt([
        { questionId: q3.id, selectedIndex: wrong(q3) },
        { questionId: q1.id, selectedIndex: q1.correctIndex },
        { questionId: q2.id, selectedIndex: q2.correctIndex },
      ]).expect(201);

      expect(response.body).toMatchObject({
        attemptId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        score: 2,
        total: 3,
        results: [
          {
            questionId: q1.id,
            correct: true,
            correctIndex: q1.correctIndex,
            explanation: q1.explanation,
          },
          {
            questionId: q2.id,
            correct: true,
            correctIndex: q2.correctIndex,
            explanation: q2.explanation,
          },
          {
            questionId: q3.id,
            correct: false,
            selectedIndex: wrong(q3),
            correctIndex: q3.correctIndex,
          },
        ],
      });
    });

    it('rejects a missing answer with 400 problem details, and stores nothing', async () => {
      const before = await http()
        .get(`/api/quizzes/${quizId}/attempt-stats`)
        .expect(200);
      const [q1, q2] = questions;

      const response = await attempt([
        { questionId: q1!.id, selectedIndex: 0 },
        { questionId: q2!.id, selectedIndex: 0 },
      ]).expect(400);

      expect(response.body).toMatchObject({
        type: 'urn:quizforge:problem:validation-error',
        errors: [
          {
            pointer: '#/answers',
            detail: 'must answer every question; missing: question 3',
          },
        ],
      });
      const after = await http()
        .get(`/api/quizzes/${quizId}/attempt-stats`)
        .expect(200);
      expect((after.body as { attempts: number }).attempts).toBe(
        (before.body as { attempts: number }).attempts,
      );
    });

    it('rejects a duplicated answer, pointing at it', async () => {
      const [q1, q2, q3] = questions;

      const response = await attempt([
        { questionId: q1!.id, selectedIndex: 0 },
        { questionId: q2!.id, selectedIndex: 0 },
        { questionId: q2!.id, selectedIndex: 1 },
        { questionId: q3!.id, selectedIndex: 0 },
      ]).expect(400);

      expect(response.body).toMatchObject({
        errors: [
          {
            pointer: '#/answers/2/questionId',
            detail: 'answers question 2 a second time',
          },
        ],
      });
    });

    it.each([
      [{}, '#/answers'],
      [
        { answers: [{ questionId: 'not-a-uuid', selectedIndex: 0 }] },
        '#/answers/0/questionId',
      ],
      [
        {
          answers: [
            {
              questionId: '00000000-0000-4000-8000-000000000000',
              selectedIndex: -1,
            },
          ],
        },
        '#/answers/0/selectedIndex',
      ],
    ])('rejects a malformed body (%j)', async (body, pointer) => {
      const response = await http()
        .post(`/api/public/quizzes/${quizId}/attempts`)
        .send(body)
        .expect(400);
      expect(
        (response.body as { errors: { pointer: string }[] }).errors.map(
          (e) => e.pointer,
        ),
      ).toContain(pointer);
    });

    it('answers 404 for a quiz that is not published', async () => {
      const draft = await createDraftQuiz();
      await http()
        .post(`/api/public/quizzes/${draft.id}/attempts`)
        .send({ answers: [] })
        .expect(404);
    });
  });

  describe('GET /api/quizzes/:id/attempt-stats', () => {
    it('reports attempts, the average score, percent correct per question and flags from 5 attempts', async () => {
      const quiz = await createDraftQuiz();
      await publishFirst(quiz, 2);
      const [easy, hard] = quiz.questions;
      if (!easy || !hard) throw new Error('need 2 questions');
      const wrong = (q: QuestionResponse) =>
        (q.correctIndex + 1) % q.options.length;

      const empty = await http()
        .get(`/api/quizzes/${quiz.id}/attempt-stats`)
        .expect(200);
      expect(empty.body).toMatchObject({ attempts: 0, averageScore: null });

      // 4 attempts: below the minimum, so percentages but no flags yet.
      const submit = () =>
        http()
          .post(`/api/public/quizzes/${quiz.id}/attempts`)
          .send({
            answers: [
              { questionId: easy.id, selectedIndex: easy.correctIndex },
              { questionId: hard.id, selectedIndex: wrong(hard) },
            ],
          })
          .expect(201);
      for (let i = 0; i < 4; i++) await submit();
      const early = await http()
        .get(`/api/quizzes/${quiz.id}/attempt-stats`)
        .expect(200);
      expect(early.body).toMatchObject({
        attempts: 4,
        averageScore: 0.5,
        questions: [
          {
            questionId: easy.id,
            attempts: 4,
            correct: 4,
            percentCorrect: 1,
            flag: null,
          },
          {
            questionId: hard.id,
            attempts: 4,
            correct: 0,
            percentCorrect: 0,
            flag: null,
          },
        ],
        thresholds: {
          tooEasyAbove: 0.9,
          possiblyWrongBelow: 0.2,
          minAttempts: 5,
        },
      });

      await submit();
      const flagged = await http()
        .get(`/api/quizzes/${quiz.id}/attempt-stats`)
        .expect(200);
      expect(
        (
          flagged.body as { questions: { flag: string | null }[] }
        ).questions.map((q) => q.flag),
      ).toEqual(['too_easy', 'possibly_wrong']);
    });

    it('answers 404 for an unknown quiz', async () => {
      await http()
        .get('/api/quizzes/00000000-0000-4000-8000-000000000000/attempt-stats')
        .expect(404);
    });
  });

  describe('rate limit', () => {
    let limited: NestExpressApplication;

    beforeAll(async () => {
      limited = await createApp((builder) =>
        builder.overrideProvider(getOptionsToken()).useValue({
          throttlers: [
            { name: GENERATE_THROTTLER, limit: 1000, ttl: 60_000 },
            { name: ATTEMPT_THROTTLER, limit: 2, ttl: 60_000 },
          ],
        }),
      );
    });

    afterAll(async () => {
      await limited.close();
    });

    it('answers 429 problem details with Retry-After after THROTTLE_ATTEMPT_LIMIT attempts, without limiting reading', async () => {
      const id = '00000000-0000-4000-8000-000000000000';
      const post = () =>
        request(limited.getHttpServer())
          .post(`/api/public/quizzes/${id}/attempts`)
          .send({ answers: [] });

      await post().expect(404);
      await post().expect(404);
      const third = await post().expect(429);

      expect(third.headers['content-type']).toMatch(
        /application\/problem\+json/,
      );
      expect(third.headers['retry-after']).toMatch(/^\d+$/);
      expect(third.body).toMatchObject({
        type: 'urn:quizforge:problem:too-many-requests',
        detail: expect.stringContaining('Too many quiz attempts'),
      });
      await request(limited.getHttpServer())
        .get(`/api/public/quizzes/${id}`)
        .expect(404);
    });

    it('behind a trusted proxy, counts each client by X-Forwarded-For, not the proxy address', async () => {
      const proxied = await createApp(
        (builder) =>
          builder.overrideProvider(getOptionsToken()).useValue({
            throttlers: [
              { name: GENERATE_THROTTLER, limit: 1000, ttl: 60_000 },
              { name: ATTEMPT_THROTTLER, limit: 1, ttl: 60_000 },
            ],
          }),
        1,
      );
      const id = '00000000-0000-4000-8000-000000000000';
      const post = (clientIp: string) =>
        request(proxied.getHttpServer())
          .post(`/api/public/quizzes/${id}/attempts`)
          .set('X-Forwarded-For', clientIp)
          .send({ answers: [] });

      try {
        await post('203.0.113.1').expect(404);
        await post('203.0.113.2').expect(404);
        await post('203.0.113.1').expect(429);
      } finally {
        await proxied.close();
      }
    });
  });
});
