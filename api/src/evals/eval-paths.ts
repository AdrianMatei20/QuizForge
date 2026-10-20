import { join } from 'node:path';

/** api/, from both src/evals (tests) and dist/evals (the compiled CLI). Report paths are stored relative to it. */
export const API_DIR = join(import.meta.dirname, '..', '..');

export const EVAL_LESSONS_DIR = join(API_DIR, 'evals', 'lessons');
export const EVAL_RESULTS_DIR = join(API_DIR, 'evals', 'results');
/** Dry-run reports: gitignored, because their numbers mean nothing. */
export const EVAL_DRY_RUN_DIR = join(EVAL_RESULTS_DIR, 'dry-run');
export const EVAL_SAMPLES_DIR = join(API_DIR, 'evals', 'samples');
