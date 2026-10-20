import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { parseUuidParam } from '../common/problem-details/validation-problem.js';
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
import {
  LESSON_LIST_DEFAULT_LIMIT,
  ListLessonsQueryDto,
} from './list-lessons-query.dto.js';
import { LessonsService, type LessonSummary } from './lessons.service.js';

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

export class QuizStatusCountsResponse {
  @ApiProperty({ example: 0 })
  generating!: number;

  @ApiProperty({ example: 1 })
  draft!: number;

  @ApiProperty({ example: 2 })
  published!: number;

  @ApiProperty({ example: 0 })
  failed!: number;
}

export class LessonSummaryResponse {
  @ApiProperty({ format: 'uuid', example: EXAMPLE_IDS.lesson })
  id!: string;

  @ApiProperty({ example: 'Recursion' })
  title!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-19T15:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({
    type: QuizStatusCountsResponse,
    description: "The lesson's quizzes, counted by status (zeros included).",
  })
  quizCounts!: QuizStatusCountsResponse;
}

export class LessonListResponse {
  @ApiProperty({ type: [LessonSummaryResponse], description: 'Newest first.' })
  items!: LessonSummaryResponse[];

  @ApiProperty({ description: 'All lessons, not just this page.', example: 42 })
  total!: number;

  @ApiProperty({ example: LESSON_LIST_DEFAULT_LIMIT })
  limit!: number;

  @ApiProperty({ example: 0 })
  offset!: number;
}

function toLessonSummaryResponse(lesson: LessonSummary): LessonSummaryResponse {
  return {
    id: lesson.id,
    title: lesson.title,
    createdAt: lesson.createdAt.toISOString(),
    quizCounts: lesson.quizCounts,
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

  @Get()
  @ApiOperation({
    summary: 'List lessons',
    description:
      'Newest first, without their content, each with its quiz counts by status. `limit` defaults to 20, at most 100.',
  })
  @ApiOkResponse({ type: LessonListResponse })
  @ApiProblems(PROBLEMS.validation)
  async list(@Query() query: ListLessonsQueryDto): Promise<LessonListResponse> {
    const limit = query.limit ?? LESSON_LIST_DEFAULT_LIMIT;
    const offset = query.offset ?? 0;
    const page = await this.lessons.list(limit, offset);
    return {
      items: page.lessons.map(toLessonSummaryResponse),
      total: page.total,
      limit,
      offset,
    };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Read a lesson',
    description: 'The lesson with its full text and content hash.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Lesson id',
    example: EXAMPLE_IDS.lesson,
  })
  @ApiOkResponse({ type: LessonResponse })
  @ApiProblems(PROBLEMS.validation, PROBLEMS.notFound)
  async findOne(
    @Param('id', parseUuidParam('id')) id: string,
  ): Promise<LessonResponse> {
    return toLessonResponse(await this.lessons.findById(id));
  }
}
