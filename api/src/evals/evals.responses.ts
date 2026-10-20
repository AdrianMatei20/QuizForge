import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { LLM_EFFORTS, type LlmEffort } from '../llm/llm-client.js';
import type {
  ComparedMetric,
  Direction,
  MetricFormat,
  Verdict,
} from './compare.js';
import type { EvalRun } from './eval-run.entity.js';

/** Swagger classes and query DTOs for /api/evals. */

export const EVAL_LIST_DEFAULT_LIMIT = 50;
export const EVAL_LIST_MAX_LIMIT = 200;

export class ListEvalRunsQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: EVAL_LIST_MAX_LIMIT,
    default: EVAL_LIST_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(EVAL_LIST_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'Include --dry-run runs, whose numbers mean nothing. Default false.',
    default: false,
  })
  @IsOptional()
  // Query strings are strings; only "true" and "false" are accepted.
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  includeDryRuns?: boolean;
}

export class CompareEvalRunsQueryDto {
  @ApiProperty({ format: 'uuid', description: 'The baseline run.' })
  @IsUUID()
  a!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'The run compared with the baseline.',
  })
  @IsUUID()
  b!: string;
}

export class EvalRunSummaryResponse {
  @ApiProperty({
    format: 'uuid',
    description: 'The run id; also the correlation id prefix of its LLM calls.',
  })
  id!: string;
  @ApiProperty({ example: 'quiz' }) promptId!: string;
  @ApiProperty({ example: 2 }) promptVersion!: number;
  @ApiProperty({ example: 'claude-haiku-5-5' }) model!: string;
  @ApiProperty({ example: 'claude-sonnet-5-5' }) judgeModel!: string;

  @ApiProperty({
    enum: LLM_EFFORTS,
    nullable: true,
    description: "null: the provider's default.",
    example: null,
  })
  effort!: LlmEffort | null;

  @ApiProperty({
    description: 'A fake-provider dry run: its numbers mean nothing.',
  })
  dryRun!: boolean;

  @ApiProperty({ example: 10 }) lessonCount!: number;
  @ApiProperty({ example: 0 }) lessonsFailed!: number;

  @ApiProperty({
    description: 'The Markdown report, relative to api/.',
    example: 'evals/results/2026-10-19T151500Z-v2.md',
  })
  reportFile!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-19T15:55:44.000Z' })
  createdAt!: string;

  // Headline metrics: rates are 0..1, or null when there was nothing to divide by.
  @ApiProperty({ type: Number, nullable: true, example: 0.9 })
  rulePassBeforeRepairRate!: number | null;
  @ApiProperty({ type: Number, nullable: true, example: 0.1 }) repairRate!:
    number | null;
  @ApiProperty({ type: Number, nullable: true, example: 0.2 }) quoteCopyRate!:
    number | null;
  @ApiProperty({ type: Number, nullable: true, example: 0.95 })
  answerCorrectRate!: number | null;
  @ApiProperty({ type: Number, nullable: true, example: 0.7 })
  testsUnderstandingRate!: number | null;

  @ApiProperty({ description: 'USD, a decimal string.', example: '0.412300' })
  totalCostUsd!: string;
}

export function toEvalRunSummary(run: EvalRun): EvalRunSummaryResponse {
  const m = run.metrics.overall;
  return {
    id: run.id,
    promptId: run.promptId,
    promptVersion: run.promptVersion,
    model: run.model,
    judgeModel: run.judgeModel,
    effort: run.effort,
    dryRun: run.dryRun,
    lessonCount: run.lessonCount,
    lessonsFailed: m.lessonsFailed,
    reportFile: run.reportFile,
    createdAt: run.createdAt.toISOString(),
    rulePassBeforeRepairRate: m.rulePassBeforeRepairRate,
    repairRate: m.repairRate,
    quoteCopyRate: m.quoteCopyRate,
    answerCorrectRate: m.answerCorrectRate,
    testsUnderstandingRate: m.testsUnderstandingRate,
    totalCostUsd: m.totalCostUsd,
  };
}

export class EvalRunListResponse {
  @ApiProperty({ type: [EvalRunSummaryResponse], description: 'Newest first.' })
  items!: EvalRunSummaryResponse[];
}

const NUMBER_OR_DECIMAL = {
  oneOf: [{ type: 'number' }, { type: 'string' }],
  nullable: true,
  description:
    'A number; a decimal string for USD; null when there was nothing to measure.',
};

export class ComparedMetricResponse implements ComparedMetric {
  @ApiProperty({ example: 'quoteCopyRate' }) key!: string;
  @ApiProperty({ example: 'Quote copy' }) label!: string;
  @ApiProperty({
    enum: ['rate', 'count', 'usd', 'ms'],
    description:
      'How to show a, b and delta: a 0..1 rate, a count, USD, or milliseconds.',
  })
  format!: MetricFormat;

  @ApiProperty({
    enum: ['higher', 'lower', 'neutral'],
    description: 'Which way is an improvement.',
  })
  direction!: Direction;

  @ApiProperty(NUMBER_OR_DECIMAL) a!: number | string | null;
  @ApiProperty(NUMBER_OR_DECIMAL) b!: number | string | null;

  @ApiProperty({
    ...NUMBER_OR_DECIMAL,
    description: 'b minus a; for rates, in percentage points.',
  })
  delta!: number | string | null;

  @ApiProperty({
    enum: ['better', 'worse', 'same', 'n/a'],
    description:
      'Whether b is an improvement on a; n/a for neutral metrics or when a side is missing.',
  })
  verdict!: Verdict;
}

export class EvalComparisonResponse {
  @ApiProperty({ type: EvalRunSummaryResponse }) a!: EvalRunSummaryResponse;
  @ApiProperty({ type: EvalRunSummaryResponse }) b!: EvalRunSummaryResponse;
  @ApiProperty({
    type: [ComparedMetricResponse],
    description: 'Every compared metric, in report order.',
  })
  metrics!: ComparedMetricResponse[];
}
