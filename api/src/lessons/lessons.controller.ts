import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CreateLessonDto } from './create-lesson.dto.js';
import type { Lesson } from './lesson.entity.js';
import { LessonsService } from './lessons.service.js';

export interface LessonResponse {
  id: string;
  title: string;
  content: string;
  contentHash: string;
  createdAt: string;
}

export function toLessonResponse(lesson: Lesson): LessonResponse {
  return {
    id: lesson.id,
    title: lesson.title,
    content: lesson.content,
    contentHash: lesson.contentHash,
    createdAt: lesson.createdAt.toISOString(),
  };
}

@Controller('lessons')
export class LessonsController {
  constructor(private readonly lessons: LessonsService) {}

  @Post()
  async create(@Body() body: CreateLessonDto): Promise<LessonResponse> {
    return toLessonResponse(await this.lessons.create(body));
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LessonResponse> {
    return toLessonResponse(await this.lessons.findById(id));
  }
}
