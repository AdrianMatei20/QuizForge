import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Generated, then edited by hand: the generated version adds NOT NULL columns
 * directly, which fails on a table that already has rows. Existing questions
 * all came from their quiz's prompt and model, so they are backfilled from
 * the quiz before the columns become NOT NULL.
 */
export class AddPromptAndModelToQuestions1792381578779 implements MigrationInterface {
  name = 'AddPromptAndModelToQuestions1792381578779';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "questions" ADD "prompt_id" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "questions" ADD "prompt_version" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "questions" ADD "model" character varying(100)`,
    );
    await queryRunner.query(
      `UPDATE "questions" q SET "prompt_id" = z."prompt_id", "prompt_version" = z."prompt_version", "model" = z."model" FROM "quizzes" z WHERE z."id" = q."quiz_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "questions" ALTER COLUMN "prompt_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "questions" ALTER COLUMN "prompt_version" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "questions" ALTER COLUMN "model" SET NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "questions" DROP COLUMN "model"`);
    await queryRunner.query(
      `ALTER TABLE "questions" DROP COLUMN "prompt_version"`,
    );
    await queryRunner.query(`ALTER TABLE "questions" DROP COLUMN "prompt_id"`);
  }
}
