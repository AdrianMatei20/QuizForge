import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import { checkIn } from '../database/check-in.js';
import { LLM_EFFORTS, type LlmEffort } from '../llm/llm-client.js';
import type { EvalRunMetrics } from './eval.types.js';

/**
 * One eval harness run: which prompt, model and judge, and the metrics it
 * measured (overall and per lesson). The questions and the judge's reasons
 * stay in the report files; this table holds numbers only.
 */
@Entity('eval_runs')
@Check('CHK_eval_runs_effort', checkIn('effort', LLM_EFFORTS))
// Serves the run list, newest first.
@Index('IDX_eval_runs_created_at', ['createdAt'])
export class EvalRun {
  // Set by the runner, not the database: the id is used as the correlation
  // id of the run's LLM calls before the row is saved.
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'prompt_id', type: 'varchar', length: 100 })
  promptId: string;

  @Column({ name: 'prompt_version', type: 'integer' })
  promptVersion: number;

  @Column({ type: 'varchar', length: 100 })
  model: string;

  @Column({ name: 'judge_model', type: 'varchar', length: 100 })
  judgeModel: string;

  /** Null: the provider's default effort. */
  @Column({ type: 'varchar', length: 10, nullable: true })
  effort: LlmEffort | null;

  /** A --dry-run with the fake provider: its numbers mean nothing. */
  @Column({ name: 'dry_run', type: 'boolean' })
  dryRun: boolean;

  @Column({ name: 'lesson_count', type: 'integer' })
  lessonCount: number;

  /** The Markdown report, relative to api/ (the JSON report sits next to it). */
  @Column({ name: 'report_file', type: 'varchar', length: 300 })
  reportFile: string;

  @Column({ type: 'jsonb' })
  metrics: EvalRunMetrics;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
