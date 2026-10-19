import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Generated for stream_rejected; the CHECK change is written by hand because
 * TypeORM compares CHECK constraints by name only and does not notice a new
 * allowed value ("interrupted", for quizzes left generating by a crash).
 */
export class AddStreamRejectedAndInterruptedReason1792394963379 implements MigrationInterface {
  name = 'AddStreamRejectedAndInterruptedReason1792394963379';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "quizzes" ADD "stream_rejected" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "quizzes" DROP CONSTRAINT "CHK_quizzes_failure_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "quizzes" ADD CONSTRAINT "CHK_quizzes_failure_reason" CHECK ("failure_reason" IN ('invalid_output', 'refusal', 'truncated', 'budget_exceeded', 'timeout', 'rate_limited', 'provider_error', 'cancelled', 'internal_error', 'interrupted'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The old constraint has no "interrupted"; the closest older reason is internal_error.
    await queryRunner.query(
      `UPDATE "quizzes" SET "failure_reason" = 'internal_error' WHERE "failure_reason" = 'interrupted'`,
    );
    await queryRunner.query(
      `ALTER TABLE "quizzes" DROP CONSTRAINT "CHK_quizzes_failure_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "quizzes" ADD CONSTRAINT "CHK_quizzes_failure_reason" CHECK ("failure_reason" IN ('invalid_output', 'refusal', 'truncated', 'budget_exceeded', 'timeout', 'rate_limited', 'provider_error', 'cancelled', 'internal_error'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "quizzes" DROP COLUMN "stream_rejected"`,
    );
  }
}
