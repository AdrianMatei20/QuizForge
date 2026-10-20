import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LessonsModule } from '../lessons/lessons.module.js';
import { QuizModule } from '../quiz/quiz.module.js';
import { AttemptStatsController } from './attempt-stats.controller.js';
import { Attempt } from './attempt.entity.js';
import { AttemptsService } from './attempts.service.js';
import { PublicQuizzesController } from './public-quizzes.controller.js';

/** Taking published quizzes (public) and the teacher's attempt stats. No LLM calls. */
@Module({
  imports: [TypeOrmModule.forFeature([Attempt]), QuizModule, LessonsModule],
  controllers: [PublicQuizzesController, AttemptStatsController],
  providers: [AttemptsService],
})
export class AttemptsModule {}
