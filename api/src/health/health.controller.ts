import {
  Controller,
  Get,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  HealthCheck,
  type HealthCheckResult,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import {
  PROBLEM_TYPES,
  ProblemException,
} from '../common/problem-details/problem-details.js';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProblems } from '../docs/api-problems.js';
import { ProblemDetailsDto } from '../docs/problem-details.dto.js';
import { RedisHealthIndicator } from './redis.health.js';

const CHECK_TIMEOUT_MS = 1500;

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly postgres: TypeOrmHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Health check',
    description:
      'Pings PostgreSQL and Redis. 503 problem details, with per-dependency results in `checks`, when one is down.',
  })
  @ApiOkResponse({
    description: 'Every dependency is up.',
    schema: {
      type: 'object',
      example: {
        status: 'ok',
        info: { postgres: { status: 'up' }, redis: { status: 'up' } },
        error: {},
        details: { postgres: { status: 'up' }, redis: { status: 'up' } },
      },
    },
  })
  @ApiProblems({
    status: 503,
    description:
      'A dependency is down. Problem details with per-dependency results in `checks`.',
    schema: ProblemDetailsDto,
  })
  // Terminus would document its own 503 body; this endpoint returns problem details instead.
  @HealthCheck({ swaggerDocumentation: false })
  async check(): Promise<HealthCheckResult> {
    try {
      return await this.health.check([
        () => this.postgres.pingCheck('postgres').withTimeout(CHECK_TIMEOUT_MS),
        () => this.redis.pingCheck('redis', CHECK_TIMEOUT_MS),
      ]);
    } catch (error) {
      // Terminus reports a failed check as a 503 carrying the per-check results.
      // Re-throw it as problem details, keeping those results in a `checks` extension.
      if (error instanceof ServiceUnavailableException) {
        const result = error.getResponse() as HealthCheckResult;
        throw new ProblemException({
          type: PROBLEM_TYPES.httpStatus,
          title: 'Service Unavailable',
          status: HttpStatus.SERVICE_UNAVAILABLE,
          detail: 'One or more dependencies are unavailable.',
          checks: result.details,
        });
      }
      throw error;
    }
  }
}
