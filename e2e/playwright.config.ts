import { defineConfig, devices } from '@playwright/test';

/**
 * One browser test of the whole app, run against the full Docker stack
 * (`docker compose --profile full up -d --build --wait`) on the fake LLM
 * provider. BASE_URL overrides the web container's address.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env['BASE_URL'] ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
