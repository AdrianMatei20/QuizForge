/**
 * npm run eval:compare -- <runA> <runB>
 *
 * Prints every compared metric of two eval runs side by side: A, B, B - A,
 * and whether that is better or worse. Runs are given by id or by a unique
 * prefix of at least 6 characters.
 */
import { NestFactory } from '@nestjs/core';
import { formatComparedValue, formatDelta } from '../compare.js';
import { EvalRunsCliModule } from '../eval-cli.module.js';
import type { EvalRun } from '../eval-run.entity.js';
import { EvalRunsService } from '../eval-runs.service.js';
import { textTable } from './text-table.js';

const ids = process.argv.slice(2);
if (ids.length !== 2) {
  console.error(
    'Usage: npm run eval:compare -- <runA> <runB>   (run ids, or unique prefixes)',
  );
  process.exit(2);
}

function describeRun(label: string, run: EvalRun): string {
  const date = run.createdAt.toISOString().slice(0, 16).replace('T', ' ');
  return `${label}: ${run.id}  quiz v${run.promptVersion}  ${run.model}  effort ${run.effort ?? 'default'}  judge ${run.judgeModel}  ${date} UTC${run.dryRun ? '  (DRY RUN)' : ''}`;
}

const app = await NestFactory.createApplicationContext(EvalRunsCliModule, {
  logger: ['warn', 'error'],
});
let exitCode = 0;
try {
  const runs = app.get(EvalRunsService);
  const a = await runs.findByIdOrPrefix(ids[0] ?? '');
  const b = await runs.findByIdOrPrefix(ids[1] ?? '');
  const { metrics } = runs.compare(a, b);
  console.log([describeRun('A', a), describeRun('B', b), ''].join('\n'));
  console.log(
    textTable([
      ['Metric', 'A', 'B', 'B - A', ''],
      ...metrics.map((metric) => [
        metric.label,
        formatComparedValue(metric.format, metric.a),
        formatComparedValue(metric.format, metric.b),
        formatDelta(metric.format, metric.delta),
        metric.verdict === 'n/a' ? '' : metric.verdict,
      ]),
    ]),
  );
  if (a.lessonCount !== b.lessonCount) {
    console.log(
      `\nNote: the runs used different numbers of lessons (${a.lessonCount} and ${b.lessonCount}), so they are not directly comparable.`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exitCode = 1;
} finally {
  await app.close();
}
process.exit(exitCode);
