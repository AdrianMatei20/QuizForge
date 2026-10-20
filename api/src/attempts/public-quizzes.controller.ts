import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { AttemptRateLimit } from '../common/throttling/rate-limit.guard.js';
import { parseUuidParam } from '../common/problem-details/validation-problem.js';
import { ApiProblems, PROBLEMS } from '../docs/api-problems.js';
import { EXAMPLE_IDS } from '../docs/problem-details.dto.js';
import { AttemptsService } from './attempts.service.js';
import {
  AttemptResultResponse,
  PublicQuizResponse,
  SubmitAttemptDto,
} from './attempts.dto.js';

const QUIZ_ID = ApiParam({
  name: 'id',
  format: 'uuid',
  description: 'Quiz id',
  example: EXAMPLE_IDS.quiz,
});

/**
 * What a student uses to take a published quiz: no login. The quiz never
 * includes the answers; they come back only after an attempt is scored.
 */
@ApiTags('public')
@Controller('public/quizzes')
export class PublicQuizzesController {
  constructor(private readonly attempts: AttemptsService) {}

  @Get(':id')
  @ApiOperation({
    summary: 'Read a published quiz to take it',
    description:
      'The approved questions in order, without correct answers, explanations or source quotes. A quiz that is not published is a 404.',
  })
  @QUIZ_ID
  @ApiOkResponse({ type: PublicQuizResponse })
  @ApiProblems(PROBLEMS.validation, PROBLEMS.notFound)
  async findOne(
    @Param('id', parseUuidParam('id')) id: string,
  ): Promise<PublicQuizResponse> {
    const { quiz, lessonTitle } = await this.attempts.findPublished(id);
    // Field by field, so nothing else of a question can reach a student.
    return {
      id: quiz.id,
      lessonTitle,
      questions: (quiz.questions ?? []).map((question) => ({
        id: question.id,
        position: question.position,
        type: question.type,
        stem: question.stem,
        options: question.options,
      })),
    };
  }

  @Post(':id/attempts')
  @AttemptRateLimit()
  @ApiOperation({
    summary: 'Submit an attempt',
    description:
      'Every question answered exactly once. Scored on the server and stored; returns the score and, per question, whether it was right, the correct answer and the explanation.',
  })
  @QUIZ_ID
  @ApiCreatedResponse({ type: AttemptResultResponse })
  @ApiProblems(PROBLEMS.validation, PROBLEMS.notFound, PROBLEMS.tooManyAttempts)
  submit(
    @Param('id', parseUuidParam('id')) id: string,
    @Body() body: SubmitAttemptDto,
  ): Promise<AttemptResultResponse> {
    return this.attempts.submit(id, body.answers);
  }
}
