/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyTheme } from '~/styles/theme';
import { getPrefs, personName, setPrefs } from './prefs';

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

  it('names people by the full-names toggle', () => {
    const user = { name: 'ada', displayName: 'Ada Lovelace' };
    expect(personName(user, { ...getPrefs(), fullNames: true })).toBe('Ada Lovelace');
    expect(personName(user, { ...getPrefs(), fullNames: false })).toBe('ada');
  });
});
