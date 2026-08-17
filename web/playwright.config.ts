import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * These tests exist for the four M0 acceptance criteria that cannot be asserted anywhere
 * else, because they are about the browser itself: that a client which loses its
 * IndexedDB rebuilds an identical replica, that a schema bump drops the store without
 * asking, and that two real browser contexts see each other's writes. Everything provable
 * below the browser is already a Go or Vitest test, and is not repeated here — an e2e
 * suite that re-tests the domain layer is slow, flaky, and tells you less.
 */
export default defineConfig({
  testDir: './e2e',
  // Long enough for a cold bootstrap on a loaded CI box; short enough that a hang is a
  // failure rather than a stalled pipeline.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  // Serial locally so a failure is easy to watch; parallel in CI where nobody is watching.
  fullyParallel: !!process.env.CI,
  workers: process.env.CI ? 2 : 1,

  // A test that only passes on a retry is a flaky test, and a flaky test in this suite
  // usually means a real race in the sync engine. Retries are allowed in CI so a
  // transient infrastructure blip does not block a merge, but the retry is reported.
  retries: process.env.CI ? 1 : 0,

  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: process.env.POLARIS_E2E_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // The dev server is started by the harness rather than here when POLARIS_E2E_URL is
  // set, so the same suite can run against a built preview or a deployed environment.
  webServer: process.env.POLARIS_E2E_URL
    ? undefined
    : {
        command: 'pnpm dev',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
