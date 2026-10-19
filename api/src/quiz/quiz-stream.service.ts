import {
  type BeforeApplicationShutdown,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Observable, Subject } from 'rxjs';
import { LessThan, type Repository } from 'typeorm';
import {
  GENERIC_SERVER_ERROR_DETAIL,
  PROBLEM_TYPES,
  type ProblemDetails,
} from '../common/problem-details/problem-details.js';
import type { Env } from '../config/env.schema.js';
import { LlmInvalidOutputError } from '../llm/llm.errors.js';
import { LlmService } from '../llm/llm.service.js';
import { parseModelOutput } from '../llm/output-parser.js';
import { ActiveGenerations } from './active-generations.js';
import { JsonLinesParser } from './json-lines-parser.js';
import { newQuestionRow } from './question-row.js';
import { Question } from './question.entity.js';
import { quizFailureReason } from './quiz-failure.js';
import { QuizGenerationFailedError } from './quiz-generation-failed.error.js';
import { generatedQuestionSchema } from './quiz-output.schema.js';
import {
  buildQuizStreamRequest,
  buildRegenerateRequest,
  QUIZ_STREAM_PROMPT,
  REGENERATE_PROMPT,
} from './quiz-request.js';
import { isFinalEvent, type QuizStreamEvent } from './quiz-stream.events.js';
import { Quiz } from './quiz.entity.js';
import { toQuestionResponse, toStreamUsage } from './quiz.mapper.js';
import type { QuestionType, QuizFailureReason } from './quiz.types.js';
import { type OtherQuestion, streamedQuestionViolations } from './rules.js';
import { QUIZ_RANDOM, type Random } from './shuffle.js';

export interface QuizStreamOptions {
  /** QUIZ_GENERATION_TIMEOUT_MS: the whole run, repair included. */
  generationTimeoutMs: number;
  /** QUIZ_STUCK_SWEEP_INTERVAL_MS. */
  sweepIntervalMs: number;
}

export const QUIZ_STREAM_OPTIONS = Symbol('QUIZ_STREAM_OPTIONS');

/** A quiz is only "stuck" once it is this much older than the timeout, so a live run is never swept. */
const SWEEP_MARGIN_MS = 60_000;

interface Run {
  /** Live events for clients attached while the run is going. */
  readonly events: Subject<QuizStreamEvent>;
  readonly abort: AbortController;
  /** Why the run was aborted, if it was. */
  abortReason?: Extract<QuizFailureReason, 'timeout' | 'interrupted'>;
  done?: Promise<void>;
}

/** What is known about a line that failed, to steer its replacement. */
interface RejectedLine {
  type?: QuestionType;
  stem?: string;
}

/**
 * Streamed quiz generation. Each quiz is generated once, in the background,
 * independent of any HTTP connection: a client that disconnects (a page
 * refresh) loses nothing, and any number of clients can watch.
 *
 * A run: stream JSON Lines from the model; validate each complete line
 * (schema, per-question rules, duplicate stems, count) as it arrives; save
 * and emit valid ones, emit question_rejected for the rest; then one repair
 * step regenerates every missing position with the regenerate prompt; then
 * the quiz becomes a draft (at least one question) or failed (none), and the
 * run emits done or problem.
 *
 * Live events are kept in memory, so they reach clients of this process
 * only. Saved questions are in the database, so replay works anywhere and
 * after a restart. (Several API instances would need Redis pub/sub for the
 * live part; see the README's known limitations.)
 */
@Injectable()
export class QuizStreamService
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(QuizStreamService.name);
  private readonly runs = new Map<string, Run>();
  private sweepTimer: NodeJS.Timeout | undefined;

  constructor(
    @InjectRepository(Quiz) private readonly quizzes: Repository<Quiz>,
    @InjectRepository(Question)
    private readonly questions: Repository<Question>,
    private readonly llm: LlmService,
    private readonly config: ConfigService<Env, true>,
    private readonly active: ActiveGenerations,
    @Inject(QUIZ_RANDOM) private readonly random: Random,
    @Inject(QUIZ_STREAM_OPTIONS) private readonly options: QuizStreamOptions,
  ) {}

  /** Starts generating a quiz that was just saved as "generating". Returns at once. */
  start(quiz: Quiz, lessonContent: string): void {
    const run: Run = { events: new Subject(), abort: new AbortController() };
    this.runs.set(quiz.id, run);
    this.active.add(quiz.id);
    run.done = this.execute(quiz, lessonContent, run)
      .catch((error: unknown) => {
        // execute() handles its own failures; this is a last-resort guard.
        this.logger.error(
          `Quiz ${quiz.id} stream run crashed`,
          error instanceof Error ? error.stack : String(error),
        );
      })
      .finally(() => {
        run.events.complete();
        this.runs.delete(quiz.id);
        this.active.delete(quiz.id);
      });
  }

  /** Resolves when the quiz's run (if any) has finished. For tests and shutdown. */
  async whenSettled(quizId: string): Promise<void> {
    await this.runs.get(quizId)?.done;
  }

  /**
   * Events for one client: first every saved question (a reconnect replays
   * what it missed), then either the live events of the running generation,
   * or straight away `done` (finished) or `problem` (failed, or unknown quiz).
   * Unsubscribing only detaches this client; generation carries on.
   */
  events(quizId: string): Observable<QuizStreamEvent> {
    const instance = `/api/quizzes/${quizId}/stream`;
    return new Observable<QuizStreamEvent>((subscriber) => {
      const sentPositions = new Set<number>();
      const buffered: QuizStreamEvent[] = [];
      let replaying = true;
      let liveEnded = false;

      const forward = (event: QuizStreamEvent) => {
        if (subscriber.closed) return;
        if (event.type === 'question') {
          // A question saved during the replay can arrive twice: once from
          // the database, once live. Each position is sent once.
          if (sentPositions.has(event.data.position)) return;
          sentPositions.add(event.data.position);
        }
        subscriber.next(event);
        if (isFinalEvent(event)) {
          subscriber.complete();
        }
      };

      const fail = (error: unknown) => {
        this.logger.error(
          `Stream for quiz ${quizId} failed`,
          error instanceof Error ? error.stack : String(error),
        );
        forward({
          type: 'problem',
          data: {
            type: PROBLEM_TYPES.httpStatus,
            title: 'Internal Server Error',
            status: HttpStatus.INTERNAL_SERVER_ERROR,
            detail: GENERIC_SERVER_ERROR_DETAIL,
            instance,
          },
        });
      };

      /**
       * The run ended without this client seeing its final event (it joined
       * as the run was finishing): the database already has the outcome.
       */
      const finishFromDatabase = async () => {
        if (subscriber.closed) return;
        const quiz = await this.quizzes.findOne({
          where: { id: quizId },
          relations: { questions: true },
        });
        forward(
          quiz
            ? await this.finalEventFromDatabase(quiz, instance)
            : { type: 'problem', data: notFoundProblem(quizId, instance) },
        );
      };

      // Attach to the live events first, so nothing is lost between the
      // database read and the attach; buffer them until the replay is done.
      const run = this.runs.get(quizId);
      const live = run?.events.subscribe({
        next: (event) => {
          if (replaying) {
            buffered.push(event);
          } else {
            forward(event);
          }
        },
        complete: () => {
          liveEnded = true;
          if (!replaying) {
            finishFromDatabase().catch(fail);
          }
        },
      });

      void (async () => {
        const quiz = await this.quizzes.findOne({
          where: { id: quizId },
          relations: { questions: true },
          order: { questions: { position: 'ASC' } },
        });
        if (!quiz) {
          forward({ type: 'problem', data: notFoundProblem(quizId, instance) });
          return;
        }
        for (const question of quiz.questions ?? []) {
          forward({ type: 'question', data: toQuestionResponse(question) });
        }
        replaying = false;
        if (run) {
          buffered.forEach(forward);
          if (liveEnded) {
            await finishFromDatabase();
          }
          return;
        }
        forward(await this.finalEventFromDatabase(quiz, instance));
      })().catch(fail);

      return () => live?.unsubscribe();
    });
  }

  /**
   * Marks quizzes left "generating" by a crash or restart: a draft if they
   * have questions, otherwise failed with reason "interrupted". Runs at
   * startup and every QUIZ_STUCK_SWEEP_INTERVAL_MS. Returns how many it fixed.
   */
  async sweepStuckQuizzes(now = new Date()): Promise<number> {
    const cutoff = new Date(
      now.getTime() - this.options.generationTimeoutMs - SWEEP_MARGIN_MS,
    );
    const stuck = await this.quizzes.find({
      where: { status: 'generating', createdAt: LessThan(cutoff) },
      select: { id: true },
    });
    let fixed = 0;
    for (const { id } of stuck) {
      if (this.active.has(id)) {
        continue;
      }
      const questions = await this.questions.countBy({ quizId: id });
      await this.quizzes.update(
        { id, status: 'generating' },
        questions > 0
          ? { status: 'draft' }
          : { status: 'failed', failureReason: 'interrupted' },
      );
      this.logger.warn(
        `Quiz ${id} was stuck in "generating"; marked ${questions > 0 ? 'draft' : 'failed (interrupted)'}`,
      );
      fixed++;
    }
    return fixed;
  }

  onApplicationBootstrap(): void {
    void this.sweepSafely();
    this.sweepTimer = setInterval(
      () => void this.sweepSafely(),
      this.options.sweepIntervalMs,
    );
    // Never keep the process alive just for the sweep.
    this.sweepTimer.unref();
  }

  /** Graceful shutdown: stop every run now, and record it, while the database is still there. */
  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.sweepTimer);
    const runs = [...this.runs.values()];
    for (const run of runs) {
      run.abortReason ??= 'interrupted';
      run.abort.abort();
    }
    await Promise.allSettled(
      runs.flatMap((run) => (run.done ? [run.done] : [])),
    );
  }

  private async sweepSafely(): Promise<void> {
    try {
      await this.sweepStuckQuizzes();
    } catch (error) {
      this.logger.error(
        'Stuck-quiz sweep failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async execute(
    quiz: Quiz,
    lessonContent: string,
    run: Run,
  ): Promise<void> {
    const timer = setTimeout(() => {
      run.abortReason ??= 'timeout';
      run.abort.abort();
    }, this.options.generationTimeoutMs);
    timer.unref();

    const settings = quiz.settings;
    const minQuoteWords = this.config.get('QUIZ_SOURCE_QUOTE_MIN_WORDS', {
      infer: true,
    });
    const context = { lessonContent, settings, minQuoteWords };
    const saved: OtherQuestion[] = [];
    const rejected = new Map<number, RejectedLine>();
    const violationsSeen: string[] = [];
    let rejectedCount = 0;
    let position = 0;
    let model = quiz.model;
    let promptVersion = quiz.promptVersion;

    const handleLine = async (line: string) => {
      position++;
      const parsed = parseModelOutput(line, generatedQuestionSchema);
      const violations = parsed.ok
        ? streamedQuestionViolations(parsed.data, position, saved, context)
        : parsed.violations.map(({ pointer, message }) =>
            pointer === undefined || pointer === '#'
              ? `question ${position}: ${message}`
              : `question ${position}: ${pointer.slice(2)}: ${message}`,
          );
      if (!parsed.ok || violations.length > 0) {
        rejectedCount++;
        violationsSeen.push(...violations);
        if (position <= settings.count) {
          rejected.set(
            position,
            parsed.ok ? { type: parsed.data.type, stem: parsed.data.stem } : {},
          );
        }
        run.events.next({
          type: 'question_rejected',
          data: { position, violations },
        });
        return;
      }
      await this.saveAndEmit(
        run,
        quiz.id,
        position,
        parsed.data,
        QUIZ_STREAM_PROMPT.id,
        promptVersion,
        model,
      );
      saved.push({ position, stem: parsed.data.stem });
    };

    let failure: unknown;
    try {
      const parser = new JsonLinesParser();
      for await (const event of this.llm.stream(
        buildQuizStreamRequest({
          lessonContent,
          settings,
          model: quiz.model,
          correlationId: quiz.id,
          signal: run.abort.signal,
          timeoutMs: this.options.generationTimeoutMs,
        }),
      )) {
        if (event.type === 'text') {
          for (const line of parser.push(event.text)) {
            await handleLine(line);
          }
        } else {
          model = event.model;
          promptVersion = event.promptVersion;
        }
      }
      for (const line of parser.end()) {
        await handleLine(line);
      }

      // The one repair step: every position without a saved question, the
      // rejected ones and any the model never reached.
      const savedPositions = new Set(
        saved.map((question) => question.position),
      );
      for (let missing = 1; missing <= settings.count; missing++) {
        if (savedPositions.has(missing) || run.abort.signal.aborted) {
          continue;
        }
        await this.repair(
          run,
          quiz,
          context,
          missing,
          rejected.get(missing) ?? {},
          saved,
        );
      }
    } catch (error) {
      failure = error;
    } finally {
      clearTimeout(timer);
    }

    await this.finish(run, quiz.id, {
      saved: saved.length,
      rejectedCount,
      model,
      promptVersion,
      failure,
      violationsSeen,
    });
  }

  /** Regenerates one missing position. A failure leaves the gap; the quiz is still usable. */
  private async repair(
    run: Run,
    quiz: Quiz,
    context: {
      lessonContent: string;
      settings: Quiz['settings'];
      minQuoteWords: number;
    },
    position: number,
    line: RejectedLine,
    saved: OtherQuestion[],
  ): Promise<void> {
    const type =
      line.type !== undefined && context.settings.types.includes(line.type)
        ? line.type
        : (context.settings.types[0] ?? 'multiple_choice');
    try {
      const result = await this.llm.generate({
        ...buildRegenerateRequest({
          ...context,
          model: quiz.model,
          type,
          replacedStem: line.stem ?? '(none)',
          others: [...saved],
          correlationId: quiz.id,
        }),
        signal: run.abort.signal,
      });
      await this.saveAndEmit(
        run,
        quiz.id,
        position,
        result.data.question,
        REGENERATE_PROMPT.id,
        result.promptVersion,
        result.model,
      );
      saved.push({ position, stem: result.data.question.stem });
      saved.sort((a, b) => a.position - b.position);
    } catch (error) {
      this.logger.warn(
        `Quiz ${quiz.id}: repair of question ${position} failed (${error instanceof Error ? error.name : 'error'})`,
      );
    }
  }

  private async saveAndEmit(
    run: Run,
    quizId: string,
    position: number,
    generated: Parameters<typeof newQuestionRow>[0]['generated'],
    promptId: string,
    promptVersion: number,
    model: string,
  ): Promise<void> {
    const question = await this.questions.save(
      this.questions.create(
        newQuestionRow({
          quizId,
          position,
          generated,
          prompt: { id: promptId, version: promptVersion },
          model,
          random: this.random,
        }),
      ),
    );
    run.events.next({ type: 'question', data: toQuestionResponse(question) });
  }

  /** A draft with whatever was saved, or failed if nothing was; then done or problem. */
  private async finish(
    run: Run,
    quizId: string,
    outcome: {
      saved: number;
      rejectedCount: number;
      model: string;
      promptVersion: number;
      failure: unknown;
      violationsSeen: string[];
    },
  ): Promise<void> {
    const instance = `/api/quizzes/${quizId}/stream`;
    try {
      if (outcome.saved > 0) {
        await this.quizzes.update(quizId, {
          status: 'draft',
          streamRejected: outcome.rejectedCount,
          model: outcome.model,
          promptVersion: outcome.promptVersion,
        });
        if (outcome.failure !== undefined) {
          this.logger.warn(
            `Quiz ${quizId}: stream ended early (${run.abortReason ?? quizFailureReason(outcome.failure)}); kept ${outcome.saved} questions`,
          );
        }
        run.events.next({
          type: 'done',
          data: {
            generated: outcome.saved,
            rejected: outcome.rejectedCount,
            usage: toStreamUsage(await this.llm.getUsage(quizId)),
          },
        });
        return;
      }

      // Nothing saved: the quiz failed. Use the error that stopped the run,
      // or, if every line was simply invalid, an invalid-output error.
      const cause =
        outcome.failure ??
        new LlmInvalidOutputError(
          outcome.violationsSeen.length > 0
            ? outcome.violationsSeen.map((message) => ({ message }))
            : [{ message: 'The model wrote no usable question.' }],
        );
      const reason = run.abortReason ?? quizFailureReason(cause);
      await this.quizzes.update(quizId, {
        status: 'failed',
        failureReason: reason,
        streamRejected: outcome.rejectedCount,
      });
      if (reason === 'internal_error') {
        this.logger.error(
          `Quiz ${quizId} failed: internal_error`,
          cause instanceof Error
            ? cause.stack
            : 'a thrown value that is not an Error',
        );
      } else {
        this.logger.warn(`Quiz ${quizId} failed: ${reason}`);
      }
      run.events.next({
        type: 'problem',
        // An abort (timeout, shutdown) has no problem details of its own;
        // any other failure keeps those of the error, plus the quiz id.
        data:
          run.abortReason === undefined
            ? {
                ...new QuizGenerationFailedError(quizId, reason, {
                  cause,
                }).toProblem().problem,
                instance,
              }
            : failedQuizProblem(quizId, reason, instance),
      });
    } catch (error) {
      this.logger.error(
        `Quiz ${quizId}: could not record the end of the run`,
        error instanceof Error ? error.stack : String(error),
      );
      run.events.next({
        type: 'problem',
        data: {
          type: PROBLEM_TYPES.httpStatus,
          title: 'Internal Server Error',
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          detail: GENERIC_SERVER_ERROR_DETAIL,
          instance,
          quizId,
        },
      });
    }
  }

  /** For a client arriving after the run: done or problem, rebuilt from the database. */
  private async finalEventFromDatabase(
    quiz: Quiz,
    instance: string,
  ): Promise<QuizStreamEvent> {
    if (quiz.status === 'draft' || quiz.status === 'published') {
      return {
        type: 'done',
        data: {
          generated: quiz.questions?.length ?? 0,
          rejected: quiz.streamRejected,
          usage: toStreamUsage(await this.llm.getUsage(quiz.id)),
        },
      };
    }
    if (quiz.status === 'failed') {
      return {
        type: 'problem',
        data: failedQuizProblem(
          quiz.id,
          quiz.failureReason ?? 'internal_error',
          instance,
        ),
      };
    }
    // "generating", but no run in this process: it was interrupted (a restart).
    return {
      type: 'problem',
      data: {
        type: 'urn:quizforge:problem:quiz-generation-interrupted',
        title: 'Quiz generation interrupted',
        status: HttpStatus.CONFLICT,
        detail:
          'This quiz stopped being generated (the server restarted). It will be marked as failed or draft shortly.',
        instance,
        quizId: quiz.id,
      },
    };
  }
}

const FAILURE_DETAIL: Record<QuizFailureReason, string> = {
  invalid_output: 'the AI kept returning answers that could not be used',
  refusal: 'the AI declined to write questions for this lesson',
  truncated: 'the AI answer was cut off',
  budget_exceeded: "today's AI budget was used up",
  timeout: 'generation took longer than the time limit',
  rate_limited: 'the AI service was busy',
  provider_error: 'the AI service had a problem',
  cancelled: 'the request was cancelled',
  internal_error: 'of an unexpected error',
  interrupted: 'the server stopped while generating it',
};

/** A failed quiz, described for a stream client. */
function failedQuizProblem(
  quizId: string,
  reason: QuizFailureReason,
  instance: string,
): ProblemDetails {
  return {
    type: 'urn:quizforge:problem:quiz-generation-failed',
    title: 'Quiz generation failed',
    status: HttpStatus.CONFLICT,
    detail: `This quiz could not be generated because ${FAILURE_DETAIL[reason]}.`,
    instance,
    quizId,
    failureReason: reason,
  };
}

function notFoundProblem(quizId: string, instance: string): ProblemDetails {
  return {
    type: PROBLEM_TYPES.httpStatus,
    title: 'Not Found',
    status: HttpStatus.NOT_FOUND,
    detail: `Quiz ${quizId} was not found`,
    instance,
  };
}
