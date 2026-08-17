/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

// Test configuration is deliberately a separate file rather than a `test` key in
// vite.config.ts.
//
// vitest 2 pins vite 5's types while the app builds against vite 6, so the two type
// universes disagree about what a Plugin is and merging the configs makes every plugin
// structurally incompatible. Keeping them apart also means the test runner does not need
// the React plugin at all: esbuild handles JSX from tsconfig's "jsx": "react-jsx", and
// there is no Fast Refresh to configure in a test process.
export default defineConfig({
  resolve: {
    alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    // Unit tests only. The e2e directory is Playwright's, and its specs import
    // @playwright/test — which vitest can load but cannot run, producing a failure that
    // looks like a broken test rather than a misrouted one.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
    css: false,
  },
});
