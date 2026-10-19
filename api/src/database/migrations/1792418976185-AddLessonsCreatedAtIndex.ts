import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Generated. Serves GET /api/lessons, which lists lessons newest first. */
export class AddLessonsCreatedAtIndex1792418976185 implements MigrationInterface {
  name = 'AddLessonsCreatedAtIndex1792418976185';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_lessons_created_at" ON "lessons" ("created_at") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_lessons_created_at"`);
  }
}
