import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { ApiProblems, PROBLEMS } from '../docs/api-problems.js';
import { EXAMPLE_IDS } from '../docs/problem-details.dto.js';
import { CreateLessonDto } from './create-lesson.dto.js';
import type { Lesson } from './lesson.entity.js';
import { LessonsService } from './lessons.service.js';

export class LessonResponse {
  @ApiProperty({ format: 'uuid', example: EXAMPLE_IDS.lesson })
  id!: string;

  @ApiProperty({ example: 'Recursion' })
  title!: string;

  @ApiProperty({
    description: 'The lesson text, trimmed.',
    example:
      'A recursive function is a function that calls itself to solve a smaller version of the same problem.',
  })
  content!: string;

  @ApiProperty({
    description: 'sha256 of the content, hex.',
    example: '3f0a6c1e9b2d4f5a8c7e6d5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f',
  })
  contentHash!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-19T15:00:00.000Z' })
  createdAt!: string;
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

@ApiTags('lessons')
@Controller('lessons')
export class LessonsController {
  constructor(private readonly lessons: LessonsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a lesson',
    description: 'Stores the lesson text that quizzes are generated from.',
  })
  @ApiCreatedResponse({ type: LessonResponse })
  @ApiProblems(PROBLEMS.validation, PROBLEMS.lessonTooLarge)
  async create(@Body() body: CreateLessonDto): Promise<LessonResponse> {
    return toLessonResponse(await this.lessons.create(body));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read a lesson' })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Lesson id',
    example: EXAMPLE_IDS.lesson,
  })
  @ApiOkResponse({ type: LessonResponse })
  @ApiProblems(PROBLEMS.validation, PROBLEMS.notFound)
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LessonResponse> {
    return toLessonResponse(await this.lessons.findById(id));
  }
}
