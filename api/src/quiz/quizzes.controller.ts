import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  Sse,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import { parseUuidParam } from '../common/problem-details/validation-problem.js';
import { GenerateThrottlerGuard } from '../common/throttling/generate-throttler.guard.js';
import { ProblemDetailsDto } from '../docs/problem-details.dto.js';
import { ApiProblems, PROBLEMS } from '../docs/api-problems.js';
import { EXAMPLE_IDS } from '../docs/problem-details.dto.js';
import { GenerateQuizDto } from './generate-quiz.dto.js';
import {
  ListQuizzesQueryDto,
  QUIZ_LIST_DEFAULT_LIMIT,
} from './list-quizzes-query.dto.js';
import type { QuizStreamEvent } from './quiz-stream.events.js';
import { QuizStreamService } from './quiz-stream.service.js';
import {
  QuestionRejectedEvent,
  QuestionResponse,
  QuizCostResponse,
  QuizResponse,
  QuizStreamStartedResponse,
  QuizSummaryResponse,
  ReviewStatsResponse,
  StreamDoneEvent,
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
    private readonly streams: QuizStreamService,
  ) {}

  /**
   * Synchronous by default: responds once the quiz is generated and saved.
   * With stream: true, responds 202 at once; the questions arrive on the stream.
   */
  @Post('lessons/:lessonId/quizzes')
  @UseGuards(GenerateThrottlerGuard)
  @ApiOperation({
    summary: 'Generate a quiz from a lesson',
    description:
      'Synchronous (default): responds once the LLM has written the questions and they passed the schema and rule checks (with up to one repair call). ' +
      'If generation fails, the quiz is kept with status "failed" and a failureReason, and the error response includes its `quizId`.\n\n' +
      'With `stream: true`: creates the quiz as "generating", returns 202 `{ quizId }` at once, and generates in the background; ' +
      'watch it at GET /api/quizzes/{quizId}/stream. Generation errors then arrive as a `problem` event on that stream.\n\n' +
      'Multiple-choice options are shuffled before saving.',
  })
  @LESSON_ID
  @ApiCreatedResponse({ type: QuizResponse, description: 'The draft quiz.' })
  @ApiAcceptedResponse({
    type: QuizStreamStartedResponse,
    description: 'stream: true. Generation has started.',
  })
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
    @Param('lessonId', parseUuidParam('lessonId')) lessonId: string,
    @Body() body: GenerateQuizDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<QuizResponse | QuizStreamStartedResponse> {
    if (body.stream === true) {
      response.status(HttpStatus.ACCEPTED);
      return { quizId: await this.quizzes.startStreamed(lessonId, body) };
    }
    return toQuizResponse(await this.quizzes.generate(lessonId, body));
  }

  @Sse('quizzes/:id/stream')
  @ApiOperation({
    summary: 'Watch a quiz being generated (Server-Sent Events)',
    description:
      'A text/event-stream. First every saved question is replayed, so a reconnecting client catches up; then the live events while generation runs. ' +
      'Events:\n' +
      '- `question`: a validated, saved question (QuestionResponse)\n' +
      '- `question_rejected`: `{ position, violations }` for a line that failed validation; the repair step fills its position later\n' +
      '- `done`: `{ generated, rejected, usage }`; the stream ends\n' +
      '- `problem`: problem details (generation failed, or unknown quiz); the stream ends\n\n' +
      'Disconnecting does not stop generation. Works for synchronously generated quizzes too (replay, then `done`).\n\n' +
      'From a terminal: `curl -N http://localhost:3000/api/quizzes/{id}/stream`',
  })
  @QUIZ_ID
  @ApiProduces('text/event-stream')
  @ApiExtraModels(
    QuestionResponse,
    QuestionRejectedEvent,
    StreamDoneEvent,
    ProblemDetailsDto,
  )
  @ApiOkResponse({
    description:
      'A stream of `question`, `question_rejected`, `done` and `problem` events; each `data:` line is one of these JSON payloads.',
    content: {
      'text/event-stream': {
        schema: {
          oneOf: [
            { $ref: getSchemaPath(QuestionResponse) },
            { $ref: getSchemaPath(QuestionRejectedEvent) },
            { $ref: getSchemaPath(StreamDoneEvent) },
            { $ref: getSchemaPath(ProblemDetailsDto) },
          ],
        },
      },
    },
  })
  @ApiProblems(PROBLEMS.validation)
  stream(
    @Param('id', parseUuidParam('id')) id: string,
  ): Observable<QuizStreamEvent> {
    return this.streams.events(id);
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
    @Param('lessonId', parseUuidParam('lessonId')) lessonId: string,
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
  async findOne(
    @Param('id', parseUuidParam('id')) id: string,
  ): Promise<QuizResponse> {
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
  async publish(
    @Param('id', parseUuidParam('id')) id: string,
  ): Promise<QuizResponse> {
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
    @Param('id', parseUuidParam('id')) id: string,
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
    @Param('id', parseUuidParam('id')) id: string,
  ): Promise<QuizCostResponse> {
    return toQuizCostResponse(id, await this.quizzes.getCost(id));
  }
}
