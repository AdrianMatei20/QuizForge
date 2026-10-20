import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { parseUuidParam } from '../common/problem-details/validation-problem.js';
import { ApiProblems, PROBLEMS } from '../docs/api-problems.js';
import { EXAMPLE_IDS } from '../docs/problem-details.dto.js';
import { AttemptsService } from './attempts.service.js';
import { AttemptStatsResponse } from './attempts.dto.js';

/** The teacher's side of attempts: how students did, question by question. */
@ApiTags('quizzes')
@Controller('quizzes')
export class AttemptStatsController {
  constructor(private readonly attempts: AttemptsService) {}

  @Get(':id/attempt-stats')
  @ApiOperation({
    summary: "Students' results per question",
    description:
      'Attempts, average score, and per question the share answered correctly, flagged as possibly too easy or possibly wrong or unclear (thresholds from config, only from the minimum number of attempts).',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Quiz id',
    example: EXAMPLE_IDS.quiz,
  })
  @ApiOkResponse({ type: AttemptStatsResponse })
  @ApiProblems(PROBLEMS.validation, PROBLEMS.notFound)
  async stats(
    @Param('id', parseUuidParam('id')) id: string,
  ): Promise<AttemptStatsResponse> {
    return { quizId: id, ...(await this.attempts.stats(id)) };
  }
}
