import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiProblems, PROBLEMS } from '../docs/api-problems.js';
import { EXAMPLE_IDS } from '../docs/problem-details.dto.js';
import { GenerateQuizDto } from './generate-quiz.dto.js';
import {
  ListQuizzesQueryDto,
  QUIZ_LIST_DEFAULT_LIMIT,
} from './list-quizzes-query.dto.js';
import {
  QuizCostResponse,
  QuizResponse,
  QuizSummaryResponse,
  ReviewStatsResponse,
  toQuizCostResponse,
  toQuizResponse,
  toQuizSummaryResponse,
} from './quiz.mapper.js';
import { QuizService } from './quiz.service.js';
import { ReviewService } from './review.service.js';

const LESSON_ID = ApiParam({
  name: 'lessonId',
  format: 'uuid',
  example: EXAMPLE_IDS.lesson,
});
const QUIZ_ID = ApiParam({
  name: 'id',
  format: 'uuid',
  description: 'Quiz id',
  example: EXAMPLE_IDS.quiz,
});

@ApiTags('quizzes')
@Controller()
export class QuizzesController {
  constructor(
    private readonly quizzes: QuizService,
    private readonly review: ReviewService,
  ) {}

  /** Synchronous for now: responds once the quiz is generated and saved. */
  @Post('lessons/:lessonId/quizzes')
  @ApiOperation({
    summary: 'Generate a quiz from a lesson',
    description:
      'Synchronous: responds once the LLM has written the questions and they passed the schema and rule checks (with up to one repair call). ' +
      'Multiple-choice options are shuffled before saving. If generation fails, the quiz is kept with status "failed" and a failureReason, and the error response includes its `quizId`.',
  })
  @LESSON_ID
  @ApiCreatedResponse({ type: QuizResponse, description: 'The draft quiz.' })
  @ApiProblems(
    PROBLEMS.validation,
    PROBLEMS.notFound,
    PROBLEMS.generation.refused,
    PROBLEMS.generation.budgetExceeded,
    PROBLEMS.generation.internal,
    PROBLEMS.generation.badOutput,
    PROBLEMS.generation.rateLimited,
    PROBLEMS.generation.timeout,
  )
  async generate(
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Body() body: GenerateQuizDto,
  ): Promise<QuizResponse> {
    return toQuizResponse(await this.quizzes.generate(lessonId, body));
  }

  /** Newest first. `limit` defaults to 20, at most 100. */
  @Get('lessons/:lessonId/quizzes')
  @ApiOperation({
    summary: "List a lesson's quizzes",
    description: 'Newest first, without questions. Failed quizzes included.',
  })
  @LESSON_ID
  @ApiOkResponse({ type: [QuizSummaryResponse] })
  @ApiProblems(PROBLEMS.validation, PROBLEMS.notFound)
  async listForLesson(
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Query() query: ListQuizzesQueryDto,
  ): Promise<QuizSummaryResponse[]> {
    const quizzes = await this.quizzes.listForLesson(
      lessonId,
      query.limit ?? QUIZ_LIST_DEFAULT_LIMIT,
    );
    return quizzes.map(toQuizSummaryResponse);
  }

  @Get('quizzes/:id')
  @ApiOperation({
    summary: 'Read a quiz with its questions',
    description:
      'Current questions in position order. A published quiz shows only its approved questions.',
  })
  @QUIZ_ID
  @ApiOkResponse({ type: QuizResponse })
  @ApiProblems(PROBLEMS.validation, PROBLEMS.notFound)
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<QuizResponse> {
    return toQuizResponse(await this.quizzes.findById(id));
  }

  /** Publishes a draft quiz with at least one approved question; returns it with only those. */
  @Post('quizzes/:id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Publish a quiz',
    description:
      'Needs a draft quiz with at least one approved question. The published quiz consists of its approved questions; after this, nothing about it can change.',
  })
  @QUIZ_ID
  @ApiOkResponse({
    type: QuizResponse,
    description: 'The published quiz, with only its approved questions.',
  })
  @ApiProblems(
    PROBLEMS.validation,
    PROBLEMS.notFound,
    PROBLEMS.publishConflict,
    PROBLEMS.noApprovedQuestions,
  )
  async publish(@Param('id', ParseUUIDPipe) id: string): Promise<QuizResponse> {
    await this.review.publish(id);
    return toQuizResponse(await this.quizzes.findById(id));
  }

  @Get('quizzes/:id/review-stats')
  @ApiOperation({
    summary: 'Review statistics of a quiz',
    description:
      'Counts by status, regenerated questions, and the edit, reject and miss rates. A rate with nothing to divide by is null.',
  })
  @QUIZ_ID
  @ApiOkResponse({ type: ReviewStatsResponse })
  @ApiProblems(PROBLEMS.validation, PROBLEMS.notFound)
  async reviewStats(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReviewStatsResponse> {
    return { quizId: id, ...(await this.review.reviewStats(id)) };
  }

  /** Tokens and cost of every LLM call made for this quiz, failed ones included. */
  @Get('quizzes/:id/cost')
  @ApiOperation({
    summary: 'LLM usage and cost of a quiz',
    description:
      'Summed over every LLM call made for the quiz: generation, regenerations and failed calls.',
  })
  @QUIZ_ID
  @ApiOkResponse({ type: QuizCostResponse })
  @ApiProblems(PROBLEMS.validation, PROBLEMS.notFound)
  async cost(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<QuizCostResponse> {
    return toQuizCostResponse(id, await this.quizzes.getCost(id));
  }
}
