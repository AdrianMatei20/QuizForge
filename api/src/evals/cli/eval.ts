/**
 * npm run eval -- --prompt v1 [--model X] [--judge-model Y] [--effort low|medium|high] [--limit N] [--dry-run]
 *
 * Runs the eval harness as a standalone Nest application context (no HTTP
 * server): generates a quiz per lesson in api/evals/lessons, judges every
 * question, writes evals/results/<timestamp>-v<n>.md and .json, and saves
 * an eval_runs row. Built first (`nest build`): Nest needs the decorator
 * metadata that tsc emits.
 */
import {
  DRY_RUN_ENV,
  EVAL_USAGE,
  type EvalArgs,
  parseEvalArgs,
  providerRefusal,
} from './eval-args.js';

let args: EvalArgs;
try {
  args = parseEvalArgs(process.argv.slice(2));
} catch (error) {
  console.error(
    `${error instanceof Error ? error.message : String(error)}\n\n${EVAL_USAGE}`,
  );
  process.exit(2);
}

// Before the config module loads: real environment variables win over .env,
// so a dry run can never reach a paid provider, whatever .env says.
if (args.dryRun) {
  Object.assign(process.env, DRY_RUN_ENV);
}

const { NestFactory } = await import('@nestjs/core');
const { ConfigService } = await import('@nestjs/config');
const { EvalCliModule } = await import('../eval-cli.module.js');
const { EvalRunner } = await import('../eval-runner.service.js');
const { loadEvalLessons } = await import('../eval-lesson.js');
const { formatCost, formatRate } = await import('../eval-report.js');

const app = await NestFactory.createApplicationContext(EvalCliModule, {
  logger: ['log', 'warn', 'error'],
});
let exitCode = 0;
try {
  const config = app.get(ConfigService);
  const refusal = providerRefusal(
    String(config.get('LLM_PROVIDER')),
    args.dryRun,
  );
  if (refusal) {
    throw new Error(refusal);
  }
  const runner = app.get(EvalRunner);
  const options = {
    promptVersion: args.promptVersion,
    model: args.model ?? String(config.get('LLM_MODEL')),
    judgeModel: args.judgeModel ?? String(config.get('LLM_JUDGE_MODEL')),
    ...(args.effort === undefined ? {} : { effort: args.effort }),
    dryRun: args.dryRun,
  };
  runner.assertRunnable(options);
  const lessons = loadEvalLessons(undefined, args.limit);
  console.log(
    `Evaluating quiz v${options.promptVersion} with ${options.model} on ${lessons.length} lessons; judge ${options.judgeModel}${args.dryRun ? ' (dry run)' : ''}`,
  );

  const { report, markdownFile, jsonFile } = await runner.run({
    ...options,
    lessons,
  });
  const m = report.metrics.overall;
  console.log(
    [
      '',
      `Run ${report.run.id}`,
      `  Lessons:                   ${m.lessons}${m.lessonsFailed > 0 ? ` (${m.lessonsFailed} failed)` : ''}`,
      `  Rule-pass before repair:   ${formatRate(m.rulePassBeforeRepairRate)}`,
      `  Quote copy:                ${formatRate(m.quoteCopyRate)}`,
      `  Judge answer correct:      ${formatRate(m.answerCorrectRate)}`,
      `  Judge tests understanding: ${formatRate(m.testsUnderstandingRate)}`,
      `  Cost:                      ${formatCost(m.totalCostUsd)} (generation ${formatCost(m.generation.costUsd)}, judge ${formatCost(m.judge.costUsd)})`,
      `  Report: ${markdownFile}`,
      `  JSON:   ${jsonFile}`,
    ].join('\n'),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exitCode = 1;
} finally {
  await app.close();
}
process.exit(exitCode);
