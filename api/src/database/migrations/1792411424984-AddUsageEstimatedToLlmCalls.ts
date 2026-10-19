import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Generated. Existing rows default to false: their usage came from the
 * provider (rows written before this column existed never estimated).
 */
export class AddUsageEstimatedToLlmCalls1792411424984 implements MigrationInterface {
  name = 'AddUsageEstimatedToLlmCalls1792411424984';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "llm_calls" ADD "usage_estimated" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "llm_calls" DROP COLUMN "usage_estimated"`,
    );
  }
}
