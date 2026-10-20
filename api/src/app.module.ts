import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './config/env.schema.js';
import { EvalsModule } from './evals/evals.module.js';
import { HealthModule } from './health/health.module.js';
import { LessonsModule } from './lessons/lessons.module.js';
import { LlmModule } from './llm/llm.module.js';
import { ThrottlerModule } from '@nestjs/throttler';
import { GENERATE_THROTTLER } from './common/throttling/generate-throttler.guard.js';
import { MetricsModule } from './metrics/metrics.module.js';
import { QuizModule } from './quiz/quiz.module.js';
import { rootConfigModule, rootDatabaseModule } from './root.modules.js';
import { UsageModule } from './usage/usage.module.js';

@Module({
  imports: [
    rootConfigModule,
    rootDatabaseModule,
    // Only applied where GenerateThrottlerGuard is used (generate, regenerate).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        throttlers: [
          {
            name: GENERATE_THROTTLER,
            limit: config.get('THROTTLE_GENERATE_LIMIT', { infer: true }),
            ttl: config.get('THROTTLE_GENERATE_TTL_MS', { infer: true }),
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
  ],
})
export class AppModule {}
