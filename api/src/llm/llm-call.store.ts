import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { LlmCall } from './llm-call.entity.js';
import { formatUsd, parseUsd } from './money.js';

export type LlmCallRecord = Omit<LlmCall, 'id' | 'createdAt'>;

/** What the calls sharing one correlation id used, summed. */
export interface LlmUsageTotals {
  /** llm_calls rows: one per generate() call. */
  calls: number;
  /** Provider requests, retries and repair calls included. */
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  /** Decimal string with 6 places, e.g. "0.004530". */
  costUsd: string;
}

/**
 * What LlmService needs from storage, kept small so unit tests can use an
 * in-memory version instead of mocking TypeORM.
 */
export interface LlmCallStore {
  record(call: LlmCallRecord): Promise<void>;
  /** Total cost_usd of calls created at or after `since`, as a decimal string. */
  sumCostSince(since: Date): Promise<string>;
  /** Totals for the calls recorded with this correlation id; all zero if there are none. */
  sumUsageByCorrelationId(correlationId: string): Promise<LlmUsageTotals>;
}

export const LLM_CALL_STORE = Symbol('LLM_CALL_STORE');

@Injectable()
export class TypeOrmLlmCallStore implements LlmCallStore {
  constructor(
    @InjectRepository(LlmCall) private readonly calls: Repository<LlmCall>,
  ) {}

  async record(call: LlmCallRecord): Promise<void> {
    await this.calls.insert(call);
  }

  async sumCostSince(since: Date): Promise<string> {
    // The SUM runs in Postgres on numeric values, so it stays exact.
    const row = await this.calls
      .createQueryBuilder('call')
      .select('COALESCE(SUM(call.cost_usd), 0)', 'total')
      .where('call.created_at >= :since', { since })
      .getRawOne<{ total: string }>();
    return row?.total ?? '0';
  }

  async sumUsageByCorrelationId(
    correlationId: string,
  ): Promise<LlmUsageTotals> {
    // pg returns COUNT and SUM of integers as bigint strings, and SUM of
    // numeric as a numeric string; token counts fit safely in a number.
    const row = await this.calls
      .createQueryBuilder('call')
      .select('COUNT(*)', 'calls')
      .addSelect('COALESCE(SUM(call.attempts), 0)', 'attempts')
      .addSelect('COALESCE(SUM(call.input_tokens), 0)', 'inputTokens')
      .addSelect('COALESCE(SUM(call.output_tokens), 0)', 'outputTokens')
      .addSelect('COALESCE(SUM(call.cost_usd), 0)', 'costUsd')
      .where('call.correlation_id = :correlationId', { correlationId })
      .getRawOne<Record<keyof LlmUsageTotals, string>>();
    return {
      calls: Number(row?.calls ?? 0),
      attempts: Number(row?.attempts ?? 0),
      inputTokens: Number(row?.inputTokens ?? 0),
      outputTokens: Number(row?.outputTokens ?? 0),
      costUsd: formatUsd(parseUsd(row?.costUsd ?? '0')),
    };
  }
}
