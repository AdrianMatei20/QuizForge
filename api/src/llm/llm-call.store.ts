import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { LlmCall } from './llm-call.entity.js';

export type LlmCallRecord = Omit<LlmCall, 'id' | 'createdAt'>;

/**
 * What LlmService needs from storage, kept small so unit tests can use an
 * in-memory version instead of mocking TypeORM.
 */
export interface LlmCallStore {
  record(call: LlmCallRecord): Promise<void>;
  /** Total cost_usd of calls created at or after `since`, as a decimal string. */
  sumCostSince(since: Date): Promise<string>;
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
}
