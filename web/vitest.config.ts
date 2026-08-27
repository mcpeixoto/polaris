/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

import { aliases, isEnterprise } from './edition';

// Test configuration is deliberately a separate file rather than a `test` key in
// vite.config.ts.
//
// vitest 2 pins vite 5's types while the app builds against vite 6, so the two type
// universes disagree about what a Plugin is and merging the configs makes every plugin
// structurally incompatible. Keeping them apart also means the test runner does not need
// the React plugin at all: esbuild handles JSX from tsconfig's "jsx": "react-jsx", and
// there is no Fast Refresh to configure in a test process.
export default defineConfig({
  // The same aliases the bundler uses, from the same file, so the suite can never resolve
  // `@ee` to a different module than the build does. POLARIS_EDITION selects the edition
  // under test exactly as it selects the edition being built.
  resolve: { alias: aliases() },
  test: {
    // Unit tests only. The e2e directory is Playwright's, and its specs import
    // @playwright/test — which vitest can load but cannot run, producing a failure that
    // looks like a broken test rather than a misrouted one.
    //
    // The commercial tree's tests are included only in an enterprise run. In a core run
    // `@ee` is the stub, so those specs would be testing the stub under the ee tests' names
    // — green, and proving nothing about the code they are named after.
    include: isEnterprise
      ? ['src/**/*.{test,spec}.{ts,tsx}', '../ee/web/**/*.{test,spec}.{ts,tsx}']
      : ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
    css: false,
  },
});
