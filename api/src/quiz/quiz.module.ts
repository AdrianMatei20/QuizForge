import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LessonsModule } from '../lessons/lessons.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { Question } from './question.entity.js';
import { Quiz } from './quiz.entity.js';
import { QuizService } from './quiz.service.js';
import { QuizzesController } from './quizzes.controller.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Quiz, Question]),
    LessonsModule,
    LlmModule,
  ],
  controllers: [QuizzesController],
  providers: [QuizService],
})
export class QuizModule {}
