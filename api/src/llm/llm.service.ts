import { Inject, Injectable, Logger } from '@nestjs/common';
import { context, type Span, SpanStatusCode, trace } from '@opentelemetry/api';
import type { z } from 'zod';
import {
  CLOCK,
  type Clock,
  secondsUntilNextUtcMidnight,
  startOfUtcDay,
} from './clock.js';
import { LlmMetrics } from '../metrics/llm-metrics.js';
import { buildCacheKey, LLM_CACHE, type LlmCache } from './llm-cache.js';
import type { LlmCallStatus } from './llm-call.entity.js';
import {
  LLM_CALL_STORE,
  type LlmCallStore,
  type LlmUsageTotals,
  type UsageRow,
} from './llm-call.store.js';
import {
  LLM_CLIENT,
  type LlmClient,
  type LlmMessage,
  LlmProviderError,
  type LlmRequest,
  type LlmResponse,
  type LlmStopReason,
  type LlmUsage,
} from './llm-client.js';
import {
  LlmBudgetExceededError,
  LlmError,
  LlmInvalidOutputError,
  LlmOutputTruncatedError,
  LlmRateLimitedError,
  LlmRefusalError,
  LlmTimeoutError,
  LlmUpstreamError,
  type LlmViolation,
} from './llm.errors.js';
import { parseUsd } from './money.js';
import { type ParseOutcome, parseModelOutput } from './output-parser.js';
import { LlmPricing } from './pricing.js';
import { PromptRegistry, type PromptVariables } from './prompt-registry.js';
import {
  type BackoffOptions,
  isRetryable,
  MAX_ATTEMPTS,
  retryDelayMs,
} from './retry.js';

export interface LlmGenerateRequest<T> {
  /** The product feature asking, e.g. "quiz-generation". Recorded and part of the cache key. */
  feature: string;
  promptId: string;
  promptVersion: number;
  variables: PromptVariables;
  schema: z.ZodType<T>;
  /**
   * Checks zod cannot express, run after the schema passes. Returns one
   * message per violation; empty means valid. Messages can reach clients in
   * a 502 response, so they must not quote the model output.
   */
  rules?: (data: T) => string[];
  /** Defaults to LLM_MODEL. */
  model?: string;
  maxTokens: number;
  /** Defaults to true. Set to false to always call the provider (e.g. "regenerate"). */
  cache?: boolean;
  /**
   * Recorded on the llm_calls row so a caller can group and total its calls
   * (see getUsage). An opaque string to this module, e.g. a quiz id.
   */
  correlationId?: string;
  signal?: AbortSignal;
}

export interface LlmGenerateResult<T> {
  data: T;
  /** What this call spent. All zero on a cache hit. */
  usage: LlmUsage & { costUsd: string };
  latencyMs: number;
  model: string;
  promptVersion: number;
  cacheHit: boolean;
  /** Provider calls made, retries and the repair call included. 0 on a cache hit. */
  attempts: number;
}

/**
 * A streamed call: free text, chunk by chunk. No schema or rules here: the
 * caller decides what a valid piece of the stream is (e.g. one JSON line),
 * because only it knows where one piece ends.
 */
export interface LlmStreamRequest {
  feature: string;
  promptId: string;
  promptVersion: number;
  variables: PromptVariables;
  /** Defaults to LLM_MODEL. */
  model?: string;
  maxTokens: number;
  correlationId?: string;
  /** Aborts the provider stream (e.g. a generation timeout). */
  signal?: AbortSignal;
  /** Per provider request; defaults to LLM_TIMEOUT_MS. A long stream may need more. */
  timeoutMs?: number;
}

export type LlmServiceStreamEvent =
  | { type: 'text'; text: string }
  | {
      type: 'done';
      usage: LlmUsage & { costUsd: string };
      stopReason: LlmStopReason;
      model: string;
      promptVersion: number;
      attempts: number;
      latencyMs: number;
    };

/** What record() needs to know about the request, generate() or stream(). */
type RecordedRequest = Pick<
  LlmGenerateRequest<unknown>,
  'feature' | 'promptId' | 'promptVersion' | 'correlationId'
>;

export interface LlmServiceOptions {
  defaultModel: string;
  dailyBudgetUsd: string;
  cacheTtlSeconds: number;
  timeoutMs: number;
  /** Cap for a provider's Retry-After header (LLM_RETRY_AFTER_MAX_MS). */
  maxRetryAfterMs: number;
  /** Full-jitter backoff between retries (LLM_RETRY_BASE_DELAY_MS, LLM_RETRY_MAX_DELAY_MS). */
  backoff: BackoffOptions;
  /** In [0, 1), for backoff jitter. Injected so tests are deterministic. */
  random: () => number;
  sleep: (ms: number) => Promise<void>;
}

export const LLM_SERVICE_OPTIONS = Symbol('LLM_SERVICE_OPTIONS');

export const REPAIR_PROMPT = { id: 'llm-repair', version: 1 } as const;

/** Mutable totals for one generate() call, written to llm_calls at the end. */
interface CallTally {
  model: string;
  usage: LlmUsage;
  attempts: number;
  /** The llm.generate span; ended by record(). */
  span: Span;
  /** True when usage had to be estimated (a stream without final usage). */
  usageEstimated: boolean;
}

/** About 4 characters per token: a rough estimate, used only when the provider never reported usage. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * The single entry point for LLM work. generate() runs, in order:
 *   budget guard -> cache lookup -> render prompt -> provider call (with
 *   retries) -> stop-reason check -> parse + zod -> rules -> one repair call
 *   if invalid -> cache the result -> record one llm_calls row (always,
 *   whatever happens).
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(
    @Inject(LLM_CLIENT) private readonly client: LlmClient,
    private readonly prompts: PromptRegistry,
    @Inject(LLM_CALL_STORE) private readonly store: LlmCallStore,
    @Inject(LLM_CACHE) private readonly cache: LlmCache,
    private readonly pricing: LlmPricing,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LLM_SERVICE_OPTIONS) private readonly options: LlmServiceOptions,
    private readonly metrics: LlmMetrics,
  ) {}

  /** Does nothing until an OpenTelemetry SDK is registered (see src/telemetry.ts). */
  private readonly tracer = trace.getTracer('quizforge.llm');

  private newTally(
    request: RecordedRequest & { model?: string },
    streamed: boolean,
  ): CallTally {
    const model = request.model ?? this.options.defaultModel;
    return {
      model,
      usage: { inputTokens: 0, outputTokens: 0 },
      attempts: 0,
      usageEstimated: false,
      span: this.tracer.startSpan('llm.generate', {
        attributes: {
          'llm.feature': request.feature,
          'llm.model': model,
          'llm.prompt_id': request.promptId,
          'llm.prompt_version': request.promptVersion,
          'llm.streamed': streamed,
        },
      }),
    };
  }

  async generate<T>(
    request: LlmGenerateRequest<T>,
  ): Promise<LlmGenerateResult<T>> {
    const tally = this.newTally(request, false);
    // Active span: database and HTTP spans made during the call nest under it.
    return context.with(trace.setSpan(context.active(), tally.span), () =>
      this.generateWithTally(request, tally),
    );
  }

  private async generateWithTally<T>(
    request: LlmGenerateRequest<T>,
    tally: CallTally,
  ): Promise<LlmGenerateResult<T>> {
    const startedAt = performance.now();
    const finish = async (
      status: LlmCallStatus,
      extra: { cacheHit?: boolean; errorCode?: string } = {},
    ) => {
      const latencyMs = Math.round(performance.now() - startedAt);
      const costUsd = this.pricing.costUsd(tally.model, tally.usage);
      await this.record(request, tally, {
        status,
        latencyMs,
        costUsd,
        ...extra,
      });
      return { latencyMs, costUsd };
    };

    try {
      await this.assertWithinBudget();

      const cacheKey = this.usesCache(request)
        ? buildCacheKey({
            feature: request.feature,
            promptId: request.promptId,
            promptVersion: request.promptVersion,
            model: tally.model,
            variables: request.variables,
          })
        : undefined;

      if (cacheKey !== undefined) {
        const cached = await this.readCache(cacheKey, request);
        if (cached !== undefined) {
          const { latencyMs, costUsd } = await finish('ok', { cacheHit: true });
          return this.result(request, tally, cached, {
            latencyMs,
            costUsd,
            cacheHit: true,
          });
        }
      }

      const valid = await this.generateValid(request, tally);

      if (cacheKey !== undefined) {
        await this.writeCache(cacheKey, valid.json);
      }
      const { latencyMs, costUsd } = await finish('ok');
      return this.result(request, tally, valid.data, {
        latencyMs,
        costUsd,
        cacheHit: false,
      });
    } catch (error) {
      const { status, errorCode } = describeFailure(error);
      await finish(status, errorCode === undefined ? {} : { errorCode });
      this.logger.warn(
        `LLM call failed: feature=${request.feature} prompt=${request.promptId}@v${request.promptVersion} ` +
          `model=${tally.model} attempts=${tally.attempts} code=${errorCode ?? status}`,
      );
      throw error;
    }
  }

  /**
   * Streams the model's text as it arrives. Same guarantees as generate():
   * the budget guard runs before any provider call, the prompt comes from
   * the registry, and exactly one llm_calls row is recorded, also when the
   * stream fails, is aborted, or the consumer stops reading early.
   *
   * Retries (429, 5xx, timeouts) only happen before the first chunk: once
   * text has been handed out it cannot be taken back. A refusal throws
   * LlmRefusalError at the end; hitting maxTokens does not throw, because the
   * text so far may still be useful (stopReason says so).
   */
  async *stream(
    request: LlmStreamRequest,
  ): AsyncGenerator<LlmServiceStreamEvent> {
    const startedAt = performance.now();
    const tally = this.newTally(request, true);
    // For estimating usage if the stream never reports it (see estimateUsage).
    let reportedInputTokens: number | undefined;
    let promptText = '';
    let receivedText = '';
    let usageReported = false;
    const estimateUsage = () => {
      if (usageReported || tally.attempts === 0) {
        return;
      }
      tally.usage = {
        inputTokens: reportedInputTokens ?? estimateTokens(promptText),
        outputTokens: estimateTokens(receivedText),
      };
      tally.usageEstimated = true;
    };
    const finish = async (status: LlmCallStatus, errorCode?: string) => {
      const latencyMs = Math.round(performance.now() - startedAt);
      const costUsd = this.pricing.costUsd(tally.model, tally.usage);
      await this.record(request, tally, {
        status,
        latencyMs,
        costUsd,
        ...(errorCode === undefined ? {} : { errorCode }),
      });
      return { latencyMs, costUsd };
    };
    let recorded = false;

    try {
      await this.assertWithinBudget();
      const prompt = this.prompts.render(
        request.promptId,
        request.promptVersion,
        request.variables,
      );
      promptText = (prompt.system ?? '') + prompt.user;
      const providerRequest: LlmRequest = {
        promptId: request.promptId,
        model: tally.model,
        ...(prompt.system === undefined ? {} : { system: prompt.system }),
        messages: [{ role: 'user', content: prompt.user }],
        maxTokens: request.maxTokens,
        timeoutMs: request.timeoutMs ?? this.options.timeoutMs,
        ...(request.signal ? { signal: request.signal } : {}),
      };

      let stopReason: LlmStopReason = 'other';
      for (let attempt = 1; ; attempt++) {
        request.signal?.throwIfAborted();
        tally.attempts++;
        let started = false;
        try {
          for await (const event of this.client.stream(providerRequest)) {
            request.signal?.throwIfAborted();
            if (event.type === 'start') {
              reportedInputTokens = event.inputTokens;
            } else if (event.type === 'text') {
              started = true;
              receivedText += event.text;
              yield { type: 'text', text: event.text };
            } else {
              tally.usage.inputTokens += event.usage.inputTokens;
              tally.usage.outputTokens += event.usage.outputTokens;
              usageReported = true;
              stopReason = event.stopReason;
            }
          }
          break;
        } catch (error) {
          if (!(error instanceof LlmProviderError)) {
            throw error;
          }
          if (started || !isRetryable(error) || attempt >= MAX_ATTEMPTS) {
            throw toLlmError(error);
          }
          await this.options.sleep(
            retryDelayMs(
              attempt,
              error.retryAfterSeconds,
              this.options.random,
              {
                ...this.options.backoff,
                maxRetryAfterMs: this.options.maxRetryAfterMs,
              },
            ),
          );
        }
      }

      if (stopReason === 'refusal') {
        throw new LlmRefusalError();
      }
      recorded = true;
      const { latencyMs, costUsd } = await finish(
        stopReason === 'max_tokens' ? 'truncated' : 'ok',
      );
      yield {
        type: 'done',
        usage: { ...tally.usage, costUsd },
        stopReason,
        model: tally.model,
        promptVersion: request.promptVersion,
        attempts: tally.attempts,
        latencyMs,
      };
    } catch (error) {
      if (!recorded) {
        recorded = true;
        const { status, errorCode } = describeFailure(error);
        estimateUsage();
        await finish(status, errorCode);
        this.logger.warn(
          `LLM stream failed: feature=${request.feature} prompt=${request.promptId}@v${request.promptVersion} ` +
            `model=${tally.model} attempts=${tally.attempts} code=${errorCode ?? status}`,
        );
      }
      throw error;
    } finally {
      // The consumer stopped reading early (break / return): still one row.
      if (!recorded) {
        estimateUsage();
        await finish('error', 'aborted');
      }
    }
  }

  /** llm_calls in [from, toExclusive), summed per UTC day, feature and status (for /usage). */
  usageByDay(from: Date, toExclusive: Date): Promise<UsageRow[]> {
    return this.store.usageByDay(from, toExclusive);
  }

  /** Calls, tokens and cost of every generate() call recorded with this correlation id. */
  getUsage(correlationId: string): Promise<LlmUsageTotals> {
    return this.store.sumUsageByCorrelationId(correlationId);
  }

  /**
   * First call, then at most one repair call. Throws LlmInvalidOutputError if
   * both are invalid, and LlmRefusalError / LlmOutputTruncatedError as soon
   * as either call is refused or cut off, since a repair cannot fix those.
   */
  private async generateValid<T>(
    request: LlmGenerateRequest<T>,
    tally: CallTally,
  ): Promise<Extract<ParseOutcome<T>, { ok: true }>> {
    const prompt = this.prompts.render(
      request.promptId,
      request.promptVersion,
      request.variables,
    );
    const messages: LlmMessage[] = [{ role: 'user', content: prompt.user }];
    const call = (conversation: LlmMessage[]) =>
      this.callWithRetries(
        {
          promptId: request.promptId,
          model: tally.model,
          ...(prompt.system === undefined ? {} : { system: prompt.system }),
          messages: conversation,
          maxTokens: request.maxTokens,
          outputSchema: request.schema,
          timeoutMs: this.options.timeoutMs,
          ...(request.signal ? { signal: request.signal } : {}),
        },
        tally,
      );

    const first = await call(messages);
    assertUsableStop(first, request.maxTokens);
    const firstOutcome = this.validate(first.text, request);
    if (firstOutcome.ok) {
      return firstOutcome;
    }

    // Repair: show the model its own answer and exactly what was wrong with it.
    const repair = this.prompts.render(
      REPAIR_PROMPT.id,
      REPAIR_PROMPT.version,
      {
        violations: formatViolations(firstOutcome.violations),
      },
    );
    const second = await call([
      ...messages,
      { role: 'assistant', content: first.text },
      { role: 'user', content: repair.user },
    ]);
    assertUsableStop(second, request.maxTokens);
    const secondOutcome = this.validate(second.text, request);
    if (secondOutcome.ok) {
      return secondOutcome;
    }
    throw new LlmInvalidOutputError(secondOutcome.violations);
  }

  /** zod first; rules only run on data that has the right shape. */
  private validate<T>(
    text: string,
    request: LlmGenerateRequest<T>,
  ): ParseOutcome<T> {
    const parsed = parseModelOutput(text, request.schema);
    if (!parsed.ok) {
      return parsed;
    }
    const ruleViolations = request.rules?.(parsed.data) ?? [];
    if (ruleViolations.length > 0) {
      return {
        ok: false,
        violations: ruleViolations.map((message) => ({ message })),
      };
    }
    return parsed;
  }

  /**
   * Up to MAX_ATTEMPTS provider calls, with full-jitter backoff between them
   * (or the provider's Retry-After, if longer and present). Only rate limits,
   * 5xx and timeouts are retried. Every call counts as an attempt.
   */
  private async callWithRetries(
    request: LlmRequest,
    tally: CallTally,
  ): Promise<LlmResponse> {
    for (let attempt = 1; ; attempt++) {
      request.signal?.throwIfAborted();
      tally.attempts++;
      try {
        const response = await this.client.generate(request);
        tally.usage.inputTokens += response.usage.inputTokens;
        tally.usage.outputTokens += response.usage.outputTokens;
        return response;
      } catch (error) {
        if (!(error instanceof LlmProviderError)) {
          throw error;
        }
        if (!isRetryable(error) || attempt >= MAX_ATTEMPTS) {
          throw toLlmError(error);
        }
        await this.options.sleep(
          retryDelayMs(attempt, error.retryAfterSeconds, this.options.random, {
            ...this.options.backoff,
            maxRetryAfterMs: this.options.maxRetryAfterMs,
          }),
        );
      }
    }
  }

  /**
   * Fails closed: if today's spend cannot be read, the error propagates and
   * no money is spent. (The cache, by contrast, fails open.)
   */
  private async assertWithinBudget(): Promise<void> {
    const now = this.clock.now();
    const spent = parseUsd(await this.store.sumCostSince(startOfUtcDay(now)));
    if (spent >= parseUsd(this.options.dailyBudgetUsd)) {
      throw new LlmBudgetExceededError(secondsUntilNextUtcMidnight(now));
    }
  }

  private usesCache(request: { cache?: boolean }): boolean {
    return request.cache !== false && this.options.cacheTtlSeconds > 0;
  }

  /**
   * A cached value is validated again before use: the schema or rules may
   * have changed since it was stored. Anything wrong (Redis down, bad entry)
   * counts as a miss, so the cache can never break generation.
   */
  private async readCache<T>(
    key: string,
    request: LlmGenerateRequest<T>,
  ): Promise<T | undefined> {
    let raw: string | null;
    try {
      raw = await this.cache.get(key);
    } catch (error) {
      this.logger.warn(
        `LLM cache read failed, continuing without it: ${describe(error)}`,
      );
      return undefined;
    }
    if (raw === null) {
      return undefined;
    }
    const outcome = this.validate(raw, request);
    if (!outcome.ok) {
      this.logger.warn(
        `Ignoring an LLM cache entry that no longer validates (${request.promptId})`,
      );
      return undefined;
    }
    return outcome.data;
  }

  /** Stores the JSON as the model produced it (before zod transforms), so a re-parse gives the same data. */
  private async writeCache(key: string, json: unknown): Promise<void> {
    try {
      await this.cache.set(
        key,
        JSON.stringify(json),
        this.options.cacheTtlSeconds,
      );
    } catch (error) {
      this.logger.warn(`LLM cache write failed: ${describe(error)}`);
    }
  }

  /**
   * Never throws. A failed insert must not turn a successful (and paid for)
   * generation into an error, or replace the real error on a failed one.
   */
  private async record(
    request: RecordedRequest,
    tally: CallTally,
    outcome: {
      status: LlmCallStatus;
      latencyMs: number;
      costUsd: string;
      cacheHit?: boolean;
      errorCode?: string;
    },
  ): Promise<void> {
    try {
      await this.store.record({
        feature: request.feature,
        promptId: request.promptId,
        promptVersion: request.promptVersion,
        model: tally.model,
        inputTokens: tally.usage.inputTokens,
        outputTokens: tally.usage.outputTokens,
        costUsd: outcome.costUsd,
        latencyMs: outcome.latencyMs,
        status: outcome.status,
        cacheHit: outcome.cacheHit ?? false,
        attempts: tally.attempts,
        errorCode: outcome.errorCode ?? null,
        correlationId: request.correlationId ?? null,
        usageEstimated: tally.usageEstimated,
      });
    } catch (error) {
      this.logger.error(
        `Failed to record an llm_calls row: ${describe(error)}`,
      );
    }
    this.observe(request, tally, outcome);
  }

  /** Prometheus metrics and the span's final attributes. Never throws. */
  private observe(
    request: RecordedRequest,
    tally: CallTally,
    outcome: {
      status: LlmCallStatus;
      latencyMs: number;
      costUsd: string;
      cacheHit?: boolean;
      errorCode?: string;
    },
  ): void {
    try {
      this.metrics.record({
        feature: request.feature,
        status: outcome.status,
        latencyMs: outcome.latencyMs,
        inputTokens: tally.usage.inputTokens,
        outputTokens: tally.usage.outputTokens,
        costUsd: outcome.costUsd,
      });
    } catch (error) {
      this.logger.error(`Failed to record LLM metrics: ${describe(error)}`);
    }
    const { span } = tally;
    span.setAttributes({
      'llm.input_tokens': tally.usage.inputTokens,
      'llm.output_tokens': tally.usage.outputTokens,
      'llm.cache_hit': outcome.cacheHit ?? false,
      'llm.attempts': tally.attempts,
      'llm.status': outcome.status,
      'llm.usage_estimated': tally.usageEstimated,
    });
    if (outcome.status !== 'ok') {
      // Only the status and code: an error message could quote model output.
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: outcome.errorCode ?? outcome.status,
      });
    }
    span.end();
  }

  private result<T>(
    request: LlmGenerateRequest<T>,
    tally: CallTally,
    data: T,
    extra: { latencyMs: number; costUsd: string; cacheHit: boolean },
  ): LlmGenerateResult<T> {
    return {
      data,
      usage: { ...tally.usage, costUsd: extra.costUsd },
      latencyMs: extra.latencyMs,
      model: tally.model,
      promptVersion: request.promptVersion,
      cacheHit: extra.cacheHit,
      attempts: tally.attempts,
    };
  }
}

/**
 * A refused or truncated response is final: checked before parsing, because
 * truncated output that happens to parse is still incomplete.
 */
function assertUsableStop(response: LlmResponse, maxTokens: number): void {
  if (response.stopReason === 'refusal') {
    throw new LlmRefusalError();
  }
  if (response.stopReason === 'max_tokens') {
    throw new LlmOutputTruncatedError(maxTokens);
  }
}

/** Translates a provider error that was not (or no longer) worth retrying. */
function toLlmError(error: LlmProviderError): Error {
  switch (error.kind) {
    case 'rate_limited':
      return new LlmRateLimitedError(error.retryAfterSeconds ?? 30, {
        cause: error,
      });
    case 'timeout':
      return new LlmTimeoutError({ cause: error });
    case 'server':
    case 'client':
      return new LlmUpstreamError({ cause: error });
    case 'aborted':
      // The caller asked for this; pass it through unchanged.
      return error;
  }
}

function describeFailure(error: unknown): {
  status: LlmCallStatus;
  errorCode?: string;
} {
  if (error instanceof LlmBudgetExceededError) {
    return { status: 'budget_exceeded' };
  }
  if (error instanceof LlmInvalidOutputError) {
    return { status: 'invalid_output' };
  }
  if (error instanceof LlmRefusalError) {
    return { status: 'refused' };
  }
  if (error instanceof LlmOutputTruncatedError) {
    return { status: 'truncated' };
  }
  if (error instanceof LlmError) {
    return { status: 'error', errorCode: error.code };
  }
  if (error instanceof LlmProviderError && error.kind === 'aborted') {
    return { status: 'error', errorCode: 'aborted' };
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return { status: 'error', errorCode: 'aborted' };
  }
  return { status: 'error', errorCode: 'unexpected' };
}

/** One line per violation, for the repair prompt. */
export function formatViolations(violations: LlmViolation[]): string {
  return violations
    .map(({ pointer, message }) =>
      pointer === undefined ? `- ${message}` : `- ${pointer}: ${message}`,
    )
    .join('\n');
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
