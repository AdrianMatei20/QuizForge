import { z } from 'zod';
import { AnthropicLlmClient } from '../src/llm/anthropic-llm.client.js';
import { systemClock } from '../src/llm/clock.js';
import { LlmService } from '../src/llm/llm.service.js';
import { parseUsd } from '../src/llm/money.js';
import { LlmPricing, loadPricingFile } from '../src/llm/pricing.js';
import { PROMPTS_DIR, PromptRegistry } from '../src/llm/prompt-registry.js';
import { DEFAULT_BACKOFF } from '../src/llm/retry.js';
import {
  InMemoryLlmCache,
  InMemoryLlmCallStore,
  TEST_PROMPTS_DIR,
} from './support/llm.js';
import { readLiveEnv } from './support/live-env.js';

/**
 * One tiny real call to the provider, end to end through LlmService:
 * structured output, usage and pricing. Runs only with LLM_LIVE_TESTS=1;
 * reads LLM_API_KEY and LLM_MODEL via readLiveEnv (environment, .env.live.local, .env).
 * No database or Redis needed: storage and cache are in memory.
 */
const live = process.env.LLM_LIVE_TESTS === '1';

describe.skipIf(!live)('LLM live smoke test', () => {
  it('generates typed data with real usage and a recorded cost', async () => {
    const env = readLiveEnv();
    const pricing = new LlmPricing(loadPricingFile('config/llm-pricing.json'));
    const store = new InMemoryLlmCallStore(systemClock);
    const service = new LlmService(
      new AnthropicLlmClient({ apiKey: env.LLM_API_KEY }),
      PromptRegistry.load(PROMPTS_DIR, TEST_PROMPTS_DIR),
      store,
      new InMemoryLlmCache(),
      pricing,
      systemClock,
      {
        defaultModel: env.LLM_MODEL,
        dailyBudgetUsd: '1.00',
        cacheTtlSeconds: 0,
        timeoutMs: 60_000,
        maxRetryAfterMs: 10_000,
        backoff: DEFAULT_BACKOFF,
        random: Math.random,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      },
    );

    const result = await service.generate({
      feature: 'live-smoke',
      promptId: 'live-smoke',
      promptVersion: 1,
      variables: { question: 'What is 2 + 3?' },
      schema: z.object({ answer: z.number().int() }),
      // Generous, because some models think before answering.
      maxTokens: 2_048,
    });

    expect(Number.isInteger(result.data.answer)).toBe(true);
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
    expect(result.model).toBe(env.LLM_MODEL);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.status).toBe('ok');
    expect(
      parseUsd(store.rows[0]?.costUsd ?? '0'),
      `cost is 0: is "${env.LLM_MODEL}" priced in config/llm-pricing.json?`,
    ).toBeGreaterThan(0n);
  });
});
