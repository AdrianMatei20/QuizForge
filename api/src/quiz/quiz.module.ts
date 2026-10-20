import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Env } from '../config/env.schema.js';
import { LessonsModule } from '../lessons/lessons.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { ActiveGenerations } from './active-generations.js';
import { Question } from './question.entity.js';
import { QuestionsController } from './questions.controller.js';
import {
  QUIZ_STREAM_OPTIONS,
  type QuizStreamOptions,
  QuizStreamService,
} from './quiz-stream.service.js';
import { Quiz } from './quiz.entity.js';
import { QuizService } from './quiz.service.js';
import { QuizzesController } from './quizzes.controller.js';
import { ReviewService } from './review.service.js';
import { QUIZ_RANDOM } from './shuffle.js';

/** Builds the stream service's options from validated config; exported so tests can override one value. */
export function quizStreamOptionsFromConfig(
  config: ConfigService<Env, true>,
): QuizStreamOptions {
  return {
    generationTimeoutMs: config.get('QUIZ_GENERATION_TIMEOUT_MS', {
      infer: true,
    }),
    sweepIntervalMs: config.get('QUIZ_STUCK_SWEEP_INTERVAL_MS', {
      infer: true,
    }),
  };
}

@Module({
  imports: [
    TypeOrmModule.forFeature([Quiz, Question]),
    LessonsModule,
    LlmModule,
  ],
  controllers: [QuizzesController, QuestionsController],
  providers: [
    QuizService,
    ReviewService,
    QuizStreamService,
    ActiveGenerations,
    // Overridden with a seeded generator in tests.
    { provide: QUIZ_RANDOM, useValue: Math.random },
    {
      provide: QUIZ_STREAM_OPTIONS,
      inject: [ConfigService],
      useFactory: quizStreamOptionsFromConfig,
    },
  ],
  // For AttemptsModule: a published quiz is its approved questions (findById).
  exports: [QuizService],
})
export class QuizModule {}
