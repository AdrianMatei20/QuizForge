import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Generated. One row per `npm run eval`: which prompt, model and judge, and the metrics. */
export class CreateEvalRuns1792424240493 implements MigrationInterface {
  name = 'CreateEvalRuns1792424240493';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "eval_runs" ("id" uuid NOT NULL, "prompt_id" character varying(100) NOT NULL, "prompt_version" integer NOT NULL, "model" character varying(100) NOT NULL, "judge_model" character varying(100) NOT NULL, "effort" character varying(10), "dry_run" boolean NOT NULL, "lesson_count" integer NOT NULL, "report_file" character varying(300) NOT NULL, "metrics" jsonb NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_eval_runs_effort" CHECK ("effort" IN ('low', 'medium', 'high')), CONSTRAINT "PK_101cbfa3f6228653c22118190b6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_eval_runs_created_at" ON "eval_runs" ("created_at") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_eval_runs_created_at"`);
    await queryRunner.query(`DROP TABLE "eval_runs"`);
  }
}
