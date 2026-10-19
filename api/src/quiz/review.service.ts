import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  type DataSource,
  type EntityManager,
  IsNull,
  Not,
  type Repository,
} from 'typeorm';
import type { ProblemFieldError } from '../common/problem-details/problem-details.js';
import { jsonPointer } from '../common/problem-details/validation-problem.js';
import type { Env } from '../config/env.schema.js';
import { LessonsService } from '../lessons/lessons.service.js';
import { LlmService } from '../llm/llm.service.js';
import { Question } from './question.entity.js';
import { generatedQuestionSchema } from './quiz-output.schema.js';
import { buildRegenerateRequest, REGENERATE_PROMPT } from './quiz-request.js';
import { Quiz } from './quiz.entity.js';
import { computeReviewStats, type ReviewStats } from './review-stats.js';
import {
  emptyQuestionUpdateProblem,
  noApprovedQuestionsProblem,
  questionAlreadyReplacedProblem,
  questionRuleViolationsProblem,
  quizNotInReviewProblem,
  quizPublishedProblem,
} from './review.problems.js';
import { editedQuestionViolations } from './rules.js';
import { QUIZ_RANDOM, type Random, shuffleOptions } from './shuffle.js';
import { assertTransition } from './status-transitions.js';
import type { UpdateQuestionDto } from './update-question.dto.js';

/** The content fields a teacher can edit. */
type QuestionContent = Pick<
  Question,
  'stem' | 'options' | 'correctIndex' | 'explanation'
>;

/**
 * The teacher's review actions: edit, approve/reject, regenerate, publish,
 * and the review stats. Every write that depends on the quiz's status locks
 * the quiz row first (SELECT ... FOR UPDATE), so a publish cannot slip in
 * between checking "not published" and writing.
 */
@Injectable()
export class ReviewService {
  constructor(
    @InjectRepository(Question)
    private readonly questions: Repository<Question>,
    @InjectRepository(Quiz) private readonly quizzes: Repository<Quiz>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly lessons: LessonsService,
    private readonly llm: LlmService,
    private readonly config: ConfigService<Env, true>,
    @Inject(QUIZ_RANDOM) private readonly random: Random,
  ) {}

  /**
   * Applies content edits and/or a status change in one transaction.
   * Changed content must pass the question schema and the edit rules
   * (sourceQuote is not checked: a human has taken over). edited_at is set
   * only when the content actually changes.
   */
  async updateQuestion(
    id: string,
    update: UpdateQuestionDto,
  ): Promise<Question> {
    if (Object.values(update).every((value) => value === undefined)) {
      throw emptyQuestionUpdateProblem();
    }
    const { quizId } = await this.findQuestion(id);

    return this.dataSource.transaction(async (manager) => {
      const quiz = await this.lockQuiz(manager, quizId);
      if (quiz.status === 'published') {
        throw quizPublishedProblem(quiz.id);
      }
      // Read again under the lock: a regenerate may have replaced it meanwhile.
      const question = await manager.findOne(Question, { where: { id } });
      if (!question) {
        throw questionNotFound(id);
      }

      if (update.status !== undefined) {
        assertTransition(question.status, update.status);
      }

      const content: QuestionContent = {
        stem: update.stem ?? question.stem,
        options: update.options ?? question.options,
        correctIndex: update.correctIndex ?? question.correctIndex,
        explanation: update.explanation ?? question.explanation,
      };
      const contentChanged = !sameContent(question, content);
      if (contentChanged) {
        const others = await manager.find(Question, {
          where: { quizId, id: Not(id) },
          select: { position: true, stem: true },
        });
        assertValidEdit(question, content, others);
        Object.assign(question, content, { editedAt: new Date() });
      }
      if (update.status !== undefined) {
        question.status = update.status;
      }
      return manager.save(question);
    });
  }

  /**
   * Replaces a question with a newly generated one of the same type. The LLM
   * call happens outside any transaction (it takes seconds); then, in one
   * transaction, the old question is soft-deleted and the replacement is
   * inserted at the same position as a draft with its own `original`.
   */
  async regenerateQuestion(id: string): Promise<Question> {
    const question = await this.findQuestion(id);
    const quiz = await this.quizzes.findOneByOrFail({ id: question.quizId });
    if (quiz.status === 'published') {
      throw quizPublishedProblem(quiz.id);
    }
    const lesson = await this.lessons.findById(quiz.lessonId);
    const others = await this.questions.find({
      where: { quizId: quiz.id, id: Not(id) },
      select: { position: true, stem: true },
      order: { position: 'ASC' },
    });

    const result = await this.llm.generate(
      buildRegenerateRequest({
        lessonContent: lesson.content,
        settings: quiz.settings,
        model: this.config.get('LLM_MODEL', { infer: true }),
        minQuoteWords: this.config.get('QUIZ_SOURCE_QUOTE_MIN_WORDS', {
          infer: true,
        }),
        type: question.type,
        replacedStem: question.stem,
        others: others.map(({ position, stem }) => ({ position, stem })),
        correlationId: quiz.id,
      }),
    );
    const generated = result.data.question;

    return this.dataSource.transaction(async (manager) => {
      const locked = await this.lockQuiz(manager, quiz.id);
      if (locked.status === 'published') {
        throw quizPublishedProblem(quiz.id);
      }
      // Only succeeds once: a second regenerate racing this one finds the
      // question already deleted, instead of adding a second replacement.
      const deleted = await manager.softDelete(Question, {
        id,
        deletedAt: IsNull(),
      });
      if (deleted.affected !== 1) {
        throw questionAlreadyReplacedProblem(id);
      }
      return manager.save(
        manager.create(Question, {
          quizId: quiz.id,
          position: question.position,
          type: generated.type,
          stem: generated.stem,
          ...shuffleOptions(generated, this.random),
          explanation: generated.explanation,
          sourceQuote: generated.sourceQuote,
          status: 'draft',
          promptId: REGENERATE_PROMPT.id,
          promptVersion: result.promptVersion,
          model: result.model,
          original: generated,
        }),
      );
    });
  }

  /**
   * Publishes a draft quiz with at least one approved question. Nothing is
   * deleted: the published quiz is its approved questions (see
   * QuizService.findById), and the rest stay for the review stats.
   */
  async publish(quizId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const quiz = await this.lockQuiz(manager, quizId);
      if (quiz.status === 'published') {
        throw quizPublishedProblem(quiz.id);
      }
      if (quiz.status !== 'draft') {
        throw quizNotInReviewProblem(quiz.id, quiz.status);
      }
      const approved = await manager.count(Question, {
        where: { quizId, status: 'approved' },
      });
      if (approved === 0) {
        throw noApprovedQuestionsProblem(quiz.id);
      }
      await manager.update(Quiz, quizId, { status: 'published' });
    });
  }

  /** Counts and rates over the quiz's current questions, plus the regenerated (soft-deleted) ones. */
  async reviewStats(quizId: string): Promise<ReviewStats> {
    if (!(await this.quizzes.existsBy({ id: quizId }))) {
      throw new NotFoundException(`Quiz ${quizId} was not found`);
    }
    const rows = await this.questions.find({
      where: { quizId },
      withDeleted: true,
    });
    const current = rows.filter((row) => row.deletedAt === null);
    return computeReviewStats(current, rows.length - current.length);
  }

  private async findQuestion(id: string): Promise<Question> {
    const question = await this.questions.findOne({ where: { id } });
    if (!question) {
      throw questionNotFound(id);
    }
    return question;
  }

  private async lockQuiz(manager: EntityManager, id: string): Promise<Quiz> {
    const quiz = await manager.findOne(Quiz, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!quiz) {
      throw new NotFoundException(`Quiz ${id} was not found`);
    }
    return quiz;
  }
}

function questionNotFound(id: string): NotFoundException {
  return new NotFoundException(`Question ${id} was not found`);
}

function sameContent(a: QuestionContent, b: QuestionContent): boolean {
  return (
    a.stem === b.stem &&
    a.explanation === b.explanation &&
    a.correctIndex === b.correctIndex &&
    a.options.length === b.options.length &&
    a.options.every((option, index) => option === b.options[index])
  );
}

/**
 * The edited question must still be a valid question of its type (zod), and
 * then pass the edit rules. Schema problems point at the request field.
 */
function assertValidEdit(
  question: Question,
  content: QuestionContent,
  others: Pick<Question, 'position' | 'stem'>[],
): void {
  const parsed = generatedQuestionSchema.safeParse({
    type: question.type,
    ...content,
    sourceQuote: question.sourceQuote,
  });
  const errors: ProblemFieldError[] = parsed.success
    ? editedQuestionViolations(
        { ...content, type: question.type, sourceQuote: question.sourceQuote },
        question.position,
        others,
      ).map(({ detail, field }) =>
        // A field inside the question is the same field in the request body.
        field === undefined ? { detail } : { pointer: `#${field}`, detail },
      )
    : parsed.error.issues.map((issue) => ({
        pointer: jsonPointer(issue.path),
        detail: issue.message,
      }));
  if (errors.length > 0) {
    throw questionRuleViolationsProblem(errors);
  }
}
