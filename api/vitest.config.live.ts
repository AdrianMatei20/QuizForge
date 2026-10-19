import { defineConfig } from 'vitest/config';

// Live tests call the real LLM provider and cost money. They only run when
// LLM_LIVE_TESTS=1 (see test/llm.live-spec.ts); otherwise they are skipped.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.live-spec.ts'],
    testTimeout: 120_000,
  },
});
