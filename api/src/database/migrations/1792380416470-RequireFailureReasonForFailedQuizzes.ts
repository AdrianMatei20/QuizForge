import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Generated, plus a hand-written backfill: quizzes that failed before
 * failure_reason existed have a null reason and would violate the new
 * constraint. Their real reason is unknown, so they get internal_error.
 * down() keeps the backfilled reasons, which are valid without the constraint.
 */
export class RequireFailureReasonForFailedQuizzes1792380416470 implements MigrationInterface {
  name = 'RequireFailureReasonForFailedQuizzes1792380416470';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_quizzes_lesson_id"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_quizzes_lesson_id_created_at" ON "quizzes"  ("lesson_id", "created_at") `,
    );
    await queryRunner.query(
      `UPDATE "quizzes" SET "failure_reason" = 'internal_error' WHERE "status" = 'failed' AND "failure_reason" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "quizzes" ADD CONSTRAINT "CHK_quizzes_failed_has_reason" CHECK (("status" = 'failed') = ("failure_reason" IS NOT NULL))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "quizzes" DROP CONSTRAINT "CHK_quizzes_failed_has_reason"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_quizzes_lesson_id_created_at"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_quizzes_lesson_id" ON "quizzes" USING btree ("lesson_id") `,
    );
  }
}
