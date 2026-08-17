/**
 * Application entry.
 *
 * Order matters here: the reset lands before the tokens, and both land before any
 * component's CSS module, so a component's own rules always win over the baseline. Vite
 * preserves import order within a chunk, which is what makes this reliable rather than
 * lucky.
 */

import './styles/reset.css';
import './styles/tokens.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import { applyTheme, getStoredTheme, watchSystemTheme } from './styles/theme';

// Applied before the first React render so a dark-mode user never sees a white flash.
// index.html sets the attribute inline for the same reason; this call re-applies it once
// the module graph is up and takes over the system-preference subscription.
applyTheme(getStoredTheme());
watchSystemTheme(() => applyTheme(getStoredTheme()));

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
