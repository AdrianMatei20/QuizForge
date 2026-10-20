import { parseArgs } from 'node:util';
import { LLM_EFFORTS, type LlmEffort } from '../../llm/llm-client.js';

export const EVAL_USAGE = `Usage: npm run eval -- --prompt v1 [--model X] [--judge-model Y] [--effort low|medium|high] [--limit N] [--dry-run]

  --prompt       quiz prompt version to evaluate (v1, v2, ...)
  --model        model under test (default: LLM_MODEL)
  --judge-model  model that judges the questions (default: LLM_JUDGE_MODEL)
  --effort       provider effort for quiz generation (default: the provider's)
  --limit        only the first N lessons in api/evals/lessons
  --dry-run      use the fake provider and fixtures: no cost, meaningless numbers`;

export interface EvalArgs {
  promptVersion: number;
  model?: string;
  judgeModel?: string;
  effort?: LlmEffort;
  limit?: number;
  dryRun: boolean;
}

/** Throws an Error with a message for the user on anything it does not understand. */
export function parseEvalArgs(argv: string[]): EvalArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      prompt: { type: 'string' },
      model: { type: 'string' },
      'judge-model': { type: 'string' },
      effort: { type: 'string' },
      limit: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: true,
  });
  if (positionals.length > 0) {
    throw new Error(`Unexpected argument: ${positionals.join(' ')}`);
  }

  const prompt = /^v?([1-9]\d*)$/.exec(values.prompt ?? '');
  if (!prompt) {
    throw new Error('--prompt is required, as v1, v2, ...');
  }
  const args: EvalArgs = {
    promptVersion: Number(prompt[1]),
    dryRun: values['dry-run'] ?? false,
  };

  if (values.effort !== undefined) {
    if (!(LLM_EFFORTS as readonly string[]).includes(values.effort)) {
      throw new Error(`--effort must be one of ${LLM_EFFORTS.join(', ')}`);
    }
    args.effort = values.effort as LlmEffort;
  }
  if (values.limit !== undefined) {
    const limit = Number(values.limit);
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('--limit must be a whole number of at least 1');
    }
    args.limit = limit;
  }
  if (
    args.dryRun &&
    (values.model !== undefined || values['judge-model'] !== undefined)
  ) {
    throw new Error(
      '--dry-run always uses the fake models; leave out --model and --judge-model',
    );
  }
  if (values.model !== undefined) {
    args.model = values.model;
  }
  if (values['judge-model'] !== undefined) {
    args.judgeModel = values['judge-model'];
  }
  return args;
}

/**
 * The fake provider answers every lesson with the same canned quiz, so its
 * numbers would look like a real result and mean nothing. Only a run that
 * says so (--dry-run) may use it.
 */
export function providerRefusal(
  provider: string,
  dryRun: boolean,
): string | undefined {
  return provider === 'fake' && !dryRun
    ? 'LLM_PROVIDER is "fake": its answers are canned, so the metrics would mean nothing. Set a real provider in api/.env, or pass --dry-run to only check that the pipeline runs.'
    : undefined;
}

/** What --dry-run puts in the environment before the config loads; the real environment wins over .env. */
export const DRY_RUN_ENV = {
  LLM_PROVIDER: 'fake',
  LLM_MODEL: 'fake-model',
  LLM_JUDGE_MODEL: 'fake-judge-model',
} as const;
