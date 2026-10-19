import { join } from 'node:path';
import { z } from 'zod';
import type { Clock } from '../../src/llm/clock.js';
import { FakeLlmClient } from '../../src/llm/fake-llm.client.js';
import type { LlmCache } from '../../src/llm/llm-cache.js';
import type {
  LlmCallRecord,
  LlmCallStore,
} from '../../src/llm/llm-call.store.js';
import {
  type LlmGenerateRequest,
  LlmService,
  type LlmServiceOptions,
} from '../../src/llm/llm.service.js';
import { formatUsd, parseUsd } from '../../src/llm/money.js';
import { LlmPricing } from '../../src/llm/pricing.js';
import { PROMPTS_DIR, PromptRegistry } from '../../src/llm/prompt-registry.js';

export const TEST_PROMPTS_DIR = join(
  import.meta.dirname,
  '..',
  'fixtures',
  'prompts',
);

/** Monday 2026-10-19, 15:00 UTC: 9 hours (32,400 s) before the next UTC midnight. */
export const NOW = new Date('2026-10-19T15:00:00.000Z');

export const fixedClock: Clock = { now: () => NOW };

/** The output schema of the test-quiz prompt. */
export const quizSchema = z.object({
  questions: z
    .array(z.object({ text: z.string().min(1), answer: z.string().min(1) }))
    .min(1),
});

export type Quiz = z.infer<typeof quizSchema>;

export function quizRequest(
  overrides: Partial<LlmGenerateRequest<Quiz>> = {},
): LlmGenerateRequest<Quiz> {
  return {
    feature: 'test-feature',
    promptId: 'test-quiz',
    promptVersion: 1,
    variables: { count: 2, lesson: 'Plants turn sunlight into energy.' },
    schema: quizSchema,
    maxTokens: 1024,
    ...overrides,
  };
}

/** Stamps each record with the (fixed) clock time, like created_at DEFAULT now(). */
export class InMemoryLlmCallStore implements LlmCallStore {
  readonly rows: (LlmCallRecord & { createdAt: Date })[] = [];

  constructor(private readonly clock: Clock = fixedClock) {}

  record(call: LlmCallRecord): Promise<void> {
    this.rows.push({ ...call, createdAt: this.clock.now() });
    return Promise.resolve();
  }

  sumCostSince(since: Date): Promise<string> {
    const total = this.rows
      .filter((row) => row.createdAt >= since)
      .reduce((sum, row) => sum + parseUsd(row.costUsd), 0n);
    return Promise.resolve(formatUsd(total));
  }
}

export class InMemoryLlmCache implements LlmCache {
  readonly entries = new Map<string, { value: string; ttlSeconds: number }>();
  /** Simulates Redis being down: every call rejects. */
  failing = false;

  get(key: string): Promise<string | null> {
    if (this.failing) {
      return Promise.reject(new Error('cache down'));
    }
    return Promise.resolve(this.entries.get(key)?.value ?? null);
  }

  set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (this.failing) {
      return Promise.reject(new Error('cache down'));
    }
    this.entries.set(key, { value, ttlSeconds });
    return Promise.resolve();
  }
}

/** Prices for test-model: $2 per million input tokens, $10 per million output tokens. */
export const testPricing = new LlmPricing({
  'test-model': {
    inputPerMillionTokens: '2.00',
    outputPerMillionTokens: '10.00',
  },
});

/** An LlmService wired to fakes only: no network, no database, no Redis. */
export function createTestLlmService(options: Partial<LlmServiceOptions> = {}) {
  const client = new FakeLlmClient();
  const store = new InMemoryLlmCallStore();
  const cache = new InMemoryLlmCache();
  const prompts = PromptRegistry.load(PROMPTS_DIR, TEST_PROMPTS_DIR);
  const service = new LlmService(
    client,
    prompts,
    store,
    cache,
    testPricing,
    fixedClock,
    {
      defaultModel: 'test-model',
      dailyBudgetUsd: '1.00',
      cacheTtlSeconds: 60,
      timeoutMs: 5_000,
      maxRetryAfterMs: 5_000,
      random: () => 0.5,
      sleep: () => Promise.resolve(),
      ...options,
    },
  );
  return { service, client, store, cache };
}
