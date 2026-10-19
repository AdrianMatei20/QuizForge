import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Migrates the quizforge_test database once before any suite runs.
    globalSetup: ['./test/global-setup.ts'],
  },
});
