import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { GenerateQuizDto } from './generate-quiz.dto.js';
import {
  ListQuizzesQueryDto,
  QUIZ_LIST_DEFAULT_LIMIT,
} from './list-quizzes-query.dto.js';
import {
  type QuizCostResponse,
  type QuizResponse,
  type QuizSummaryResponse,
  toQuizCostResponse,
  toQuizResponse,
  toQuizSummaryResponse,
} from './quiz.mapper.js';
import { QuizService } from './quiz.service.js';

@Controller()
export class QuizzesController {
  constructor(private readonly quizzes: QuizService) {}

  /** Synchronous for now: responds once the quiz is generated and saved. */
  @Post('lessons/:lessonId/quizzes')
  async generate(
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Body() body: GenerateQuizDto,
  ): Promise<QuizResponse> {
    return toQuizResponse(await this.quizzes.generate(lessonId, body));
  }

  /** Newest first. `limit` defaults to 20, at most 100. */
  @Get('lessons/:lessonId/quizzes')
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
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<QuizResponse> {
    return toQuizResponse(await this.quizzes.findById(id));
  }

  /** Tokens and cost of every LLM call made for this quiz, failed ones included. */
  @Get('quizzes/:id/cost')
  async cost(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<QuizCostResponse> {
    return toQuizCostResponse(id, await this.quizzes.getCost(id));
  }
}
