/**
 * npm run eval:sample -- <run>
 *
 * Writes 20 randomly chosen judged questions of a run to
 * evals/samples/<run id>-sample.csv, with an empty my_verdict column to fill
 * in (pass or fail). Then `npm run eval:agreement -- <file.csv>` reports how
 * often you agreed with the judge.
 */
import { NestFactory } from '@nestjs/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SAMPLE_SIZE, sampleRows } from '../agreement.js';
import { toCsv } from '../csv.js';
import { EvalRunsCliModule } from '../eval-cli.module.js';
import { EVAL_SAMPLES_DIR } from '../eval-paths.js';
import { EvalRunsService } from '../eval-runs.service.js';

const [id, ...rest] = process.argv.slice(2);
if (!id || rest.length > 0) {
  console.error(
    'Usage: npm run eval:sample -- <run>   (a run id, or a unique prefix)',
  );
  process.exit(2);
}

const app = await NestFactory.createApplicationContext(EvalRunsCliModule, {
  logger: ['warn', 'error'],
});
let exitCode = 0;
try {
  const runs = app.get(EvalRunsService);
  const run = await runs.findByIdOrPrefix(id);
  if (run.dryRun) {
    console.warn(
      'Warning: this is a dry run. Its verdicts are canned, so agreeing with them means nothing.',
    );
  }
  const rows = sampleRows(runs.readReport(run), SAMPLE_SIZE);
  mkdirSync(EVAL_SAMPLES_DIR, { recursive: true });
  const file = join(EVAL_SAMPLES_DIR, `${run.id}-sample.csv`);
  writeFileSync(file, toCsv(rows));
  console.log(
    `Wrote ${rows.length - 1} questions to ${file}\nFill in my_verdict (pass or fail) for each, then run: npm run eval:agreement -- ${file}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exitCode = 1;
} finally {
  await app.close();
}
process.exit(exitCode);
