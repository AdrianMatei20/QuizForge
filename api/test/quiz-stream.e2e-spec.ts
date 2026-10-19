import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { firstValueFrom, take, toArray } from 'rxjs';
import type { Repository } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import type { Env } from '../src/config/env.schema.js';
import { LessonsService } from '../src/lessons/lessons.service.js';
import type { FakeLlmClient } from '../src/llm/fake-llm.client.js';
import { LlmCall } from '../src/llm/llm-call.entity.js';
import { LLM_CLIENT } from '../src/llm/llm-client.js';
import { ActiveGenerations } from '../src/quiz/active-generations.js';
import { Question } from '../src/quiz/question.entity.js';
import type { QuizStreamEvent } from '../src/quiz/quiz-stream.events.js';
import {
  QUIZ_STREAM_OPTIONS,
  QuizStreamService,
} from '../src/quiz/quiz-stream.service.js';
import { Quiz } from '../src/quiz/quiz.entity.js';
import { quizStreamOptionsFromConfig } from '../src/quiz/quiz.module.js';
import { QuizService } from '../src/quiz/quiz.service.js';
import type { QuizSettings } from '../src/quiz/quiz.types.js';
import { QUIZ_RANDOM } from '../src/quiz/shuffle.js';
import { loadSampleLesson } from './support/lessons.js';
import { seededRandom, TEST_SEED } from './support/random.js';

const SETTINGS: QuizSettings = {
  count: 5,
  difficulty: 'medium',
  types: ['multiple_choice', 'true_false'],
};

async function createModule(
  generationTimeoutMs?: number,
): Promise<TestingModule> {
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(QUIZ_RANDOM)
    .useValue(seededRandom(TEST_SEED));
  if (generationTimeoutMs !== undefined) {
    builder = builder.overrideProvider(QUIZ_STREAM_OPTIONS).useFactory({
      inject: [ConfigService],
      factory: (config: ConfigService<Env, true>) => ({
        ...quizStreamOptionsFromConfig(config),
        generationTimeoutMs,
      }),
    });
  }
  const moduleRef = await builder.compile();
  await moduleRef.init();
  return moduleRef;
}

/** Every event a client receives, until done or problem ends the stream. */
const collect = (streams: QuizStreamService, quizId: string) =>
  firstValueFrom(streams.events(quizId).pipe(toArray()));

const positions = (events: QuizStreamEvent[], type: QuizStreamEvent['type']) =>
  events.flatMap((event) =>
    event.type === type && 'position' in event.data
      ? [event.data.position]
      : [],
  );

describe('Streamed quiz generation (integration)', () => {
  let moduleRef: TestingModule;
  let quizService: QuizService;
  let streams: QuizStreamService;
  let lessons: LessonsService;
  let fake: FakeLlmClient;
  let quizzes: Repository<Quiz>;
  let questions: Repository<Question>;
  let llmCalls: Repository<LlmCall>;

  beforeAll(async () => {
    moduleRef = await createModule();
    quizService = moduleRef.get(QuizService);
    streams = moduleRef.get(QuizStreamService);
    lessons = moduleRef.get(LessonsService);
    fake = moduleRef.get<FakeLlmClient>(LLM_CLIENT, { strict: false });
    quizzes = moduleRef.get(getRepositoryToken(Quiz));
    questions = moduleRef.get(getRepositoryToken(Question));
    llmCalls = moduleRef.get(getRepositoryToken(LlmCall));
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(() => {
    // Small chunks, so lines are split across chunks.
    fake.chunkSize = 5;
  });

  const createLesson = async () =>
    (await lessons.create(loadSampleLesson('recursion'))).id;

  it('emits each valid line as a question, rejects the invalid one, repairs it, and reports done', async () => {
    const lessonId = await createLesson();
    fake.respondWithFixture('with-invalid-line');
    const before = fake.requests.length;

    const quizId = await quizService.startStreamed(lessonId, SETTINGS);
    const events = await collect(streams, quizId);

    // Lines 1, 2, 4, 5 as they arrive, then position 3 from the repair step.
    expect(positions(events, 'question')).toEqual([1, 2, 4, 5, 3]);
    expect(
      events.filter((event) => event.type === 'question_rejected'),
    ).toEqual([
      {
        type: 'question_rejected',
        data: {
          position: 3,
          violations: ['question 3: sourceQuote does not appear in the lesson'],
        },
      },
    ]);
    const done = events.at(-1);
    expect(done).toMatchObject({
      type: 'done',
      data: {
        generated: 5,
        rejected: 1,
        usage: { calls: 2, costUsd: '0.000000' },
      },
    });
    expect(events.filter((event) => event.type === 'done')).toHaveLength(1);

    // One stream call, plus one regenerate call for the gap.
    expect(
      fake.requests.slice(before).map((request) => request.promptId),
    ).toEqual(['quiz-stream', 'quiz-regenerate']);
    const quiz = await quizzes.findOneByOrFail({ id: quizId });
    expect(quiz).toMatchObject({
      status: 'draft',
      streamRejected: 1,
      failureReason: null,
    });
    const saved = await questions.find({
      where: { quizId },
      order: { position: 'ASC' },
    });
    expect(saved.map((question) => question.position)).toEqual([1, 2, 3, 4, 5]);
    expect(saved[2]?.promptId).toBe('quiz-regenerate');
    expect(saved[0]?.promptId).toBe('quiz-stream');
    // Streamed calls are recorded in llm_calls like any other call.
    const calls = await llmCalls.findBy({ correlationId: quizId });
    expect(calls.map((call) => call.feature).sort()).toEqual([
      'quiz-generation-stream',
      'quiz-regeneration',
    ]);
  });

  it('makes no repair call when every line is valid', async () => {
    const lessonId = await createLesson();
    const before = fake.requests.length;

    const quizId = await quizService.startStreamed(lessonId, SETTINGS);
    const events = await collect(streams, quizId);

    expect(positions(events, 'question')).toEqual([1, 2, 3, 4, 5]);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      data: { generated: 5, rejected: 0 },
    });
    expect(fake.requests.length - before).toBe(1);
  });

  it('replays saved questions to a client that reconnects after done, without another LLM call', async () => {
    const lessonId = await createLesson();
    fake.respondWithFixture('with-invalid-line');
    const quizId = await quizService.startStreamed(lessonId, SETTINGS);
    const first = await collect(streams, quizId);
    const requestsAfterRun = fake.requests.length;

    const replay = await collect(streams, quizId);

    expect(fake.requests).toHaveLength(requestsAfterRun);
    expect(positions(replay, 'question')).toEqual([1, 2, 3, 4, 5]);
    expect(
      replay.filter((event) => event.type === 'question_rejected'),
    ).toEqual([]);
    expect(replay.at(-1)).toEqual(first.at(-1));
  });

  it('gives a client that joins mid-run the saved questions, then the rest live, each once', async () => {
    const lessonId = await createLesson();
    fake.chunkSize = 50;
    fake.respondWithFixture('default', { chunkDelayMs: 15 });

    const quizId = await quizService.startStreamed(lessonId, SETTINGS);
    const early = collect(streams, quizId);
    // Join once the first question has been saved.
    await firstValueFrom(streams.events(quizId).pipe(take(1)));
    const late = await collect(streams, quizId);

    expect(positions(late, 'question')).toEqual([1, 2, 3, 4, 5]);
    expect(late.at(-1)?.type).toBe('done');
    expect(positions(await early, 'question')).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps generating when the client disconnects', async () => {
    const lessonId = await createLesson();
    fake.chunkSize = 50;
    fake.respondWithFixture('default', { chunkDelayMs: 10 });

    const quizId = await quizService.startStreamed(lessonId, SETTINGS);
    // Read one event, then go away (take(1) unsubscribes).
    await firstValueFrom(streams.events(quizId).pipe(take(1)));
    await streams.whenSettled(quizId);

    expect(await quizzes.findOneByOrFail({ id: quizId })).toMatchObject({
      status: 'draft',
    });
    expect(await questions.countBy({ quizId })).toBe(5);
  });

  it('fails the quiz with a problem event when the provider fails before any line', async () => {
    const lessonId = await createLesson();
    fake.failNext(1, 'bad_request');

    const quizId = await quizService.startStreamed(lessonId, SETTINGS);
    const events = await collect(streams, quizId);

    expect(events).toEqual([
      {
        type: 'problem',
        data: expect.objectContaining({
          type: 'urn:quizforge:problem:llm-upstream-error',
          status: 502,
          quizId,
          instance: `/api/quizzes/${quizId}/stream`,
        }),
      },
    ]);
    expect(await quizzes.findOneByOrFail({ id: quizId })).toMatchObject({
      status: 'failed',
      failureReason: 'provider_error',
    });
  });

  it('fails as invalid_output when no line is valid and the repair cannot fill any position', async () => {
    const lessonId = await createLesson();
    fake.respondNext('not json\n{"also":"wrong"}\n```\nnope');
    // Every repair call (2 attempts each, for 3 positions) is off-schema too.
    for (let i = 0; i < 6; i++) {
      fake.nextOffSchema();
    }

    const quizId = await quizService.startStreamed(lessonId, {
      ...SETTINGS,
      count: 3,
    });
    const events = await collect(streams, quizId);

    expect(positions(events, 'question_rejected')).toEqual([1, 2, 3]);
    expect(events.at(-1)).toMatchObject({
      type: 'problem',
      data: { type: 'urn:quizforge:problem:llm-invalid-output', quizId },
    });
    expect(await quizzes.findOneByOrFail({ id: quizId })).toMatchObject({
      status: 'failed',
      failureReason: 'invalid_output',
      streamRejected: 3,
    });
  });

  it('rejects extra lines past the requested count without repairing them', async () => {
    const lessonId = await createLesson();
    const before = fake.requests.length;

    const quizId = await quizService.startStreamed(lessonId, {
      ...SETTINGS,
      count: 3,
    });
    const events = await collect(streams, quizId);

    expect(positions(events, 'question')).toEqual([1, 2, 3]);
    expect(positions(events, 'question_rejected')).toEqual([4, 5]);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      data: { generated: 3, rejected: 2 },
    });
    expect(fake.requests.length - before).toBe(1);
  });

  it('sends a problem event for an unknown quiz', async () => {
    const events = await collect(
      streams,
      '00000000-0000-4000-8000-000000000000',
    );

    expect(events).toEqual([
      { type: 'problem', data: expect.objectContaining({ status: 404 }) },
    ]);
  });

  describe('stuck-quiz sweep', () => {
    const insertGenerating = async (minutesAgo: number) => {
      const lessonId = await createLesson();
      const quiz = await quizzes.save(
        quizzes.create({
          lessonId,
          status: 'generating',
          promptId: 'quiz-stream',
          promptVersion: 1,
          model: 'fake-model',
          settings: SETTINGS,
        }),
      );
      await quizzes.update(quiz.id, {
        createdAt: new Date(Date.now() - minutesAgo * 60_000),
      });
      return quiz.id;
    };

    it('fails a stale quiz without questions as interrupted, and makes one with questions a draft', async () => {
      const empty = await insertGenerating(10);
      const partial = await insertGenerating(10);
      await questions.insert({
        quizId: partial,
        position: 1,
        type: 'true_false',
        stem: 'Recursion needs a base case.',
        options: ['True', 'False'],
        correctIndex: 0,
        explanation: 'x',
        sourceQuote: 'Every recursive function needs a base case',
        status: 'draft',
        promptId: 'quiz-stream',
        promptVersion: 1,
        model: 'fake-model',
        original: {
          type: 'true_false',
          stem: 'Recursion needs a base case.',
          options: ['True', 'False'],
          correctIndex: 0,
          explanation: 'x',
          sourceQuote: 'Every recursive function needs a base case',
        },
      });

      await streams.sweepStuckQuizzes();

      expect(await quizzes.findOneByOrFail({ id: empty })).toMatchObject({
        status: 'failed',
        failureReason: 'interrupted',
      });
      expect(await quizzes.findOneByOrFail({ id: partial })).toMatchObject({
        status: 'draft',
        failureReason: null,
      });
    });

    it('leaves recent quizzes and quizzes this process is still generating alone', async () => {
      const recent = await insertGenerating(1);
      const active = await insertGenerating(10);
      moduleRef.get(ActiveGenerations).add(active);

      await streams.sweepStuckQuizzes();

      expect((await quizzes.findOneByOrFail({ id: recent })).status).toBe(
        'generating',
      );
      expect((await quizzes.findOneByOrFail({ id: active })).status).toBe(
        'generating',
      );
      moduleRef.get(ActiveGenerations).delete(active);
    });

    it('streams a problem event for a quiz the sweep failed', async () => {
      const quizId = await insertGenerating(10);
      await streams.sweepStuckQuizzes();

      const events = await collect(streams, quizId);

      expect(events).toEqual([
        {
          type: 'problem',
          data: expect.objectContaining({
            type: 'urn:quizforge:problem:quiz-generation-failed',
            failureReason: 'interrupted',
            quizId,
          }),
        },
      ]);
    });
  });
});

describe('Streamed quiz generation timeout (integration)', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await createModule(500);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('aborts the provider stream and fails the quiz as timeout when nothing was saved', async () => {
    const fake = moduleRef.get<FakeLlmClient>(LLM_CLIENT, { strict: false });
    const streams = moduleRef.get(QuizStreamService);
    const lessonId = (
      await moduleRef.get(LessonsService).create(loadSampleLesson('recursion'))
    ).id;
    // About 2 s for the first line: well past the 0.5 s timeout.
    fake.chunkSize = 20;
    fake.respondWithFixture('default', { chunkDelayMs: 100 });

    const quizId = await moduleRef
      .get(QuizService)
      .startStreamed(lessonId, SETTINGS);
    const events = await collect(streams, quizId);

    expect(events).toEqual([
      {
        type: 'problem',
        data: expect.objectContaining({
          type: 'urn:quizforge:problem:quiz-generation-failed',
          failureReason: 'timeout',
        }),
      },
    ]);
    expect(
      await moduleRef
        .get<Repository<Quiz>>(getRepositoryToken(Quiz))
        .findOneByOrFail({
          id: quizId,
        }),
    ).toMatchObject({ status: 'failed', failureReason: 'timeout' });
    const calls = await moduleRef
      .get<Repository<LlmCall>>(getRepositoryToken(LlmCall))
      .findBy({ correlationId: quizId });
    expect(calls).toEqual([
      expect.objectContaining({ status: 'error', errorCode: 'aborted' }),
    ]);
  });
});
