import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import type { LlmCallStatus } from '../llm/llm-call.entity.js';

/** Swagger classes for GET /api/usage; the data is built by buildUsageReport(). */

export class UsageStatusCounts implements Record<LlmCallStatus, number> {
  @ApiProperty({ example: 40 }) ok!: number;
  @ApiProperty({ example: 1 }) invalid_output!: number;
  @ApiProperty({ example: 0 }) error!: number;
  @ApiProperty({ example: 0 }) budget_exceeded!: number;
  @ApiProperty({ example: 0 }) refused!: number;
  @ApiProperty({ example: 1 }) truncated!: number;
}

export class EstimatedUsageResponse {
  @ApiProperty({ example: 1 }) calls!: number;
  @ApiProperty({ example: 1874 }) inputTokens!: number;
  @ApiProperty({ example: 230 }) outputTokens!: number;
  @ApiProperty({ example: '0.000302' }) costUsd!: string;
}

export class UsageBucketResponse {
  @ApiProperty({ description: 'LLM calls (llm_calls rows).', example: 42 })
  calls!: number;

  @ApiProperty({ example: 78_000 })
  inputTokens!: number;

  @ApiProperty({ example: 61_000 })
  outputTokens!: number;

  @ApiProperty({
    description:
      'USD, a decimal string summed exactly. Includes estimated rows.',
    example: '0.038300',
  })
  costUsd!: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Cache hits / calls. Null when there are no calls.',
    example: 0.1,
  })
  cacheHitRate!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Calls whose status is not "ok" (invalid output, errors, budget, refusals, truncation) / calls. Null when there are no calls.',
    example: 0.05,
  })
  errorRate!: number | null;

  @ApiProperty({ type: UsageStatusCounts, description: 'Calls per status.' })
  byStatus!: UsageStatusCounts;

  @ApiProperty({
    type: EstimatedUsageResponse,
    description:
      'The part of these figures that is estimated: streams that ended without the provider reporting usage (timeout, shutdown).',
  })
  estimated!: EstimatedUsageResponse;
}

export class UsageDayResponse extends UsageBucketResponse {
  @ApiProperty({ description: 'UTC day.', example: '2026-10-19' })
  date!: string;

  @ApiProperty({ example: 'quiz-generation-stream' })
  feature!: string;
}

export class UsageReportResponse {
  @ApiProperty({
    description: 'First UTC day (inclusive).',
    example: '2026-10-13',
  })
  from!: string;

  @ApiProperty({
    description: 'Last UTC day (inclusive).',
    example: '2026-10-19',
  })
  to!: string;

  @ApiProperty({ type: UsageBucketResponse })
  totals!: UsageBucketResponse;

  @ApiProperty({
    type: [UsageDayResponse],
    description:
      'One entry per day and feature that had calls, by day then feature.',
  })
  days!: UsageDayResponse[];
}

/** Strings here; resolveUsageRange() checks they are real dates and a valid range. */
export class UsageQueryDto {
  @ApiPropertyOptional({
    description: 'First UTC day, YYYY-MM-DD. Default: 6 days before `to`.',
    example: '2026-10-13',
  })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({
    description:
      'Last UTC day, YYYY-MM-DD. Default: today. At most 366 days in all.',
    example: '2026-10-19',
  })
  @IsOptional()
  @IsString()
  to?: string;
}
