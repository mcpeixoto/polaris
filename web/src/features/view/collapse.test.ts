import { afterEach, describe, expect, it, vi } from 'vitest';

import { collapseStorageKey, readCollapsed, writeCollapsed } from './collapse';

/**
 * The contract these three carry is narrow and entirely about failure: a screen must render
 * when storage is unreadable, and a screen with no preference key must not borrow another
 * one's folds. Both are silent when broken, so both are asserted here.
 */

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('group collapse persistence', () => {
  it('keys each screen separately and forgets a screen with no key', () => {
    expect(collapseStorageKey('team:ENG')).toBe('polaris.collapsedGroups:team:ENG');
    expect(collapseStorageKey(undefined)).toBeNull();

    writeCollapsed('team:ENG', new Set(['done']));
    expect([...readCollapsed('team:ENG')]).toEqual(['done']);
    expect([...readCollapsed('my-issues')]).toEqual([]);

    writeCollapsed(undefined, new Set(['done']));
    expect([...readCollapsed(undefined)]).toEqual([]);
  });

  it('removes the row rather than storing an empty set', () => {
    writeCollapsed('team:ENG', new Set(['done']));
    writeCollapsed('team:ENG', new Set());
    expect(window.localStorage.getItem('polaris.collapsedGroups:team:ENG')).toBeNull();
  });

  it('reads nothing rather than throwing when the stored value is not a list of keys', () => {
    window.localStorage.setItem('polaris.collapsedGroups:team:ENG', '{"done":true}');
    expect([...readCollapsed('team:ENG')]).toEqual([]);

    window.localStorage.setItem('polaris.collapsedGroups:team:ENG', 'not json');
    expect([...readCollapsed('team:ENG')]).toEqual([]);
  });

  it('survives storage that refuses to answer at all', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });

    expect([...readCollapsed('team:ENG')]).toEqual([]);
    expect(() => writeCollapsed('team:ENG', new Set(['done']))).not.toThrow();
  });
});
