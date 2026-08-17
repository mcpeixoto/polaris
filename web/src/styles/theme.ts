/**
 * Theme selection.
 *
 * The cascade in tokens.css does the actual work, and this module exists only to feed it
 * one attribute. That division matters: because the stylesheet handles the system
 * preference on its own, a cold load paints the right theme before any of this code runs,
 * and there is no frame of white on a dark-mode machine.
 */

/**
 * ThemeName is the user's stated preference, which is not the same thing as the theme
 * they end up seeing. 'system' means "whatever the OS says, now and later", and it is a
 * standing instruction rather than a value — which is why it has to survive as its own
 * case all the way to the point where the attribute is written.
 */
export type ThemeName = 'light' | 'dark' | 'system';

/**
 * ResolvedTheme is what is actually on screen once 'system' has been asked. Code that
 * needs to know the current appearance — picking a chart palette, colouring a native
 * scrollbar, choosing a favicon — wants this type, never ThemeName.
 */
export type ResolvedTheme = Exclude<ThemeName, 'system'>;

/**
 * THEME_STORAGE_KEY is namespaced because localStorage is shared across everything served
 * from the origin, and an unprefixed 'theme' is the single most likely key to collide
 * with a docs site or a marketing page on the same domain.
 */
export const THEME_STORAGE_KEY = 'polaris.theme';

const THEME_ATTRIBUTE = 'data-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Where the platform cannot answer — server rendering, a worker, a test — the answer is
 * dark, because that is what this product's users run it in. Guessing light and being
 * wrong costs a visible flash on the majority of loads; guessing dark and being wrong
 * costs it on the minority.
 */
const FALLBACK_RESOLVED: ResolvedTheme = 'dark';

function isThemeName(value: unknown): value is ThemeName {
  return value === 'light' || value === 'dark' || value === 'system';
}

/**
 * Reading a media query has to be feature-detected rather than assumed. This module is
 * imported by the app entry point, so it is evaluated in every environment the bundle
 * ends up in, including ones with no window at all.
 */
function darkMediaQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null;
  }
  return window.matchMedia(DARK_QUERY);
}

/**
 * Every touch of localStorage is wrapped, and the wrapping is not defensive habit: the
 * property access itself throws a SecurityError in a sandboxed iframe and in Safari's
 * private mode, before any method is called. A theme preference is never worth failing
 * boot over, so both failures degrade to "no preference stored".
 */
function readStoredValue(): string | null {
  try {
    return globalThis.localStorage?.getItem(THEME_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeStoredValue(theme: ThemeName): void {
  try {
    globalThis.localStorage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The preference is lost at the next reload. The session keeps working, which is the
    // trade being made here.
  }
}

/**
 * getStoredTheme reads the saved preference, and treats absent, unreadable and corrupt
 * storage as the same answer: 'system'.
 *
 * Collapsing those three cases is deliberate. A value that is not one of the three names
 * came from an older build, a hand-edited devtools session or another product on the
 * origin, and none of those is a preference worth honouring — falling back to 'system'
 * puts the user somewhere reasonable instead of somewhere arbitrary.
 */
export function getStoredTheme(): ThemeName {
  const stored = readStoredValue();
  return isThemeName(stored) ? stored : 'system';
}

/**
 * applyTheme puts the preference on the document element and saves it.
 *
 * It does both because splitting them produces exactly two bugs and no benefit: a theme
 * that applies but is forgotten on reload, or one that is remembered but not showing.
 *
 * The 'system' case removes the attribute rather than setting it to 'system'. The
 * stylesheet's system branch is written as `:root:not([data-theme='light'])` inside a
 * prefers-color-scheme query, so absence is what "follow the OS" means to the cascade —
 * an attribute of any value at all would leave the branch unmatched and pin the user to
 * light.
 */
export function applyTheme(theme: ThemeName): void {
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    if (theme === 'system') {
      root.removeAttribute(THEME_ATTRIBUTE);
    } else {
      root.setAttribute(THEME_ATTRIBUTE, theme);
    }
  }
  writeStoredValue(theme);
}

/**
 * resolveTheme answers what the user is actually looking at, by asking the OS only when
 * the preference defers to it.
 *
 * Nothing in the styling layer needs this — the cascade resolves 'system' by itself. It
 * is for the code that cannot: a canvas that must be painted in the right colours, a
 * `theme-color` meta tag, an embedded editor told which palette to load.
 */
export function resolveTheme(theme: ThemeName): ResolvedTheme {
  if (theme !== 'system') {
    return theme;
  }
  const query = darkMediaQuery();
  if (query === null) {
    return FALLBACK_RESOLVED;
  }
  return query.matches ? 'dark' : 'light';
}

/**
 * watchSystemTheme reports OS appearance changes for as long as the returned function has
 * not been called.
 *
 * The callback fires on change only, never on subscribe, so a caller that also needs the
 * current value asks resolveTheme for it — reporting an initial value here would make the
 * hook fire twice on mount for every consumer that does.
 *
 * It subscribes unconditionally rather than only while the preference is 'system',
 * because a user who switches back to 'system' would otherwise need this module to
 * re-subscribe at exactly the right moment; one live listener for the life of the tab is
 * cheaper than that coordination and cannot go stale.
 */
export function watchSystemTheme(callback: (theme: ResolvedTheme) => void): () => void {
  const query = darkMediaQuery();
  if (query === null) {
    return () => {};
  }
  const onChange = (event: MediaQueryListEvent) => {
    callback(event.matches ? 'dark' : 'light');
  };
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
}
