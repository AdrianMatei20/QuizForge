import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AttemptsModule } from './attempts/attempts.module.js';
import type { Env } from './config/env.schema.js';
import { DemoModule } from './demo/demo.module.js';
import { EvalsModule } from './evals/evals.module.js';
import { HealthModule } from './health/health.module.js';
import { LessonsModule } from './lessons/lessons.module.js';
import { LlmModule } from './llm/llm.module.js';
import { ThrottlerModule } from '@nestjs/throttler';
import {
  ATTEMPT_THROTTLER,
  GENERATE_THROTTLER,
} from './common/throttling/rate-limit.guard.js';
import { MetricsModule } from './metrics/metrics.module.js';
import { QuizModule } from './quiz/quiz.module.js';
import { rootConfigModule, rootDatabaseModule } from './root.modules.js';
import { UsageModule } from './usage/usage.module.js';

@Module({
  imports: [
    rootConfigModule,
    rootDatabaseModule,
    // Only applied where RateLimitGuard is used: GenerateRateLimit() and AttemptRateLimit().
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        throttlers: [
          {
            name: GENERATE_THROTTLER,
            limit: config.get('THROTTLE_GENERATE_LIMIT', { infer: true }),
            ttl: config.get('THROTTLE_GENERATE_TTL_MS', { infer: true }),
          },
          {
            name: ATTEMPT_THROTTLER,
            limit: config.get('THROTTLE_ATTEMPT_LIMIT', { infer: true }),
            ttl: config.get('THROTTLE_ATTEMPT_TTL_MS', { infer: true }),
          },
        ],
      }),
    }),
    MetricsModule,
    HealthModule,
    LlmModule,
    LessonsModule,
    QuizModule,
    UsageModule,
    EvalsModule,
    AttemptsModule,
    DemoModule,
  ],
})
export class AppModule {}
