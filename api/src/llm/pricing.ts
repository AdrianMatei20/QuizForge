import { Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { LlmUsage } from './llm-client.js';
import { formatUsd, tokenCostMicros } from './money.js';

// Prices are decimal strings, never floats, like every other amount of money.
const price = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, 'must be a decimal USD amount such as "4.00"');

const pricingFileSchema = z.object({
  source: z.string(),
  checkedOn: z.iso.date(),
  currency: z.literal('USD'),
  models: z.record(
    z.string().min(1),
    z.strictObject({
      inputPerMillionTokens: price,
      outputPerMillionTokens: price,
    }),
  ),
});

export type PricingFile = z.infer<typeof pricingFileSchema>;
export type ModelPrices = PricingFile['models'];

/** Reads and validates the pricing JSON. Throws (and so stops startup) if it is missing or invalid. */
export function loadPricingFile(path: string): ModelPrices {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read the LLM pricing file ${path}`, {
      cause: error,
    });
  }
  const result = pricingFileSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid LLM pricing file ${path}:\n${problems}`);
  }
  return result.data.models;
}

/** Turns token usage into a USD cost string with 6 decimals. */
export class LlmPricing {
  private readonly logger = new Logger(LlmPricing.name);
  private readonly warnedModels = new Set<string>();

  constructor(private readonly prices: ModelPrices) {}

  hasPrice(model: string): boolean {
    return this.prices[model] !== undefined;
  }

  /** Called at startup with the configured models; warns (once each) about any without a price. */
  warnIfUnpriced(models: string[]): void {
    for (const model of models) {
      if (!this.prices[model]) {
        this.warnOnce(model);
      }
    }
  }

  private warnOnce(model: string): void {
    if (this.warnedModels.has(model)) {
      return;
    }
    this.warnedModels.add(model);
    this.logger.warn(
      `No price for model "${model}" in the pricing file; its calls are recorded as costing 0 and do not count toward the daily budget`,
    );
  }

  /**
   * An unknown model costs "0.000000" so a missing price never breaks
   * generation, but it warns once per model, because it also means the
   * daily budget is not counting that model's spend.
   */
  costUsd(model: string, usage: LlmUsage): string {
    const modelPrices = this.prices[model];
    if (!modelPrices) {
      this.warnOnce(model);
      return formatUsd(0n);
    }
    return formatUsd(
      tokenCostMicros([
        {
          tokens: usage.inputTokens,
          pricePerMillionUsd: modelPrices.inputPerMillionTokens,
        },
        {
          tokens: usage.outputTokens,
          pricePerMillionUsd: modelPrices.outputPerMillionTokens,
        },
      ]),
    );
  }
}
