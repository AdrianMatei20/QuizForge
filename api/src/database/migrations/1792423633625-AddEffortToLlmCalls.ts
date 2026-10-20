import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Generated. Existing rows get NULL: they were made without an effort
 * setting, so with the provider's default.
 */
export class AddEffortToLlmCalls1792423633625 implements MigrationInterface {
  name = 'AddEffortToLlmCalls1792423633625';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "llm_calls" ADD "effort" character varying(10)`,
    );
    await queryRunner.query(
      `ALTER TABLE "llm_calls" ADD CONSTRAINT "CHK_llm_calls_effort" CHECK ("effort" IN ('low', 'medium', 'high'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "llm_calls" DROP CONSTRAINT "CHK_llm_calls_effort"`,
    );
    await queryRunner.query(`ALTER TABLE "llm_calls" DROP COLUMN "effort"`);
  }
}
