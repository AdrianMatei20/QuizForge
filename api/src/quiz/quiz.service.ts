import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type { DataSource, Repository } from 'typeorm';
import type { Env } from '../config/env.schema.js';
import { LessonsService } from '../lessons/lessons.service.js';
import type { LlmUsageTotals } from '../llm/llm-call.store.js';
import { LlmService } from '../llm/llm.service.js';
import { Question } from './question.entity.js';
import { quizFailureReason } from './quiz-failure.js';
import { QuizGenerationFailedError } from './quiz-generation-failed.error.js';
import { ActiveGenerations } from './active-generations.js';
import {
  buildQuizRequest,
  QUIZ_PROMPT,
  QUIZ_STREAM_PROMPT,
} from './quiz-request.js';
import { QuizStreamService } from './quiz-stream.service.js';
import { Quiz } from './quiz.entity.js';
import type { QuizFailureReason, QuizSettings } from './quiz.types.js';
import { newQuestionRow } from './question-row.js';
import { QUIZ_RANDOM, type Random } from './shuffle.js';

@Injectable()
export class QuizService {
  private readonly logger = new Logger(QuizService.name);

  constructor(
    @InjectRepository(Quiz) private readonly quizzes: Repository<Quiz>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly lessons: LessonsService,
    private readonly llm: LlmService,
    private readonly config: ConfigService<Env, true>,
    @Inject(QUIZ_RANDOM) private readonly random: Random,
    private readonly streams: QuizStreamService,
    private readonly active: ActiveGenerations,
  ) {}

  /**
   * Generates a quiz synchronously:
   * 1. save the quiz as "generating" (so a crash mid-call leaves a trace);
   * 2. generate through LlmService (schema + rules + one repair), with the
   *    quiz id as correlation id so its llm_calls rows can be found;
   * 3. shuffle each multiple-choice question's options, so the answer's
   *    position carries no signal (`original` keeps the model's order);
   * 4. in one transaction, insert the questions and mark the quiz "draft".
   * Any failure marks the quiz "failed" with a failure_reason and throws
   * QuizGenerationFailedError: the original error (as `cause`) plus the
   * quiz id, so the client can find the failed quiz.
   */
  async generate(lessonId: string, settings: QuizSettings): Promise<Quiz> {
    const lesson = await this.lessons.findById(lessonId);
    // Passed explicitly, so the quiz row names the model before the call.
    const model = this.config.get('LLM_MODEL', { infer: true });
    const quiz = await this.createGenerating(lessonId, settings, QUIZ_PROMPT);

    // Tells the stuck-quiz sweep this "generating" quiz is being worked on.
    this.active.add(quiz.id);
    try {
      const result = await this.llm.generate(
        buildQuizRequest({
          lessonContent: lesson.content,
          settings,
          model,
          minQuoteWords: this.config.get('QUIZ_SOURCE_QUOTE_MIN_WORDS', {
            infer: true,
          }),
          correlationId: quiz.id,
        }),
      );

      await this.dataSource.transaction(async (manager) => {
        await manager.insert(
          Question,
          result.data.questions.map((generated, index) =>
            newQuestionRow({
              quizId: quiz.id,
              position: index + 1,
              generated,
              prompt: { id: QUIZ_PROMPT.id, version: result.promptVersion },
              model: result.model,
              random: this.random,
            }),
          ),
        );
        await manager.update(Quiz, quiz.id, {
          status: 'draft',
          model: result.model,
          promptVersion: result.promptVersion,
        });
      });
    } catch (error) {
      const reason = quizFailureReason(error);
      this.logFailure(quiz.id, reason, error);
      await this.markFailed(quiz.id, reason);
      throw new QuizGenerationFailedError(quiz.id, reason, { cause: error });
    } finally {
      this.active.delete(quiz.id);
    }

    return this.findById(quiz.id);
  }

  /**
   * Starts a streamed generation and returns the new quiz's id at once.
   * The questions arrive at GET /quizzes/:id/stream (QuizStreamService).
   */
  async startStreamed(
    lessonId: string,
    settings: QuizSettings,
  ): Promise<string> {
    const lesson = await this.lessons.findById(lessonId);
    const quiz = await this.createGenerating(
      lessonId,
      settings,
      QUIZ_STREAM_PROMPT,
    );
    this.streams.start(quiz, lesson.content);
    return quiz.id;
  }

  /** Saved first, so a crash mid-generation leaves a trace (and the sweep can clean it up). */
  private createGenerating(
    lessonId: string,
    settings: QuizSettings,
    prompt: { id: string; version: number },
  ): Promise<Quiz> {
    return this.quizzes.save(
      this.quizzes.create({
        lessonId,
        status: 'generating',
        promptId: prompt.id,
        promptVersion: prompt.version,
        model: this.config.get('LLM_MODEL', { infer: true }),
        settings: {
          count: settings.count,
          difficulty: settings.difficulty,
          types: settings.types,
        },
      }),
    );
  }

  /**
   * The quiz with its questions (soft-deleted ones excluded), in order. Once
   * published, a quiz consists of its approved questions only; the others
   * stay in the database for the review stats.
   */
  async findById(id: string): Promise<Quiz> {
    const quiz = await this.quizzes.findOne({
      where: { id },
      relations: { questions: true },
      order: { questions: { position: 'ASC' } },
    });
    if (!quiz) {
      throw new NotFoundException(`Quiz ${id} was not found`);
    }
    if (quiz.status === 'published') {
      quiz.questions = (quiz.questions ?? []).filter(
        (question) => question.status === 'approved',
      );
    }
    return quiz;
  }

  /**
   * The lesson's quizzes, newest first, without their questions but with how
   * many each has. 404 for an unknown lesson.
   */
  async listForLesson(
    lessonId: string,
    limit: number,
  ): Promise<{ quiz: Quiz; questionCount: number }[]> {
    await this.lessons.findById(lessonId);
    const quizzes = await this.quizzes.find({
      where: { lessonId },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: limit,
    });
    const counts = await this.questionCounts(quizzes.map((quiz) => quiz.id));
    return quizzes.map((quiz) => ({
      quiz,
      questionCount: counts.get(quiz.id) ?? 0,
    }));
  }

  /**
   * Questions per quiz, counted the way each quiz is shown: a published quiz
   * is only its approved questions; any other quiz, all its current ones.
   * Replaced (soft-deleted) questions never count: the query builder leaves
   * them out.
   */
  private async questionCounts(
    quizIds: string[],
  ): Promise<Map<string, number>> {
    if (quizIds.length === 0) {
      return new Map();
    }
    const rows = await this.dataSource
      .getRepository(Question)
      .createQueryBuilder('question')
      .innerJoin('question.quiz', 'quiz')
      .select('question.quizId', 'quizId')
      .addSelect('COUNT(*)::int', 'count')
      .where('question.quizId IN (:...quizIds)', { quizIds })
      .andWhere("(quiz.status <> 'published' OR question.status = 'approved')")
      .groupBy('question.quizId')
      .getRawMany<{ quizId: string; count: number }>();
    return new Map(rows.map((row) => [row.quizId, row.count]));
  }

  /** What generating this quiz used: every llm_calls row with the quiz id as correlation id. */
  async getCost(id: string): Promise<LlmUsageTotals> {
    if (!(await this.quizzes.existsBy({ id }))) {
      throw new NotFoundException(`Quiz ${id} was not found`);
    }
    return this.llm.getUsage(id);
  }

  /**
   * LLM errors are expected and LlmService already logged the details, so
   * one line with the quiz id is enough. Anything else is a bug or an outage:
   * log the full error so internal_error can be traced.
   */
  private logFailure(
    quizId: string,
    reason: QuizFailureReason,
    error: unknown,
  ): void {
    if (reason === 'internal_error') {
      this.logger.error(
        `Quiz ${quizId} failed: internal_error`,
        error instanceof Error ? error.stack : String(error),
      );
    } else {
      this.logger.warn(`Quiz ${quizId} failed: ${reason}`);
    }
  }

  /** Never throws: the generation error is the one the caller needs to see. */
  private async markFailed(
    quizId: string,
    reason: QuizFailureReason,
  ): Promise<void> {
    try {
      await this.quizzes.update(quizId, {
        status: 'failed',
        failureReason: reason,
      });
    } catch (error) {
      this.logger.error(
        `Could not mark quiz ${quizId} as failed (${reason}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
