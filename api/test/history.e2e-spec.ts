import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { MoreThanOrEqual, type Repository } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { Lesson } from '../src/lessons/lesson.entity.js';
import type { FakeLlmClient } from '../src/llm/fake-llm.client.js';
import { LLM_CLIENT } from '../src/llm/llm-client.js';
import type { QuizResponse } from '../src/quiz/quiz.mapper.js';
import { Quiz } from '../src/quiz/quiz.entity.js';
import type { QuizFailureReason, QuizStatus } from '../src/quiz/quiz.types.js';
import { QUIZ_RANDOM } from '../src/quiz/shuffle.js';
import { loadSampleLesson } from './support/lessons.js';
import { seededRandom, TEST_SEED } from './support/random.js';

interface LessonListBody {
  items: {
    id: string;
    title: string;
    createdAt: string;
    quizCounts: Record<QuizStatus, number>;
  }[];
  total: number;
  limit: number;
  offset: number;
}

interface QuizListItemBody {
  id: string;
  status: QuizStatus;
  questionCount: number;
  settings: { count: number };
}

/** Phase 7: finding lessons and their quizzes again (GET /api/lessons, the quiz list). */
describe('Lesson and quiz history (e2e)', () => {
  let app: NestExpressApplication;
  let fake: FakeLlmClient;
  let lessons: Repository<Lesson>;
  let quizzes: Repository<Quiz>;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(QUIZ_RANDOM)
      .useValue(seededRandom(TEST_SEED))
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      logger: false,
    });
    configureApp(app);
    await app.init();
    fake = app.get<FakeLlmClient>(LLM_CLIENT, { strict: false });
    lessons = app.get(getRepositoryToken(Lesson));
    quizzes = app.get(getRepositoryToken(Quiz));
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/lessons', () => {
    // Dated far in the future, so these are always the newest lessons in the
    // shared test database, whatever other suites have created.
    const FUTURE = new Date('2999-01-01T00:00:00.000Z');
    const at = (day: string) => new Date(`2999-01-${day}T12:00:00.000Z`);
    const CONTENT = 'Seeded lesson content. '.repeat(10);

    let newest: Lesson;
    let tiedHigh: Lesson;
    let tiedLow: Lesson;
    let oldest: Lesson;

    const seedLesson = (title: string, createdAt: Date, id: string) =>
      lessons.save(
        lessons.create({
          id,
          title,
          content: CONTENT,
          contentHash: 'f'.repeat(64),
          createdAt,
        }),
      );

    const seedQuiz = (
      lesson: Lesson,
      status: QuizStatus,
      failureReason: QuizFailureReason | null = null,
    ) =>
      quizzes.save(
        quizzes.create({
          lessonId: lesson.id,
          status,
          failureReason,
          promptId: 'quiz',
          promptVersion: 1,
          model: 'fake-model',
          settings: {
            count: 5,
            difficulty: 'medium',
            types: ['multiple_choice'],
          },
        }),
      );

    /** Removes what earlier runs seeded (quizzes first: lessons are RESTRICT). */
    async function removeSeeded(): Promise<void> {
      const seeded = await lessons.findBy({
        createdAt: MoreThanOrEqual(FUTURE),
      });
      for (const lesson of seeded) {
        await quizzes.delete({ lessonId: lesson.id });
        await lessons.delete({ id: lesson.id });
      }
    }

    beforeAll(async () => {
      await removeSeeded();
      newest = await seedLesson('Newest', at('05'), randomId('a'));
      // Same timestamp: the id decides, higher first.
      tiedHigh = await seedLesson('Tied (high id)', at('04'), randomId('e'));
      tiedLow = await seedLesson('Tied (low id)', at('04'), randomId('b'));
      oldest = await seedLesson('Oldest', at('03'), randomId('c'));

      await seedQuiz(newest, 'generating');
      await seedQuiz(newest, 'draft');
      await seedQuiz(newest, 'draft');
      await seedQuiz(newest, 'published');
      await seedQuiz(newest, 'failed', 'timeout');
      await seedQuiz(oldest, 'failed', 'invalid_output');
    });

    afterAll(removeSeeded);

    const list = async (query = ''): Promise<LessonListBody> =>
      (await http().get(`/api/lessons${query}`).expect(200))
        .body as LessonListBody;

    it('lists lessons newest first, the id breaking ties, with quiz counts by status', async () => {
      const body = await list('?limit=4');

      expect(body.items).toEqual([
        {
          id: newest.id,
          title: 'Newest',
          createdAt: '2999-01-05T12:00:00.000Z',
          quizCounts: { generating: 1, draft: 2, published: 1, failed: 1 },
        },
        {
          id: tiedHigh.id,
          title: 'Tied (high id)',
          createdAt: '2999-01-04T12:00:00.000Z',
          quizCounts: { generating: 0, draft: 0, published: 0, failed: 0 },
        },
        {
          id: tiedLow.id,
          title: 'Tied (low id)',
          createdAt: '2999-01-04T12:00:00.000Z',
          quizCounts: { generating: 0, draft: 0, published: 0, failed: 0 },
        },
        {
          id: oldest.id,
          title: 'Oldest',
          createdAt: '2999-01-03T12:00:00.000Z',
          quizCounts: { generating: 0, draft: 0, published: 0, failed: 1 },
        },
      ]);
      expect(body).toMatchObject({ limit: 4, offset: 0 });
      // Every lesson, not just the page; the list leaves the content out.
      expect(body.total).toBe(await lessons.count());
      expect(body.items[0]).not.toHaveProperty('content');
    });

    it('pages with limit and offset, without overlap across a tie', async () => {
      const second = await list('?limit=2&offset=1');
      const third = await list('?limit=2&offset=2');

      expect(second.items.map((lesson) => lesson.id)).toEqual([
        tiedHigh.id,
        tiedLow.id,
      ]);
      expect(third.items.map((lesson) => lesson.id)).toEqual([
        tiedLow.id,
        oldest.id,
      ]);
      expect(second).toMatchObject({ limit: 2, offset: 1 });
    });

    it('defaults to 20 lessons from the start, and returns no items past the end', async () => {
      const first = await list();
      expect(first).toMatchObject({ limit: 20, offset: 0 });
      expect(first.items.length).toBe(Math.min(20, first.total));
      expect(first.items[0]?.id).toBe(newest.id);

      const past = await list(`?offset=${first.total}`);
      expect(past.items).toEqual([]);
      expect(past.total).toBe(first.total);
    });

    it.each([
      ['limit=0', 'limit'],
      ['limit=101', 'limit'],
      ['limit=abc', 'limit'],
      ['offset=-1', 'offset'],
      ['offset=1.5', 'offset'],
    ])('returns 400 problem details for %s', async (query, parameter) => {
      const response = await http().get(`/api/lessons?${query}`).expect(400);

      expect(response.headers['content-type']).toMatch(
        /application\/problem\+json/,
      );
      const body = response.body as {
        type: string;
        errors: { parameter?: string }[];
      };
      expect(body.type).toBe('urn:quizforge:problem:validation-error');
      // A non-number fails several rules at once; each names the parameter.
      expect(body.errors.length).toBeGreaterThan(0);
      for (const error of body.errors) {
        expect(error.parameter).toBe(parameter);
      }
    });

    it('accepts the maximum limit of 100', async () => {
      const body = await list('?limit=100');
      expect(body.items.length).toBe(Math.min(100, body.total));
    });
  });

  describe('GET /api/lessons/:id/quizzes: questionCount', () => {
    const settings = {
      count: 5,
      difficulty: 'medium',
      types: ['multiple_choice', 'true_false'],
    };

    async function createDraftQuiz(): Promise<{
      lessonId: string;
      quiz: QuizResponse;
    }> {
      const lesson = await http()
        .post('/api/lessons')
        .send(loadSampleLesson('recursion'))
        .expect(201);
      const lessonId = (lesson.body as { id: string }).id;
      fake.respondWithFixture('recursion');
      const quiz = await http()
        .post(`/api/lessons/${lessonId}/quizzes`)
        .send(settings)
        .expect(201);
      return { lessonId, quiz: quiz.body as QuizResponse };
    }

    const listQuizzes = async (lessonId: string) =>
      (await http().get(`/api/lessons/${lessonId}/quizzes`).expect(200))
        .body as QuizListItemBody[];

    it('counts current questions of a draft, not the ones a regeneration replaced', async () => {
      const { lessonId, quiz } = await createDraftQuiz();
      await http()
        .post(`/api/questions/${quiz.questions[0]?.id}/regenerate`)
        .expect(201);

      const [listed] = await listQuizzes(lessonId);

      expect(listed).toMatchObject({
        id: quiz.id,
        status: 'draft',
        questionCount: 5,
        settings: { count: 5 },
      });
    });

    it('counts only the approved questions of a published quiz', async () => {
      const { lessonId, quiz } = await createDraftQuiz();
      for (const question of quiz.questions.slice(0, 2)) {
        await http()
          .patch(`/api/questions/${question.id}`)
          .send({ status: 'approved' })
          .expect(200);
      }
      await http()
        .patch(`/api/questions/${quiz.questions[2]?.id}`)
        .send({ status: 'rejected' })
        .expect(200);
      await http().post(`/api/quizzes/${quiz.id}/publish`).expect(200);

      const [listed] = await listQuizzes(lessonId);

      expect(listed).toMatchObject({
        id: quiz.id,
        status: 'published',
        questionCount: 2,
      });
    });
  });
});

/** A valid v4 UUID starting with the given hex digit, to control id order in a tie. */
function randomId(first: string): string {
  const hex = crypto.randomUUID();
  return `${first}${hex.slice(1)}`;
}
