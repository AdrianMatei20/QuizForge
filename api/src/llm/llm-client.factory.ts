import type { Env } from '../config/env.schema.js';
import { AnthropicLlmClient } from './anthropic-llm.client.js';
import { loadSampleLessons } from '../lessons/sample-lessons.js';
import { FakeLlmClient } from './fake-llm.client.js';
import type { LlmClient } from './llm-client.js';

/** Picks the LlmClient implementation from LLM_PROVIDER. */
export function createLlmClient(
  env: Pick<Env, 'LLM_PROVIDER' | 'LLM_API_KEY'>,
): LlmClient {
  switch (env.LLM_PROVIDER) {
    case 'anthropic':
      if (env.LLM_API_KEY === undefined) {
        // The env schema already enforces this; the check keeps the types honest.
        throw new Error(
          'LLM_API_KEY is required when LLM_PROVIDER is "anthropic"',
        );
      }
      return new AnthropicLlmClient({ apiKey: env.LLM_API_KEY });
    case 'fake':
      // Answers each sample lesson with its own fixtures (the demo mode).
      return new FakeLlmClient({
        sampleLessons: new Map(
          loadSampleLessons().map((lesson) => [
            lesson.contentHash,
            lesson.name,
          ]),
        ),
      });
  }
}
