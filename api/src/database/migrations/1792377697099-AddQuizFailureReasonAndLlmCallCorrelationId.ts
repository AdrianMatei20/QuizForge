import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Generated. Both columns are nullable, so existing rows need no backfill:
 * older llm_calls rows simply have no correlation id, and quizzes that failed
 * before this migration have no recorded reason.
 */
export class AddQuizFailureReasonAndLlmCallCorrelationId1792377697099 implements MigrationInterface {
  name = 'AddQuizFailureReasonAndLlmCallCorrelationId1792377697099';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "llm_calls" ADD "correlation_id" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "quizzes" ADD "failure_reason" character varying(30)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_llm_calls_correlation_id" ON "llm_calls"  ("correlation_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "quizzes" ADD CONSTRAINT "CHK_quizzes_failure_reason" CHECK ("failure_reason" IN ('invalid_output', 'refusal', 'truncated', 'budget_exceeded', 'timeout', 'rate_limited', 'provider_error', 'cancelled', 'internal_error'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "quizzes" DROP CONSTRAINT "CHK_quizzes_failure_reason"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_llm_calls_correlation_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "quizzes" DROP COLUMN "failure_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "llm_calls" DROP COLUMN "correlation_id"`,
    );
  }
}
