import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Repository } from 'typeorm';
import type { Env } from '../config/env.schema.js';
import { CLOCK, type Clock } from '../llm/clock.js';
import type { LlmEffort } from '../llm/llm-client.js';
import { LlmService } from '../llm/llm.service.js';
import { LlmPricing } from '../llm/pricing.js';
import { PromptRegistry } from '../llm/prompt-registry.js';
import { quizFailureReason } from '../quiz/quiz-failure.js';
import type { GeneratedQuiz } from '../quiz/quiz-output.schema.js';
import { buildQuizRequest, QUIZ_PROMPT } from '../quiz/quiz-request.js';
import type { QuizRuleContext } from '../quiz/rules.js';
import { mapWithConcurrency } from './concurrency.js';
import type { EvalLesson } from './eval-lesson.js';
import {
  computeMetrics,
  isQuoteCopy,
  sharedQuoteFlags,
  summarizeFirstAnswer,
} from './eval-metrics.js';
import { API_DIR, EVAL_DRY_RUN_DIR, EVAL_RESULTS_DIR } from './eval-paths.js';
import { renderMarkdownReport } from './eval-report.js';
import { EvalRun } from './eval-run.entity.js';
import type {
  EvalQuestion,
  EvalReport,
  FirstAnswer,
  LessonResult,
} from './eval.types.js';
import { buildJudgeRequest, JUDGE_PROMPT } from './judge.js';

/** LLM calls in flight at once: fast enough, and well inside provider rate limits. */
export const EVAL_CONCURRENCY = 4;

export interface EvalRunOptions {
  promptVersion: number;
  model: string;
  judgeModel: string;
  effort?: LlmEffort;
  dryRun: boolean;
  lessons: EvalLesson[];
  /** Defaults to evals/results, or evals/results/dry-run for a dry run. */
  resultsDir?: string;
}

export interface EvalRunOutcome {
  report: EvalReport;
  markdownFile: string;
  jsonFile: string;
}

/**
 * Runs one eval: generates a quiz per lesson (cache off, the production
 * request), judges every final question (cache on), computes the metrics,
 * writes the Markdown and JSON reports, and saves an eval_runs row.
 *
 * Each lesson's calls get their own correlation ids, so its cost is read
 * back from llm_calls: that includes failed calls and repairs, which a
 * failed generate() never returns.
 */
@Injectable()
export class EvalRunner {
  private readonly logger = new Logger(EvalRunner.name);

  constructor(
    private readonly llm: LlmService,
    private readonly prompts: PromptRegistry,
    private readonly pricing: LlmPricing,
    private readonly config: ConfigService<Env, true>,
    @Inject(CLOCK) private readonly clock: Clock,
    @InjectRepository(EvalRun) private readonly runs: Repository<EvalRun>,
  ) {}

  /** Fails before any LLM call if the prompt does not exist or a model has no price. */
  assertRunnable(
    options: Pick<EvalRunOptions, 'promptVersion' | 'model' | 'judgeModel'>,
  ): void {
    this.prompts.get(QUIZ_PROMPT.id, options.promptVersion);
    for (const model of [options.model, options.judgeModel]) {
      if (!this.pricing.hasPrice(model)) {
        throw new Error(
          `Model "${model}" has no price in the pricing file, so the run's cost would be wrong. Add it first.`,
        );
      }
    }
  }

  async run(options: EvalRunOptions): Promise<EvalRunOutcome> {
    this.assertRunnable(options);
    const runId = randomUUID();
    const createdAt = this.clock.now();
    const minQuoteWords = this.config.get('QUIZ_SOURCE_QUOTE_MIN_WORDS', {
      infer: true,
    });

    const generated = await mapWithConcurrency(
      options.lessons,
      EVAL_CONCURRENCY,
      (lesson) => this.generateLesson(runId, lesson, options, minQuoteWords),
    );
    const lessons = await this.judgeAll(runId, generated, options);

    const report: EvalReport = {
      run: {
        id: runId,
        promptId: QUIZ_PROMPT.id,
        promptVersion: options.promptVersion,
        model: options.model,
        judgeModel: options.judgeModel,
        judgePromptVersion: JUDGE_PROMPT.version,
        effort: options.effort ?? null,
        dryRun: options.dryRun,
        createdAt: createdAt.toISOString(),
      },
      metrics: {
        overall: computeMetrics(lessons),
        lessons: lessons.map((lesson) => ({
          slug: lesson.slug,
          title: lesson.title,
          metrics: computeMetrics([lesson]),
        })),
      },
      lessons,
    };

    const { markdownFile, jsonFile } = this.writeReports(report, options);
    await this.runs.save(
      this.runs.create({
        id: runId,
        promptId: report.run.promptId,
        promptVersion: report.run.promptVersion,
        model: report.run.model,
        judgeModel: report.run.judgeModel,
        effort: report.run.effort,
        dryRun: report.run.dryRun,
        lessonCount: lessons.length,
        reportFile: relative(API_DIR, markdownFile).replaceAll('\\', '/'),
        metrics: report.metrics,
        createdAt,
      }),
    );
    return { report, markdownFile, jsonFile };
  }

  private async generateLesson(
    runId: string,
    lesson: EvalLesson,
    options: EvalRunOptions,
    minQuoteWords: number,
  ): Promise<LessonResult> {
    const context: QuizRuleContext = {
      lessonContent: lesson.content,
      settings: lesson.settings,
      minQuoteWords,
    };
    const correlationId = `${runId}/gen/${lesson.slug}`;
    let firstAnswer: FirstAnswer | null = null;
    let repaired = false;
    const request = buildQuizRequest({
      lessonContent: lesson.content,
      settings: lesson.settings,
      model: options.model,
      minQuoteWords,
      correlationId,
      promptVersion: options.promptVersion,
      feature: 'eval-quiz-generation',
      ...(options.effort === undefined ? {} : { effort: options.effort }),
    });
    request.onValidation = (check) => {
      if (check.attempt === 'first') {
        firstAnswer = summarizeFirstAnswer(check, context);
      } else {
        repaired = true;
      }
    };

    const startedAt = performance.now();
    let quiz: GeneratedQuiz | undefined;
    let errorCode: string | undefined;
    try {
      quiz = (await this.llm.generate(request)).data;
    } catch (error) {
      errorCode = quizFailureReason(error);
      // LlmService has already logged the failure; the outcome is logged below.
    }
    const latencyMs = Math.round(performance.now() - startedAt);
    const usage = await this.llm.getUsage(correlationId);
    const outcome = errorCode
      ? `failed (${errorCode})`
      : repaired
        ? 'ok after repair'
        : 'ok';
    this.logger.log(`Generated ${lesson.slug}: ${outcome}`);

    const questions = quiz?.questions ?? [];
    const shared = sharedQuoteFlags(questions);
    return {
      slug: lesson.slug,
      title: lesson.title,
      count: lesson.settings.count,
      difficulty: lesson.settings.difficulty,
      status: quiz ? 'ok' : 'failed',
      ...(errorCode === undefined ? {} : { errorCode }),
      firstAnswer,
      repaired,
      questions: questions.map((question, i): EvalQuestion => ({
        ...question,
        number: i + 1,
        quoteCopy: isQuoteCopy(question),
        sharedQuote: shared[i] ?? false,
        verdict: null,
      })),
      generation: {
        calls: usage.calls,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd: usage.costUsd,
        latencyMs,
      },
      judge: {
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: '0.000000',
        cacheHits: 0,
      },
    };
  }

  /** Judges every final question of every lesson, a few calls at a time. */
  private async judgeAll(
    runId: string,
    lessons: LessonResult[],
    options: Pick<EvalRunOptions, 'judgeModel' | 'lessons'>,
  ): Promise<LessonResult[]> {
    const lessonContent = new Map(
      options.lessons.map((lesson) => [lesson.slug, lesson.content]),
    );
    const jobs = lessons.flatMap((lesson) =>
      lesson.questions.map((question) => ({ lesson, question })),
    );
    const cacheHits = new Map<string, number>();

    const judged = await mapWithConcurrency(
      jobs,
      EVAL_CONCURRENCY,
      async ({ lesson, question }) => {
        try {
          const result = await this.llm.generate(
            buildJudgeRequest({
              lessonContent: lessonContent.get(lesson.slug) ?? '',
              question,
              model: options.judgeModel,
              correlationId: `${runId}/judge/${lesson.slug}`,
            }),
          );
          if (result.cacheHit) {
            cacheHits.set(lesson.slug, (cacheHits.get(lesson.slug) ?? 0) + 1);
          }
          return { ...question, verdict: result.data };
        } catch (error) {
          return {
            ...question,
            verdict: null,
            judgeError: quizFailureReason(error),
          };
        }
      },
    );

    const bySlug = new Map<string, EvalQuestion[]>();
    jobs.forEach(({ lesson }, i) => {
      const list = bySlug.get(lesson.slug) ?? [];
      list.push(judged[i] as EvalQuestion);
      bySlug.set(lesson.slug, list);
    });

    return Promise.all(
      lessons.map(async (lesson) => {
        const usage = await this.llm.getUsage(`${runId}/judge/${lesson.slug}`);
        return {
          ...lesson,
          questions: bySlug.get(lesson.slug) ?? [],
          judge: {
            calls: usage.calls,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            costUsd: usage.costUsd,
            cacheHits: cacheHits.get(lesson.slug) ?? 0,
          },
        };
      }),
    );
  }

  private writeReports(
    report: EvalReport,
    options: EvalRunOptions,
  ): { markdownFile: string; jsonFile: string } {
    const dir =
      options.resultsDir ??
      (options.dryRun ? EVAL_DRY_RUN_DIR : EVAL_RESULTS_DIR);
    mkdirSync(dir, { recursive: true });
    const base = reportBaseName(report.run.createdAt, report.run.promptVersion);
    const markdownFile = join(dir, `${base}.md`);
    const jsonFile = join(dir, `${base}.json`);
    writeFileSync(jsonFile, `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(markdownFile, renderMarkdownReport(report, `${base}.json`));
    return { markdownFile, jsonFile };
  }
}

/** "2026-10-19T151500Z-v2": sorts by time, names the prompt version, and is a valid file name. */
export function reportBaseName(
  createdAtIso: string,
  promptVersion: number,
): string {
  const day = createdAtIso.slice(0, 10);
  const time = createdAtIso.slice(11, 19).replaceAll(':', '');
  return `${day}T${time}Z-v${promptVersion}`;
}
