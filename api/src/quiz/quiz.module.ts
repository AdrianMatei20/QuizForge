import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LessonsModule } from '../lessons/lessons.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { Question } from './question.entity.js';
import { Quiz } from './quiz.entity.js';
import { QuestionsController } from './questions.controller.js';
import { QuizService } from './quiz.service.js';
import { QuizzesController } from './quizzes.controller.js';
import { ReviewService } from './review.service.js';
import { QUIZ_RANDOM } from './shuffle.js';

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
    // Overridden with a seeded generator in tests.
    { provide: QUIZ_RANDOM, useValue: Math.random },
  ],
})
export class QuizModule {}
