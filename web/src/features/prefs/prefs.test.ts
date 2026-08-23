/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyTheme } from '~/styles/theme';
import { getPrefs, personName, PREFS_STORAGE_KEY, setPrefs } from './prefs';

const memory = new Map<string, string>();

beforeEach(() => {
  memory.clear();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
    },
  });
});

afterEach(() => {
  memory.clear();
  applyTheme('system');
});

describe('preferences', () => {
  it('returns the documented defaults when nothing is stored', () => {
    const prefs = getPrefs();
    expect(prefs.homeView).toBe('team');
    expect(prefs.fullNames).toBe(true);
    expect(prefs.convertEmoticons).toBe(false);
    expect(prefs.commentSubmit).toBe('mod-enter');
    expect(prefs.autoAssignOnCreate).toBe(false);
  });

  it('writes a patch without dropping keys it did not mention', () => {
    setPrefs({ autoAssignOnCreate: true, homeView: 'inbox' });
    setPrefs({ fontSize: 'large' });
    const prefs = getPrefs();
    expect(prefs.autoAssignOnCreate).toBe(true);
    expect(prefs.homeView).toBe('inbox');
    expect(prefs.fontSize).toBe('large');
  });

  // The regression this guards is not subtle in effect and is invisible in a value
  // assertion: `getPrefs` is a `useSyncExternalStore` snapshot, and that hook compares
  // snapshots by reference. A fresh object per call reads as "changed" on every commit, so
  // React re-renders until it throws "Maximum update depth exceeded" — which killed
  // /settings/preferences outright, because a Settings route has no error boundary to
  // catch it. Every field below was already correct while the screen showed nothing.
  it('hands back the same object until something is written', () => {
    expect(getPrefs()).toBe(getPrefs());

    const before = getPrefs();
    setPrefs({ fontSize: 'large' });
    const after = getPrefs();

    expect(after).not.toBe(before);
    expect(after.fontSize).toBe('large');
    expect(getPrefs()).toBe(after);
  });

  it('notices a write it did not make itself', () => {
    const before = getPrefs();
    expect(before.homeView).toBe('team');

    // Another tab, or a test poking storage directly. The snapshot is keyed on what is
    // stored rather than invalidated by `setPrefs`, so this is seen rather than cached over.
    globalThis.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ homeView: 'inbox' }));

    const after = getPrefs();
    expect(after).not.toBe(before);
    expect(after.homeView).toBe('inbox');
  });

  it('names people by the full-names toggle', () => {
    const user = { name: 'ada', displayName: 'Ada Lovelace' };
    expect(personName(user, { ...getPrefs(), fullNames: true })).toBe('Ada Lovelace');
    expect(personName(user, { ...getPrefs(), fullNames: false })).toBe('ada');
  });
});
