import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Migrates the quizforge_test database once before any suite runs.
    globalSetup: ['./test/global-setup.ts'],
    // The suites share one database (llm_calls in particular), so run the
    // files one at a time instead of in parallel workers.
    fileParallelism: false,
  },
});
