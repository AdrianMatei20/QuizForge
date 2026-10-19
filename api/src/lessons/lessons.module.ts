import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Quiz } from '../quiz/quiz.entity.js';
import { Lesson } from './lesson.entity.js';
import { LessonsController } from './lessons.controller.js';
import { LessonsService } from './lessons.service.js';

@Module({
  // Quiz only for the per-status quiz counts in the lesson list.
  imports: [TypeOrmModule.forFeature([Lesson, Quiz])],
  controllers: [LessonsController],
  providers: [LessonsService],
  exports: [LessonsService],
})
export class LessonsModule {}
