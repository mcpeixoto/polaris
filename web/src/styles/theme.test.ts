/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyTheme,
  getStoredTheme,
  resolveTheme,
  watchSystemTheme,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemeName,
} from './theme';

const THEME_ATTRIBUTE = 'data-theme';

type ChangeListener = (event: MediaQueryListEvent) => void;

/**
 * jsdom implements matchMedia but never evaluates prefers-color-scheme and never dispatches
 * a change, so both halves of the system-preference behaviour have to be driven by hand.
 */
function stubMatchMedia(prefersDark: boolean) {
  const listeners = new Set<ChangeListener>();
  const query = {
    matches: prefersDark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_type: string, listener: ChangeListener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: ChangeListener) => {
      listeners.delete(listener);
    },
  };
  vi.stubGlobal('matchMedia', () => query);
  return {
    emit(dark: boolean) {
      query.matches = dark;
      for (const listener of [...listeners]) {
        listener({ matches: dark } as MediaQueryListEvent);
      }
    },
    listenerCount: () => listeners.size,
  };
}

/**
 * Storage is supplied rather than borrowed. Recent Node versions install a global
 * `localStorage` of their own that wins over jsdom's, so the ambient one is not reliably a
 * Storage at all — and a theme test failing because of which global won is a test that
 * teaches nobody anything.
 */
function memoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length(): number {
      return entries.size;
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, String(value));
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
    clear: () => {
      entries.clear();
    },
  };
}

/** Storage as a sandboxed iframe presents it: every access is a SecurityError. */
function insecureStorage(): Storage {
  const refuse = (): never => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  return {
    get length(): number {
      return refuse();
    },
    key: refuse,
    getItem: refuse,
    setItem: refuse,
    removeItem: refuse,
    clear: refuse,
  };
}

let store: Storage;

beforeEach(() => {
  document.documentElement.removeAttribute(THEME_ATTRIBUTE);
  store = memoryStorage();
  vi.stubGlobal('localStorage', store);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('storage round trip', () => {
  const preferences: ThemeName[] = ['light', 'dark', 'system'];

  it.each(preferences)('survives a reload for %s', (theme) => {
    applyTheme(theme);

    expect(
      getStoredTheme(),
      'a preference that is applied but not persisted reverts on the next reload',
    ).toBe(theme);
  });

  it('writes the raw name under the namespaced key', () => {
    applyTheme('light');

    expect(
      store.getItem(THEME_STORAGE_KEY),
      'the stored value must stay a bare theme name — anything richer is a migration nobody scheduled',
    ).toBe('light');
  });
});

describe('applying a preference to the document', () => {
  it('sets the attribute for an explicit choice', () => {
    applyTheme('dark');

    expect(
      document.documentElement.getAttribute(THEME_ATTRIBUTE),
      'an explicit choice must win over the system preference, and the attribute is the only thing that does that',
    ).toBe('dark');
  });

  it('removes the attribute for system rather than setting it', () => {
    applyTheme('dark');
    applyTheme('system');

    expect(
      document.documentElement.hasAttribute(THEME_ATTRIBUTE),
      "the cascade reads absence as 'follow the OS'; any value here pins the user to light on a dark machine",
    ).toBe(false);
  });

  it('switches directly between the two explicit themes', () => {
    applyTheme('dark');
    applyTheme('light');

    expect(
      document.documentElement.getAttribute(THEME_ATTRIBUTE),
      'a stale attribute would leave the page dark while the preference reads light',
    ).toBe('light');
  });
});

describe('reading a stored preference', () => {
  const corrupt: Array<[name: string, stored: string]> = [
    ['an empty string', ''],
    ['the wrong case', 'DARK'],
    ['a theme that never existed', 'midnight'],
    ['a JSON-wrapped value from an older build', '{"theme":"dark"}'],
    ['a serialised null', 'null'],
    ['a name with stray whitespace', ' dark '],
  ];

  it('returns system when nothing has ever been stored', () => {
    expect(
      getStoredTheme(),
      'a first-time visitor has no preference, and inventing one for them is worse than deferring to the OS',
    ).toBe('system');
  });

  it.each(corrupt)('falls back to system for %s', (_name, stored) => {
    store.setItem(THEME_STORAGE_KEY, stored);

    expect(
      getStoredTheme(),
      'an unrecognised stored value must NOT be trusted through to the attribute — it would pin the user to a theme that does not exist',
    ).toBe('system');
  });

  it.each(['light', 'dark', 'system'] as const)(
    'returns %s unchanged when it is valid',
    (stored) => {
      store.setItem(THEME_STORAGE_KEY, stored);

      expect(getStoredTheme(), 'a valid stored preference must be honoured verbatim').toBe(stored);
    },
  );
});

describe('storage that refuses to work', () => {
  it('reads through a sandboxed iframe without throwing', () => {
    vi.stubGlobal('localStorage', insecureStorage());

    expect(
      getStoredTheme(),
      'localStorage throws outright in a sandboxed iframe and in Safari private mode; a theme preference must never take boot down with it',
    ).toBe('system');
  });

  it('still applies the theme when the write fails', () => {
    vi.stubGlobal('localStorage', insecureStorage());

    expect(() => applyTheme('dark')).not.toThrow();
    expect(
      document.documentElement.getAttribute(THEME_ATTRIBUTE),
      'an unwritable preference must still take effect for this session — losing it on reload is the whole cost, and it is the acceptable one',
    ).toBe('dark');
  });

  it('survives storage being absent altogether', () => {
    vi.stubGlobal('localStorage', undefined);

    expect(getStoredTheme()).toBe('system');
    expect(() => applyTheme('light')).not.toThrow();
  });
});

describe('resolving a preference to an appearance', () => {
  const cases: Array<[preference: ThemeName, prefersDark: boolean, want: ResolvedTheme]> = [
    ['light', true, 'light'],
    ['light', false, 'light'],
    ['dark', true, 'dark'],
    ['dark', false, 'dark'],
    ['system', true, 'dark'],
    ['system', false, 'light'],
  ];

  it.each(cases)('resolves %s with prefers-dark=%s to %s', (preference, prefersDark, want) => {
    stubMatchMedia(prefersDark);

    expect(
      resolveTheme(preference),
      'an explicit preference must ignore the OS entirely, and system must do exactly the opposite',
    ).toBe(want);
  });

  it('falls back to dark where the platform cannot be asked', () => {
    vi.stubGlobal('matchMedia', undefined);

    expect(
      resolveTheme('system'),
      'server rendering and workers have no media queries; guessing light there flashes white on the machines most of this product runs on',
    ).toBe('dark');
  });
});

describe('watching the system preference', () => {
  it('reports a change and nothing before it', () => {
    const media = stubMatchMedia(false);
    const seen: ResolvedTheme[] = [];

    watchSystemTheme((theme) => seen.push(theme));

    expect(seen, 'firing on subscribe makes every consuming hook render twice on mount').toEqual(
      [],
    );

    media.emit(true);
    media.emit(false);

    expect(seen, 'a change to the OS appearance must reach the subscriber in order').toEqual([
      'dark',
      'light',
    ]);
  });

  it('stops reporting once unsubscribed', () => {
    const media = stubMatchMedia(false);
    const seen: ResolvedTheme[] = [];

    const unsubscribe = watchSystemTheme((theme) => seen.push(theme));
    unsubscribe();
    media.emit(true);

    expect(
      media.listenerCount(),
      'a listener left attached outlives the component that made it and keeps the closure alive for the life of the tab',
    ).toBe(0);
    expect(seen, 'an unsubscribed watcher must NOT be called again').toEqual([]);
  });

  it('returns a callable unsubscribe where there is no matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);

    const unsubscribe = watchSystemTheme(() => {});

    expect(
      () => unsubscribe(),
      'callers clean up in an effect teardown and cannot be asked to check whether subscribing worked',
    ).not.toThrow();
  });
});
