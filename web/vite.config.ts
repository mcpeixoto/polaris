import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// The dev server proxies the API and the socket so the browser sees ONE origin, exactly
// as it will in production behind Caddy or nginx. Developing against two origins would
// mean cookies and CORS behave differently in development than in production — which is
// how an auth bug reaches staging.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // Bind IPv4 as well as IPv6. Default `localhost` is [::1]-only on macOS,
    // which makes http://127.0.0.1:5173 refuse even while Vite is "up".
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/graphql': 'http://localhost:8088',
      '/auth': 'http://localhost:8088',
      '/oauth/token': 'http://localhost:8088',
      '/oauth/revoke': 'http://localhost:8088',
      '/sync/bootstrap': 'http://localhost:8088',
      '/sync': { target: 'ws://localhost:8089', ws: true },
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
