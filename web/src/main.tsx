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
import './styles/motion.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import { applyTheme, getStoredTheme, watchSystemTheme } from './styles/theme';
import { applyPrefs } from './features/prefs/prefs';

// Applied before the first React render so a dark-mode user never sees a white flash.
// index.html sets the attribute inline for the same reason; this call re-applies it once
// the module graph is up and takes over the system-preference subscription.
applyTheme(getStoredTheme());
watchSystemTheme(() => applyTheme(getStoredTheme()));
applyPrefs();

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root is missing from index.html');
}

createRoot(container, {
  /*
   * The errors no boundary got to see.
   *
   * `app/ErrorBoundary` catches everything thrown during a render it encloses, which is the
   * case that matters to a user. This is the other one: a throw React could not deliver to a
   * boundary at all — inside a passive effect's cleanup during an unmount, say — where React
   * would otherwise re-throw to the window and the only trace is a stack with no component in
   * it. Logging it here is not recovery, and is not pretending to be: it is the difference
   * between a support ticket that names a component and one that says "it went blank".
   */
  onUncaughtError: (error, info) => {
    console.error('[polaris] an error escaped every boundary', error, info.componentStack);
  },
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
