import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProblems, PROBLEMS } from '../docs/api-problems.js';
import { EvalRunsService } from './eval-runs.service.js';
import {
  CompareEvalRunsQueryDto,
  EVAL_LIST_DEFAULT_LIMIT,
  EvalComparisonResponse,
  EvalRunListResponse,
  ListEvalRunsQueryDto,
  toEvalRunSummary,
} from './evals.responses.js';

/** Read-only: runs are made by `npm run eval`, never through the API. */
@ApiTags('evals')
@Controller('evals')
export class EvalsController {
  constructor(private readonly runs: EvalRunsService) {}

  @Get()
  @ApiOperation({
    summary: 'List eval runs',
    description:
      'Newest first, with their headline metrics. Dry runs are left out unless includeDryRuns=true.',
  })
  @ApiOkResponse({ type: EvalRunListResponse })
  @ApiProblems(PROBLEMS.validation)
  async list(
    @Query() query: ListEvalRunsQueryDto,
  ): Promise<EvalRunListResponse> {
    const runs = await this.runs.list(
      query.limit ?? EVAL_LIST_DEFAULT_LIMIT,
      query.includeDryRuns ?? false,
    );
    return { items: runs.map(toEvalRunSummary) };
  }

  @Get('compare')
  @ApiOperation({
    summary: 'Compare two eval runs',
    description:
      'Every compared metric for run a and run b, b minus a, and whether that is better or worse.',
  })
  @ApiOkResponse({ type: EvalComparisonResponse })
  @ApiProblems(PROBLEMS.validation, PROBLEMS.notFound)
  async compare(
    @Query() query: CompareEvalRunsQueryDto,
  ): Promise<EvalComparisonResponse> {
    const [a, b] = await Promise.all([
      this.runs.get(query.a),
      this.runs.get(query.b),
    ]);
    const comparison = this.runs.compare(a, b);
    return {
      a: toEvalRunSummary(a),
      b: toEvalRunSummary(b),
      metrics: comparison.metrics,
    };
  }
}
