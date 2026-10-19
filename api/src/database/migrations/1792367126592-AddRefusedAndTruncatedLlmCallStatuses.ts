import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Written by hand: TypeORM compares CHECK constraints by name only, so
 * migration:generate does not notice a changed expression.
 */
export class AddRefusedAndTruncatedLlmCallStatuses1792367126592 implements MigrationInterface {
  name = 'AddRefusedAndTruncatedLlmCallStatuses1792367126592';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "llm_calls" DROP CONSTRAINT "CHK_llm_calls_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "llm_calls" ADD CONSTRAINT "CHK_llm_calls_status" CHECK ("status" IN ('ok', 'invalid_output', 'error', 'budget_exceeded', 'refused', 'truncated'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rows with the new statuses would break the old constraint. Fold them
    // into "error", keeping what happened in error_code.
    await queryRunner.query(
      `UPDATE "llm_calls" SET "error_code" = CASE "status" WHEN 'refused' THEN 'refused' ELSE 'output_truncated' END, "status" = 'error' WHERE "status" IN ('refused', 'truncated')`,
    );
    await queryRunner.query(
      `ALTER TABLE "llm_calls" DROP CONSTRAINT "CHK_llm_calls_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "llm_calls" ADD CONSTRAINT "CHK_llm_calls_status" CHECK ("status" IN ('ok', 'invalid_output', 'error', 'budget_exceeded'))`,
    );
  }
}
