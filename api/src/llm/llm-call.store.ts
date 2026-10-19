import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { LlmCall, type LlmCallStatus } from './llm-call.entity.js';
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

/** llm_calls summed per UTC day, feature and status. Costs are decimal strings. */
export interface UsageRow {
  /** UTC day, YYYY-MM-DD. */
  day: string;
  feature: string;
  status: LlmCallStatus;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: string;
  cacheHits: number;
  estimatedCalls: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: string;
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
  /** Calls created in [from, toExclusive), summed per UTC day, feature and status. */
  usageByDay(from: Date, toExclusive: Date): Promise<UsageRow[]>;
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

  async usageByDay(from: Date, toExclusive: Date): Promise<UsageRow[]> {
    // Plain SQL: a reporting query reads best as itself. Sums run in
    // Postgres on numeric, so costs stay exact; pg returns bigint and numeric
    // as strings, and token counts fit safely in a number.
    const rows = await this.calls.query<Record<keyof UsageRow, string>[]>(
      `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "day",
              feature AS "feature",
              status AS "status",
              COUNT(*) AS "calls",
              COALESCE(SUM(input_tokens), 0) AS "inputTokens",
              COALESCE(SUM(output_tokens), 0) AS "outputTokens",
              COALESCE(SUM(cost_usd), 0) AS "costUsd",
              COUNT(*) FILTER (WHERE cache_hit) AS "cacheHits",
              COUNT(*) FILTER (WHERE usage_estimated) AS "estimatedCalls",
              COALESCE(SUM(input_tokens) FILTER (WHERE usage_estimated), 0) AS "estimatedInputTokens",
              COALESCE(SUM(output_tokens) FILTER (WHERE usage_estimated), 0) AS "estimatedOutputTokens",
              COALESCE(SUM(cost_usd) FILTER (WHERE usage_estimated), 0) AS "estimatedCostUsd"
         FROM llm_calls
        WHERE created_at >= $1 AND created_at < $2
        GROUP BY 1, 2, 3
        ORDER BY 1, 2, 3`,
      [from, toExclusive],
    );
    return rows.map((row) => ({
      day: row.day,
      feature: row.feature,
      status: row.status as LlmCallStatus,
      calls: Number(row.calls),
      inputTokens: Number(row.inputTokens),
      outputTokens: Number(row.outputTokens),
      costUsd: formatUsd(parseUsd(row.costUsd)),
      cacheHits: Number(row.cacheHits),
      estimatedCalls: Number(row.estimatedCalls),
      estimatedInputTokens: Number(row.estimatedInputTokens),
      estimatedOutputTokens: Number(row.estimatedOutputTokens),
      estimatedCostUsd: formatUsd(parseUsd(row.estimatedCostUsd)),
    }));
  }
}
