import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { GenerateRateLimit } from '../common/throttling/rate-limit.guard.js';
import { parseUuidParam } from '../common/problem-details/validation-problem.js';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiProblems, PROBLEMS } from '../docs/api-problems.js';
import { EXAMPLE_IDS } from '../docs/problem-details.dto.js';
import { QuestionResponse, toQuestionResponse } from './quiz.mapper.js';
import { ReviewService } from './review.service.js';
import { UpdateQuestionDto } from './update-question.dto.js';

const QUESTION_ID = ApiParam({
  name: 'id',
  format: 'uuid',
  description: 'Question id',
  example: EXAMPLE_IDS.question,
});

/** The teacher's actions on one question of a quiz under review. */
@ApiTags('questions')
@Controller('questions')
export class QuestionsController {
  constructor(private readonly review: ReviewService) {}

  /** Edit content and/or change the status. Returns the updated question. */
  @Patch(':id')
  @ApiOperation({
    summary: 'Edit a question or change its status',
    description:
      'Send any of the fields; the rest stay as they are. Changed content must still be a valid question of its type and pass the quiz rules, ' +
      'except the sourceQuote rules, which stop applying once a human edits a question. editedAt is set only when the content actually changes.',
  })
  @QUESTION_ID
  @ApiOkResponse({ type: QuestionResponse })
  @ApiProblems(PROBLEMS.validation, PROBLEMS.notFound, PROBLEMS.editConflict)
  async update(
    @Param('id', parseUuidParam('id')) id: string,
    @Body() body: UpdateQuestionDto,
  ): Promise<QuestionResponse> {
    return toQuestionResponse(await this.review.updateQuestion(id, body));
  }

  /** 201 with the replacement question; the old one is soft-deleted. */
  @Post(':id/regenerate')
  @GenerateRateLimit()
  @ApiOperation({
    summary: 'Replace a question with a newly generated one',
    description:
      'Generates one question of the same type that repeats none of the quiz questions, at the same position, as a draft. The old question is soft-deleted.',
  })
  @QUESTION_ID
  @ApiCreatedResponse({
    type: QuestionResponse,
    description: 'The replacement question.',
  })
  @ApiProblems(
    PROBLEMS.validation,
    PROBLEMS.notFound,
    PROBLEMS.regenerateConflict,
    PROBLEMS.regeneration.refused,
    PROBLEMS.regeneration.budgetExceeded,
    PROBLEMS.regeneration.badOutput,
    PROBLEMS.regeneration.rateLimited,
    PROBLEMS.regeneration.timeout,
  )
  async regenerate(
    @Param('id', parseUuidParam('id')) id: string,
  ): Promise<QuestionResponse> {
    return toQuestionResponse(await this.review.regenerateQuestion(id));
  }
}
