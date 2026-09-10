import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * These tests exist for the acceptance criteria that cannot be asserted anywhere else,
 * because they are about the browser itself: that a client which loses its IndexedDB
 * rebuilds an identical replica, that a schema bump drops the store without asking, that two
 * real browser contexts see each other's writes, and that somebody following an invitation
 * link on a browser that has never seen Polaris ends up inside the workspace. Everything
 * provable below the browser is already a Go or Vitest test, and is not repeated here — an
 * e2e suite that re-tests the domain layer is slow, flaky, and tells you less.
 *
 * **The API under test has to allow open registration.** Every test gets its own account, and
 * `POLARIS_REGISTRATION_MODE` defaults to `invite`, under which exactly two people may
 * register: somebody holding an invitation, and the very first account on an empty install.
 * So start the server with `POLARIS_REGISTRATION_MODE=open`, as .github/workflows/ci.yml
 * does. The fixture says so by name when the server refuses, rather than letting a 403 about
 * invitations look like a product bug.
 */
export default defineConfig({
  testDir: './e2e',
  // Long enough for a cold bootstrap on a loaded CI box; short enough that a hang is a
  // failure rather than a stalled pipeline.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  // Serial locally so a failure is easy to watch; parallel in CI where nobody is watching.
  fullyParallel: !!process.env.CI,
  workers: process.env.CI ? 4 : 1,

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

  // The app server is started by the harness rather than here when POLARIS_E2E_URL is
  // set, so the same suite can run against a built preview or a deployed environment.
  //
  // CI serves a production build: 124 tests each loading the SPA through the
  // transform pipeline is the long pole. Local keeps `pnpm dev` so a change is
  // visible without waiting for a rebuild. Skip `tsc -b` in the CI command; the
  // web job already typechecks.
  webServer: process.env.POLARIS_E2E_URL
    ? undefined
    : {
        command: process.env.CI
          ? 'pnpm exec vite build && pnpm exec vite preview --host --port 5173 --strictPort'
          : 'pnpm dev',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        timeout: process.env.CI ? 120_000 : 60_000,
      },
});
