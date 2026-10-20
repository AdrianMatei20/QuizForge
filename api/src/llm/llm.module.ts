import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Env } from '../config/env.schema.js';
import { RedisModule } from '../redis/redis.module.js';
import { CLOCK, systemClock } from './clock.js';
import { LLM_CACHE, RedisLlmCache } from './llm-cache.js';
import { LlmCall } from './llm-call.entity.js';
import { LLM_CALL_STORE, TypeOrmLlmCallStore } from './llm-call.store.js';
import { LLM_CLIENT } from './llm-client.js';
import { createLlmClient } from './llm-client.factory.js';
import {
  LLM_SERVICE_OPTIONS,
  LlmService,
  type LlmServiceOptions,
} from './llm.service.js';
import { LlmPricing, loadPricingFile } from './pricing.js';
import { PROMPTS_DIR, PromptRegistry } from './prompt-registry.js';

/**
 * LlmService settings from validated config. Exported so a test can start
 * from the real values and override one (e.g. a budget of 0): config is
 * validated once per process, so changing env vars later has no effect.
 */
export function llmServiceOptionsFromConfig(
  config: ConfigService<Env, true>,
): LlmServiceOptions {
  return {
    defaultModel: config.get('LLM_MODEL', { infer: true }),
    dailyBudgetUsd: config.get('LLM_DAILY_BUDGET_USD', { infer: true }),
    cacheTtlSeconds: config.get('LLM_CACHE_TTL_SECONDS', { infer: true }),
    timeoutMs: config.get('LLM_TIMEOUT_MS', { infer: true }),
    maxRetryAfterMs: config.get('LLM_RETRY_AFTER_MAX_MS', { infer: true }),
    backoff: {
      baseMs: config.get('LLM_RETRY_BASE_DELAY_MS', { infer: true }),
      capMs: config.get('LLM_RETRY_MAX_DELAY_MS', { infer: true }),
    },
    random: Math.random,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

/** All LLM access goes through this module; feature modules import it and use LlmService. */
@Module({
  imports: [TypeOrmModule.forFeature([LlmCall]), RedisModule],
  providers: [
    {
      provide: LLM_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        createLlmClient({
          LLM_PROVIDER: config.get('LLM_PROVIDER', { infer: true }),
          LLM_API_KEY: config.get('LLM_API_KEY', { infer: true }),
        }),
    },
    {
      // Loaded at startup: a broken prompt file stops the app from booting.
      provide: PromptRegistry,
      useFactory: () => PromptRegistry.load(PROMPTS_DIR),
    },
    {
      provide: LlmPricing,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const pricing = new LlmPricing(
          loadPricingFile(config.get('LLM_PRICING_FILE', { infer: true })),
        );
        // Spot a missing price at boot, not after a day of uncounted spend.
        pricing.warnIfUnpriced([
          config.get('LLM_MODEL', { infer: true }),
          config.get('LLM_JUDGE_MODEL', { infer: true }),
        ]);
        return pricing;
      },
    },
    { provide: LLM_CALL_STORE, useClass: TypeOrmLlmCallStore },
    { provide: LLM_CACHE, useClass: RedisLlmCache },
    { provide: CLOCK, useValue: systemClock },
    {
      provide: LLM_SERVICE_OPTIONS,
      inject: [ConfigService],
      useFactory: llmServiceOptionsFromConfig,
    },
    LlmService,
  ],
  // CLOCK too, so /usage and the budget guard agree on what "today" is.
  // PromptRegistry and LlmPricing let the eval harness check a prompt
  // version and the models' prices before it spends anything.
  exports: [LlmService, CLOCK, PromptRegistry, LlmPricing],
})
export class LlmModule {}
