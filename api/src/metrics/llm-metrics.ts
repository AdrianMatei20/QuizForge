import {
  collectDefaultMetrics,
  Counter,
  Histogram,
  Registry,
} from 'prom-client';
import type { LlmCallStatus } from '../llm/llm-call.entity.js';

/** One finished LLM call (generate or stream), as LlmService records it. */
export interface LlmCallMetrics {
  feature: string;
  status: LlmCallStatus;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  /** Decimal USD string, as stored in llm_calls. */
  costUsd: string;
}

/**
 * Prometheus metrics for LLM calls, in their own Registry (not prom-client's
 * global one), so a test can create a fresh instance and read exactly what
 * it recorded. Labels are low-cardinality on purpose: feature and status are
 * small fixed sets; never put ids or prompts in a label.
 */
export class LlmMetrics {
  readonly registry: Registry;
  private readonly requests: Counter<'feature' | 'status'>;
  private readonly latency: Histogram<'feature'>;
  private readonly tokens: Counter<'feature' | 'direction'>;
  private readonly cost: Counter<'feature'>;

  constructor(options: { registry?: Registry; defaultMetrics?: boolean } = {}) {
    this.registry = options.registry ?? new Registry();
    if (options.defaultMetrics) {
      // Node.js process metrics: CPU, memory, event loop lag, GC, handles.
      collectDefaultMetrics({ register: this.registry });
    }
    this.requests = new Counter({
      name: 'llm_requests_total',
      help: 'LLM calls (generate or stream), by feature and outcome (llm_calls.status).',
      labelNames: ['feature', 'status'],
      registers: [this.registry],
    });
    this.latency = new Histogram({
      name: 'llm_latency_seconds',
      help: 'Duration of an LLM call, retries and repair included.',
      labelNames: ['feature'],
      // LLM calls take seconds, not milliseconds.
      buckets: [0.25, 0.5, 1, 2, 5, 10, 20, 30, 60, 120],
      registers: [this.registry],
    });
    this.tokens = new Counter({
      name: 'llm_tokens_total',
      help: 'Tokens billed by the LLM provider, by feature and direction (input/output).',
      labelNames: ['feature', 'direction'],
      registers: [this.registry],
    });
    this.cost = new Counter({
      name: 'llm_cost_usd_total',
      help: 'Cost of LLM calls in USD. A float for graphs; llm_calls keeps the exact decimal.',
      labelNames: ['feature'],
      registers: [this.registry],
    });
  }

  record(call: LlmCallMetrics): void {
    const { feature } = call;
    this.requests.inc({ feature, status: call.status });
    this.latency.observe({ feature }, call.latencyMs / 1000);
    this.tokens.inc({ feature, direction: 'input' }, call.inputTokens);
    this.tokens.inc({ feature, direction: 'output' }, call.outputTokens);
    // Prometheus counters are floats; the exact amount stays in llm_calls.
    this.cost.inc({ feature }, Number(call.costUsd));
  }
}
