import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

import { aliases } from './edition';

// Where the dev server forwards to. Defaults are the ports `make api` and `make sync`
// bind, so the ordinary `pnpm dev` needs no environment at all. They are overridable
// because a second checkout — a worktree running its own API while the primary stack
// keeps 8088 — otherwise has no way to reach its own backend.
const API_TARGET = process.env.POLARIS_API_URL ?? 'http://localhost:8088';
const SYNC_TARGET = process.env.POLARIS_SYNC_URL ?? 'ws://localhost:8089';

// The dev server proxies the API and the socket so the browser sees ONE origin, exactly
// as it will in production behind Caddy or nginx. Developing against two origins would
// mean cookies and CORS behave differently in development than in production — which is
// how an auth bug reaches staging.
export default defineConfig({
  plugins: [react()],
  // `@ee` resolves to the commercial modules or to the stubs that stand in for them,
  // decided by POLARIS_EDITION at build time. See edition.ts.
  resolve: { alias: aliases() },
  server: {
    // Bind IPv4 as well as IPv6. Default `localhost` is [::1]-only on macOS,
    // which makes http://127.0.0.1:5173 refuse even while Vite is "up".
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/graphql': API_TARGET,
      '/auth': API_TARGET,
      '/oauth/token': API_TARGET,
      '/oauth/revoke': API_TARGET,
      '/mcp': API_TARGET,
      '/asks': API_TARGET,
      '/billing': API_TARGET,
      '/webhooks': API_TARGET,
      '/calendars': API_TARGET,
      '/.well-known': API_TARGET,
      '/sync/bootstrap': API_TARGET,
      '/sync': { target: SYNC_TARGET, ws: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // The editor and the virtualiser are large and change rarely; splitting them out
        // means an ordinary app change does not invalidate them in every user's cache.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router'],
        },
      },
    },
  },
});
