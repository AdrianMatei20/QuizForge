import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export const LLM_CALL_STATUSES = [
  'ok',
  'invalid_output',
  'error',
  'budget_exceeded',
  'refused',
  'truncated',
] as const;

export type LlmCallStatus = (typeof LLM_CALL_STATUSES)[number];

/**
 * One row per LlmService.generate() call, whatever the outcome. It is the
 * audit trail (which prompt and model produced what) and the source of truth
 * for the daily budget (SUM(cost_usd) since UTC midnight).
 */
@Entity('llm_calls')
// A CHECK constraint instead of a Postgres enum: adding a status later is a
// one-line migration, while altering an enum type is awkward.
@Check(
  'CHK_llm_calls_status',
  `"status" IN (${LLM_CALL_STATUSES.map((status) => `'${status}'`).join(', ')})`,
)
export class LlmCall {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  feature: string;

  @Column({ name: 'prompt_id', type: 'varchar', length: 100 })
  promptId: string;

  @Column({ name: 'prompt_version', type: 'integer' })
  promptVersion: number;

  @Column({ type: 'varchar', length: 100 })
  model: string;

  @Column({ name: 'input_tokens', type: 'integer' })
  inputTokens: number;

  @Column({ name: 'output_tokens', type: 'integer' })
  outputTokens: number;

  // pg returns numeric as a string, which keeps the exact decimal value.
  @Column({ name: 'cost_usd', type: 'numeric', precision: 12, scale: 6 })
  costUsd: string;

  @Column({ name: 'latency_ms', type: 'integer' })
  latencyMs: number;

  @Column({ type: 'varchar', length: 20 })
  status: LlmCallStatus;

  @Column({ name: 'cache_hit', type: 'boolean' })
  cacheHit: boolean;

  @Column({ type: 'integer' })
  attempts: number;

  @Column({ name: 'error_code', type: 'varchar', length: 50, nullable: true })
  errorCode: string | null;

  // Indexed for the budget query: WHERE created_at >= <UTC midnight>.
  @Index('IDX_llm_calls_created_at')
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
