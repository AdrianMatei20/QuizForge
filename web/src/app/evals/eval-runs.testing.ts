import type { EvalRunSummary } from '../core/api/api.types';

/** An eval run summary for tests: every field set, override what a test is about. */
export const run = (id: string, overrides: Partial<EvalRunSummary> = {}): EvalRunSummary => ({
  id,
  promptId: 'quiz',
  promptVersion: 1,
  model: 'claude-haiku-5-5',
  judgeModel: 'claude-sonnet-5-5',
  effort: null,
  dryRun: false,
  lessonCount: 10,
  lessonsFailed: 0,
  reportFile: `evals/results/${id}.md`,
  createdAt: '2026-10-19T15:00:00.000Z',
  rulePassBeforeRepairRate: 0.9,
  repairRate: 0.1,
  quoteCopyRate: 0.25,
  answerCorrectRate: 0.95,
  testsUnderstandingRate: 2 / 3,
  totalCostUsd: '0.412300',
  ...overrides,
});
