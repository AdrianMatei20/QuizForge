import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { validationProblem } from '../common/problem-details/validation-problem.js';
import type { Env } from '../config/env.schema.js';
import { LessonsService } from '../lessons/lessons.service.js';
import type { Quiz } from '../quiz/quiz.entity.js';
import { QuizService } from '../quiz/quiz.service.js';
import { Attempt } from './attempt.entity.js';
import {
  attemptStats,
  type AttemptStats,
  type FlagThresholds,
} from './attempt-stats.js';
import {
  type AnswerResult,
  scoreAttempt,
  type SubmittedAnswer,
} from './scoring.js';

export interface PublicQuiz {
  quiz: Quiz;
  lessonTitle: string;
}

export interface ScoredAttempt {
  attemptId: string;
  score: number;
  total: number;
  results: AnswerResult[];
}

/** Taking a published quiz, and what the attempts say about its questions. */
@Injectable()
export class AttemptsService {
  constructor(
    @InjectRepository(Attempt) private readonly attempts: Repository<Attempt>,
    private readonly quizzes: QuizService,
    private readonly lessons: LessonsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * A published quiz with its approved questions. A draft, failed or
   * generating quiz is a 404 with the same message as an unknown one, so the
   * public endpoints do not reveal that it exists.
   */
  async findPublished(id: string): Promise<PublicQuiz> {
    const quiz = await this.quizzes.findById(id).catch((error: unknown) => {
      throw error instanceof NotFoundException ? notPublished(id) : error;
    });
    if (quiz.status !== 'published') {
      throw notPublished(id);
    }
    const lesson = await this.lessons.findById(quiz.lessonId);
    return { quiz, lessonTitle: lesson.title };
  }

  /** Scores on the server and stores the attempt; 400 problem details if any answer is missing, repeated or invalid. */
  async submit(
    quizId: string,
    answers: SubmittedAnswer[],
  ): Promise<ScoredAttempt> {
    const { quiz } = await this.findPublished(quizId);
    const outcome = scoreAttempt(quiz.questions ?? [], answers);
    if (!outcome.ok) {
      throw validationProblem(outcome.errors);
    }
    const attempt = await this.attempts.save(
      this.attempts.create({
        quizId,
        score: outcome.score,
        answers: outcome.results.map(
          ({ questionId, selectedIndex, correct }) => ({
            questionId,
            selectedIndex,
            correct,
          }),
        ),
      }),
    );
    return {
      attemptId: attempt.id,
      score: outcome.score,
      total: outcome.total,
      results: outcome.results,
    };
  }

  /**
   * Per-question correctness for the teacher. Reads every attempt of the
   * quiz: few enough per quiz to sum in memory, which keeps the arithmetic
   * in one pure, tested function. Any quiz can be asked; one that is not
   * published simply has no attempts.
   */
  async stats(
    quizId: string,
  ): Promise<AttemptStats & { thresholds: FlagThresholds }> {
    const quiz = await this.quizzes.findById(quizId);
    const attempts = await this.attempts.find({
      where: { quizId },
      select: { score: true, answers: true },
    });
    const thresholds = this.thresholds();
    return {
      ...attemptStats(quiz.questions ?? [], attempts, thresholds),
      thresholds,
    };
  }

  private thresholds(): FlagThresholds {
    return {
      tooEasyAbove: this.config.get('ATTEMPT_FLAG_TOO_EASY_ABOVE', {
        infer: true,
      }),
      possiblyWrongBelow: this.config.get('ATTEMPT_FLAG_POSSIBLY_WRONG_BELOW', {
        infer: true,
      }),
      minAttempts: this.config.get('ATTEMPT_FLAG_MIN_ATTEMPTS', {
        infer: true,
      }),
    };
  }
}

function notPublished(id: string): NotFoundException {
  return new NotFoundException(`Quiz ${id} was not found or is not published`);
}
