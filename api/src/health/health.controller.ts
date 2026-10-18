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
import { RedisHealthIndicator } from './redis.health.js';

const CHECK_TIMEOUT_MS = 1500;

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly postgres: TypeOrmHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
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
