import { AnthropicLlmClient } from '../src/llm/anthropic-llm.client.js';
import { systemClock } from '../src/llm/clock.js';
import {
  type LlmClient,
  LlmProviderError,
  type LlmRequest,
  type LlmResponse,
  type LlmStreamEvent,
} from '../src/llm/llm-client.js';
import { LlmService } from '../src/llm/llm.service.js';
import { parseModelOutput } from '../src/llm/output-parser.js';
import { LlmPricing, loadPricingFile } from '../src/llm/pricing.js';
import { PROMPTS_DIR, PromptRegistry } from '../src/llm/prompt-registry.js';
import { DEFAULT_BACKOFF } from '../src/llm/retry.js';
import { buildQuizRequest } from '../src/quiz/quiz-request.js';
import type { QuizSettings } from '../src/quiz/quiz.types.js';
import { loadSampleLesson, SAMPLE_LESSONS } from './support/lessons.js';
import { readLiveEnv } from './support/live-env.js';
import { InMemoryLlmCache, InMemoryLlmCallStore } from './support/llm.js';

/**
 * Generates one real quiz per sample lesson, with exactly the request
 * QuizService sends (buildQuizRequest), and prints a report per lesson:
 * whether the provider accepted the output schema, the rule violations of
 * the first answer (before any repair), tokens, cost and the quiz itself.
 * Runs only with LLM_LIVE_TESTS=1. Costs real money (well under a cent per
 * quiz with claude-haiku-5-5).
 */
const live = process.env.LLM_LIVE_TESTS === '1';

const SETTINGS: QuizSettings = {
  count: 5,
  difficulty: 'medium',
  types: ['multiple_choice', 'true_false'],
};
const MIN_QUOTE_WORDS = 5;

/** Keeps every provider response, so the first answer can be checked on its own. */
class RecordingLlmClient implements LlmClient {
  readonly responses: LlmResponse[] = [];

  constructor(private readonly inner: LlmClient) {}

  async generate(request: LlmRequest): Promise<LlmResponse> {
    const response = await this.inner.generate(request);
    this.responses.push(response);
    return response;
  }

  stream(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
    return this.inner.stream(request);
  }
}

describe.skipIf(!live)('quiz generation, live', () => {
  it.each(SAMPLE_LESSONS)(
    '%s: generates a valid quiz',
    async (name) => {
      const env = readLiveEnv();
      const recorder = new RecordingLlmClient(
        new AnthropicLlmClient({ apiKey: env.LLM_API_KEY }),
      );
      const store = new InMemoryLlmCallStore(systemClock);
      const service = new LlmService(
        recorder,
        PromptRegistry.load(PROMPTS_DIR),
        store,
        new InMemoryLlmCache(),
        new LlmPricing(loadPricingFile('config/llm-pricing.json')),
        systemClock,
        {
          defaultModel: env.LLM_MODEL,
          dailyBudgetUsd: '1.00',
          cacheTtlSeconds: 0,
          timeoutMs: 120_000,
          maxRetryAfterMs: 10_000,
          backoff: DEFAULT_BACKOFF,
          random: Math.random,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        },
      );
      const lesson = loadSampleLesson(name);
      const request = buildQuizRequest({
        lessonContent: lesson.content,
        settings: SETTINGS,
        model: env.LLM_MODEL,
        minQuoteWords: MIN_QUOTE_WORDS,
        correlationId: `live-${name}`,
      });

      let error: unknown;
      const result = await service.generate(request).catch((caught) => {
        error = caught;
        return undefined;
      });

      // The violations the repair prompt was (or would have been) given.
      const first = recorder.responses[0];
      let violationsBeforeRepair: string[] | undefined;
      if (first !== undefined) {
        const parsed = parseModelOutput(first.text, request.schema);
        violationsBeforeRepair = parsed.ok
          ? (request.rules?.(parsed.data) ?? [])
          : parsed.violations.map(({ pointer, message }) =>
              pointer === undefined ? message : `${pointer}: ${message}`,
            );
      }
      const usage = await service.getUsage(`live-${name}`);
      const providerError = findProviderError(error);

      const report = {
        lesson: name,
        model: env.LLM_MODEL,
        // A rejected schema is a 400 before any response is produced.
        schemaAccepted: first !== undefined,
        providerError:
          providerError === undefined
            ? undefined
            : { status: providerError.status, message: providerError.message },
        outcome:
          error === undefined
            ? 'ok'
            : error instanceof Error
              ? error.name
              : 'unknown',
        firstStopReason: first?.stopReason,
        violationsBeforeRepair,
        repaired: recorder.responses.length > 1,
        providerResponses: recorder.responses.length,
        usage: {
          ...usage,
          totalTokens: usage.inputTokens + usage.outputTokens,
        },
        latencyMs: store.rows[0]?.latencyMs,
        quiz: result?.data,
      };
      // Vitest drops console.log output from live specs; stdout gets through.
      process.stdout.write(
        `LIVE_QUIZ_REPORT ${JSON.stringify(report, null, 2)}\n`,
      );

      expect(error).toBeUndefined();
    },
    300_000,
  );
});

function findProviderError(error: unknown): LlmProviderError | undefined {
  for (let current = error; current instanceof Error;) {
    if (current instanceof LlmProviderError) {
      return current;
    }
    current = current.cause;
  }
  return undefined;
}
