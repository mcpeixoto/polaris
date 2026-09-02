import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearRecentSearches,
  readRecentSearches,
  rememberSearch,
  RECENT_SEARCH_LIMIT,
} from './recent';

/**
 * The list is one string in `localStorage`, so what is worth testing is the arithmetic on it:
 * that a refinement collapses into one entry rather than six, that the cap holds, and that a
 * storage which refuses to answer leaves the caller with a list rather than an exception.
 */

const WORKSPACE = 'ws-1';

/**
 * A fresh in-memory storage per test, following `store/journal.test.ts` and
 * `styles/theme.test.ts`. The ambient one is never touched, which is what keeps the teardown
 * honest when a test replaces storage with one that throws.
 */
function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => void values.set(name, value),
    removeItem: (name: string) => void values.delete(name),
    clear: () => values.clear(),
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('recent searches', () => {
  it('remembers what was asked, newest first', () => {
    rememberSearch(WORKSPACE, 'flake');
    rememberSearch(WORKSPACE, 'importer');

    expect(readRecentSearches(WORKSPACE)).toEqual(['importer', 'flake']);
  });

  it('collapses a refinement into the query it grew out of', () => {
    // Every keystroke that settles is a query this screen answered. Recorded verbatim they
    // would fill the whole list with one search spelled six ways.
    for (const asked of ['cus', 'custo', 'customer', 'customer import']) {
      rememberSearch(WORKSPACE, asked);
    }

    expect(readRecentSearches(WORKSPACE)).toEqual(['customer import']);
  });

  it('keeps a genuinely different question beside the last one', () => {
    rememberSearch(WORKSPACE, 'customer import');
    rememberSearch(WORKSPACE, 'login redirect');

    expect(readRecentSearches(WORKSPACE)).toEqual(['login redirect', 'customer import']);
  });

  it('moves a repeated query back to the front rather than listing it twice', () => {
    rememberSearch(WORKSPACE, 'flake');
    rememberSearch(WORKSPACE, 'importer');
    rememberSearch(WORKSPACE, 'flake');

    expect(readRecentSearches(WORKSPACE)).toEqual(['flake', 'importer']);
  });

  it('trims, and ignores a query with nothing in it', () => {
    rememberSearch(WORKSPACE, '  flake  ');
    rememberSearch(WORKSPACE, '   ');

    expect(readRecentSearches(WORKSPACE)).toEqual(['flake']);
  });

  it('stops at the cap', () => {
    // Distinct first characters, so none of them is a prefix of another.
    for (const asked of ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf']) {
      rememberSearch(WORKSPACE, asked);
    }

    const kept = readRecentSearches(WORKSPACE);
    expect(kept).toHaveLength(RECENT_SEARCH_LIMIT);
    expect(kept[0]).toBe('golf');
    expect(kept).not.toContain('alpha');
  });

  it('keeps one workspace out of another', () => {
    rememberSearch(WORKSPACE, 'flake');
    rememberSearch('ws-2', 'importer');

    expect(readRecentSearches(WORKSPACE)).toEqual(['flake']);
    expect(readRecentSearches('ws-2')).toEqual(['importer']);
  });

  it('has nothing to remember without a workspace to key on', () => {
    expect(rememberSearch(null, 'flake')).toEqual([]);
    expect(readRecentSearches(null)).toEqual([]);
  });

  it('forgets everything when asked', () => {
    rememberSearch(WORKSPACE, 'flake');
    clearRecentSearches(WORKSPACE);

    expect(readRecentSearches(WORKSPACE)).toEqual([]);
  });

  it('reads a corrupt value as an absent one', () => {
    localStorage.setItem(`polaris.recentSearches/${WORKSPACE}`, '{ not json');
    expect(readRecentSearches(WORKSPACE)).toEqual([]);

    // A shape from a build that no longer runs is the same answer, and so is a list with
    // something in it that is not a query.
    localStorage.setItem(`polaris.recentSearches/${WORKSPACE}`, '{"queries":["flake"]}');
    expect(readRecentSearches(WORKSPACE)).toEqual([]);
    localStorage.setItem(`polaris.recentSearches/${WORKSPACE}`, '["flake", 7, ""]');
    expect(readRecentSearches(WORKSPACE)).toEqual(['flake']);
  });

  it('survives a storage that refuses to write', () => {
    // Quota, a sandboxed iframe, Safari's private mode. A convenience must never be able to
    // break the screen it is a convenience on.
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', {
      ...storage,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });

    expect(() => rememberSearch(WORKSPACE, 'flake')).not.toThrow();
    // Still right for this render: the write failed, the list handed back did not.
    expect(rememberSearch(WORKSPACE, 'flake')).toEqual(['flake']);
    // And nothing was kept, which is the honest outcome rather than a lie about durability.
    expect(readRecentSearches(WORKSPACE)).toEqual([]);
  });
});
