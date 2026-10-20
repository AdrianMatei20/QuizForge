import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { Like, type Repository } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { EvalCliModule } from '../src/evals/eval-cli.module.js';
import { loadEvalLessons } from '../src/evals/eval-lesson.js';
import { EvalRun } from '../src/evals/eval-run.entity.js';
import {
  EvalRunner,
  type EvalRunOutcome,
} from '../src/evals/eval-runner.service.js';
import type { EvalReport } from '../src/evals/eval.types.js';
import { LlmCall } from '../src/llm/llm-call.entity.js';

/**
 * The eval harness end to end as a dry run: the fake provider, the real
 * runner, PostgreSQL (quizforge_test) and Redis. Reports go to a temporary
 * folder. Then the read-only API over the runs it saved.
 */
describe('Eval harness (e2e)', () => {
  let cli: Awaited<
    ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>
  >;
  let runner: EvalRunner;
  let runs: Repository<EvalRun>;
  let calls: Repository<LlmCall>;
  let resultsDir: string;
  let first: EvalRunOutcome;
  let second: EvalRunOutcome;

  beforeAll(async () => {
    cli = await Test.createTestingModule({
      imports: [EvalCliModule],
    }).compile();
    cli.useLogger(false);
    await cli.init();
    runner = cli.get(EvalRunner);
    runs = cli.get(getRepositoryToken(EvalRun));
    calls = cli.get(getRepositoryToken(LlmCall));
    resultsDir = mkdtempSync(join(tmpdir(), 'quizforge-evals-'));

    const options = {
      promptVersion: 1,
      model: 'fake-model',
      judgeModel: 'fake-judge-model',
      dryRun: true,
      lessons: loadEvalLessons(),
      resultsDir,
    };
    first = await runner.run(options);
    // A second run in a new second, so its report files get their own names.
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    second = await runner.run({ ...options, effort: 'low' });
  });

  afterAll(async () => {
    rmSync(resultsDir, { recursive: true, force: true });
    await cli.close();
  });

  describe('a dry run', () => {
    it('generates and judges every lesson; with the fake only the sample lessons it has answers for pass', () => {
      const m = first.report.metrics.overall;

      expect(m).toMatchObject({
        lessons: 10,
        // Recursion and HTTP caching have fixtures matching their settings;
        // binary search asks for 6 questions and its fixture has 5.
        lessonsFailed: 8,
        schemaValidRate: 1,
        rulePassBeforeRepairRate: 0.2,
        repairRate: 0.8,
        questionsSaved: 10,
        judged: 10,
        judgeErrors: 0,
        answerCorrectRate: 1,
        // The fake judge's canned verdict says false.
        testsUnderstandingRate: 0,
      });
      const recursion = first.report.lessons.find(
        (lesson) => lesson.slug === '01-recursion',
      );
      expect(recursion).toMatchObject({ status: 'ok', repaired: false });
      expect(recursion?.questions[0]?.verdict).toMatchObject({
        answerCorrect: true,
      });
      expect(
        first.report.lessons.find((lesson) => lesson.slug === '10-probability'),
      ).toMatchObject({
        status: 'failed',
        errorCode: 'invalid_output',
        repaired: true,
      });
    });

    it('writes a Markdown report with the dry-run warning, and the same data as JSON', () => {
      const markdown = readFileSync(first.markdownFile, 'utf8');
      const json = JSON.parse(
        readFileSync(first.jsonFile, 'utf8'),
      ) as EvalReport;

      expect(first.markdownFile.startsWith(resultsDir)).toBe(true);
      expect(markdown).toMatch(/^# Eval: quiz v1 · fake-model\n/);
      expect(markdown).toContain('Dry run: these numbers are meaningless.');
      expect(markdown).toContain('## Weakest questions');
      expect(json).toEqual(first.report);
    });

    it('saves an eval_runs row with the metrics, and no question text', async () => {
      const row = await runs.findOneByOrFail({ id: first.report.run.id });

      expect(row).toMatchObject({
        promptId: 'quiz',
        promptVersion: 1,
        model: 'fake-model',
        judgeModel: 'fake-judge-model',
        effort: null,
        dryRun: true,
        lessonCount: 10,
      });
      expect(row.metrics).toEqual(first.report.metrics);
      expect(JSON.stringify(row.metrics)).not.toContain('base case');
      expect(row.reportFile.endsWith('-v1.md')).toBe(true);
    });

    it('records its LLM calls under the run id, with eval features, effort and no generation cache', async () => {
      const generation = await calls.findBy({
        correlationId: Like(`${second.report.run.id}/gen/%`),
      });
      const judging = await calls.findBy({
        correlationId: Like(`${second.report.run.id}/judge/%`),
      });

      expect(generation).toHaveLength(10);
      expect(
        generation.every(
          (call) =>
            call.feature === 'eval-quiz-generation' &&
            call.effort === 'low' &&
            !call.cacheHit,
        ),
      ).toBe(true);
      expect(judging).toHaveLength(10);
      expect(judging.every((call) => call.feature === 'eval-judge')).toBe(true);
    });

    it('judges unchanged questions from the cache the second time', () => {
      expect(second.report.metrics.overall.judge).toMatchObject({
        calls: 10,
        cacheHits: 10,
        inputTokens: 0,
        outputTokens: 0,
      });
    });
  });

  describe('the API', () => {
    let app: NestExpressApplication;
    const http = () => request(app.getHttpServer());

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleRef.createNestApplication<NestExpressApplication>({
        logger: false,
      });
      configureApp(app);
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('lists runs newest first, without dry runs unless asked', async () => {
      const hidden = await http().get('/api/evals').expect(200);
      const shown = await http()
        .get('/api/evals?includeDryRuns=true&limit=200')
        .expect(200);

      const ids = (body: unknown) =>
        (body as { items: { id: string; dryRun: boolean }[] }).items.map(
          (run) => run.id,
        );
      expect(ids(hidden.body)).not.toContain(first.report.run.id);
      expect(
        (hidden.body as { items: { dryRun: boolean }[] }).items.every(
          (run) => !run.dryRun,
        ),
      ).toBe(true);
      const all = ids(shown.body);
      expect(all.indexOf(second.report.run.id)).toBeLessThan(
        all.indexOf(first.report.run.id),
      );
      expect(
        (shown.body as { items: Record<string, unknown>[] }).items.find(
          (run) => run['id'] === first.report.run.id,
        ),
      ).toMatchObject({
        promptVersion: 1,
        lessonCount: 10,
        lessonsFailed: 8,
        rulePassBeforeRepairRate: 0.2,
        testsUnderstandingRate: 0,
        totalCostUsd: '0.000000',
      });
    });

    it('compares two runs metric by metric', async () => {
      const response = await http()
        .get(
          `/api/evals/compare?a=${first.report.run.id}&b=${second.report.run.id}`,
        )
        .expect(200);
      const body = response.body as {
        a: { id: string };
        b: { id: string; effort: string };
        metrics: { key: string; delta: unknown; verdict: string }[];
      };

      expect(body.a.id).toBe(first.report.run.id);
      expect(body.b).toMatchObject({ id: second.report.run.id, effort: 'low' });
      expect(body.metrics.find((m) => m.key === 'quoteCopyRate')).toMatchObject(
        { delta: 0, verdict: 'same' },
      );
    });

    it.each([
      ['a=nope&b=nope', 400],
      ['b=00000000-0000-4000-8000-000000000000', 400],
      [
        'a=00000000-0000-4000-8000-000000000000&b=00000000-0000-4000-8000-000000000001',
        404,
      ],
    ])('answers %s with %i problem details', async (query, status) => {
      const response = await http()
        .get(`/api/evals/compare?${query}`)
        .expect(status);
      expect(response.headers['content-type']).toMatch(
        /application\/problem\+json/,
      );
    });

    it('rejects includeDryRuns values other than true and false', async () => {
      await http().get('/api/evals?includeDryRuns=yes').expect(400);
    });
  });
});
