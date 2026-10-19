import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { type Env, validateEnv } from './config/env.schema.js';
import { buildDataSourceOptions } from './database/database.options.js';
import { HealthModule } from './health/health.module.js';
import { LessonsModule } from './lessons/lessons.module.js';
import { LlmModule } from './llm/llm.module.js';
import { ThrottlerModule } from '@nestjs/throttler';
import { GENERATE_THROTTLER } from './common/throttling/generate-throttler.guard.js';
import { MetricsModule } from './metrics/metrics.module.js';
import { QuizModule } from './quiz/quiz.module.js';
import { UsageModule } from './usage/usage.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Vitest sets NODE_ENV=test, so e2e tests read .env.test (separate database).
      envFilePath: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
      validate: validateEnv,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        ...buildDataSourceOptions(config.get('DATABASE_URL', { infer: true })),
        // Entities come from TypeOrmModule.forFeature() in each module.
        autoLoadEntities: true,
      }),
    }),
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
  ],
})
export class AppModule {}
