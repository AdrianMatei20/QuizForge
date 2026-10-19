import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProblems, PROBLEMS } from '../docs/api-problems.js';
import { CLOCK, type Clock } from '../llm/clock.js';
import { LlmService } from '../llm/llm.service.js';
import { resolveUsageRange } from './usage-range.js';
import { buildUsageReport, type UsageReport } from './usage-report.js';
import { UsageQueryDto, UsageReportResponse } from './usage.responses.js';

@ApiTags('usage')
@Controller('usage')
export class UsageController {
  constructor(
    private readonly llm: LlmService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'LLM usage and cost',
    description:
      'Totals and a per-day, per-feature breakdown from llm_calls: calls, input and output tokens, cost, cache-hit rate, error rate, calls per status, and the estimated part (streams that never received the provider usage). Days are UTC.',
  })
  @ApiOkResponse({ type: UsageReportResponse })
  @ApiProblems(PROBLEMS.validation)
  async report(@Query() query: UsageQueryDto): Promise<UsageReport> {
    const range = resolveUsageRange(query, this.clock.now());
    const rows = await this.llm.usageByDay(range.fromDate, range.toExclusive);
    return buildUsageReport(rows, range);
  }
}
