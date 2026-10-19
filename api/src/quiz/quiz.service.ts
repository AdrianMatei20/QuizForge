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
import { buildQuizRequest, QUIZ_PROMPT } from './quiz-request.js';
import { Quiz } from './quiz.entity.js';
import type { QuizFailureReason, QuizSettings } from './quiz.types.js';
import { QUIZ_RANDOM, type Random, shuffleOptions } from './shuffle.js';

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
    const quiz = await this.quizzes.save(
      this.quizzes.create({
        lessonId,
        status: 'generating',
        promptId: QUIZ_PROMPT.id,
        promptVersion: QUIZ_PROMPT.version,
        model,
        settings: {
          count: settings.count,
          difficulty: settings.difficulty,
          types: settings.types,
        },
      }),
    );

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
          result.data.questions.map((question, index) => ({
            quizId: quiz.id,
            position: index + 1,
            type: question.type,
            stem: question.stem,
            ...shuffleOptions(question, this.random),
            explanation: question.explanation,
            sourceQuote: question.sourceQuote,
            status: 'draft' as const,
            promptId: QUIZ_PROMPT.id,
            promptVersion: result.promptVersion,
            model: result.model,
            original: question,
          })),
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
    }

    return this.findById(quiz.id);
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

  /** The lesson's quizzes, newest first, without their questions. 404 for an unknown lesson. */
  async listForLesson(lessonId: string, limit: number): Promise<Quiz[]> {
    await this.lessons.findById(lessonId);
    return this.quizzes.find({
      where: { lessonId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
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
