import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Students' attempts at published quizzes. Written by hand, with the key
 * names TypeORM's naming strategy gives, so `npm run migration:generate`
 * finds no difference afterwards.
 */
export class CreateAttempts1792500000000 implements MigrationInterface {
  name = 'CreateAttempts1792500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "attempts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "quiz_id" uuid NOT NULL, "answers" jsonb NOT NULL, "score" integer NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_295ca261e361fd2fd217754dcac" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_attempts_quiz_id" ON "attempts" ("quiz_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "attempts" ADD CONSTRAINT "FK_249da279880fff0c23541e52515" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "attempts" DROP CONSTRAINT "FK_249da279880fff0c23541e52515"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_attempts_quiz_id"`);
    await queryRunner.query(`DROP TABLE "attempts"`);
  }
}
