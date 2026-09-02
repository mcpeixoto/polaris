import { describe, expect, it } from 'vitest';

import type { Action } from '~/keys';
import { Store, type Change, type Entity } from '~/store';

import { buildIssueIndex, rankActions, searchIssueIndex } from './commandMenuQuery';
import { NO_RECENTS, record } from './commandMenuRecents';

/**
 * Two changes with one thing in common: they are both about what the palette does when
 * nothing has been typed yet, and about the work it must not repeat once something has.
 */

const AT = '2026-08-20T12:00:00.000Z';
const NOW = 1_700_000_000_000;

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return {
    v,
    type,
    id: entity.id,
    op: 'upsert',
    actor: { type: 'user', id: 'u1' },
    payload: entity,
  };
}

const actions = [
  { id: 'a', title: 'Create issue', group: 'Issues' },
  { id: 'b', title: 'Archive issue', group: 'Issues' },
  { id: 'c', title: 'Change status', group: 'Issues' },
] as Action[];

describe('rankActions with a history', () => {
  it('opens on what this person runs, not on registration order', () => {
    const recents = record(NO_RECENTS, 'c', NOW);

    expect(rankActions(actions, '', recents, NOW)[0]?.id).toBe('c');
    // And without a history it is still whatever it was handed, unchanged.
    expect(rankActions(actions, '').map((action) => action.id)).toEqual(['a', 'b', 'c']);
  });

  it('breaks a tie by history without overruling a better match', () => {
    // "Archive issue" has never been run; "Create issue" is the one this person uses. Both
    // match "issue" equally, so history decides.
    const recents = record(NO_RECENTS, 'a', NOW);
    expect(rankActions(actions, 'issue', recents, NOW)[0]?.id).toBe('a');

    // But a history on a worse match must not float it above a better one: "cre" is a
    // word-start match for "Create issue" and barely matches "Change status" at all.
    const biased = record(record(NO_RECENTS, 'c', NOW), 'c', NOW);
    expect(rankActions(actions, 'cre', biased, NOW)[0]?.id).toBe('a');
  });
});

describe('the issue index', () => {
  function storeWithIssues(): Store {
    const store = new Store('w1');
    store.applyChanges([
      upsert(1, 'team', {
        id: 't1',
        key: 'ENG',
        name: 'Engineering',
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity),
      upsert(2, 'issue', {
        id: 'i1',
        teamId: 't1',
        number: 1,
        title: 'Fix the parser',
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity),
      upsert(3, 'issue', {
        id: 'i2',
        teamId: 't1',
        number: 2,
        title: 'Gone',
        archivedAt: AT,
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity),
    ]);
    return store;
  }

  it('leaves archived issues out, so a search cannot surface one', () => {
    const index = buildIssueIndex(storeWithIssues());

    expect(index.map((entry) => entry.identifier)).toEqual(['ENG-1']);
  });

  it('resolves each identifier once rather than once per keystroke', () => {
    const store = storeWithIssues();
    const index = buildIssueIndex(store);

    // The whole point of the index: the same one answers every needle, and the expensive
    // half — the identifier and the lowercasing — happened before any of them.
    expect(searchIssueIndex(index, 'parser')[0]?.hint).toBe('ENG-1');
    expect(searchIssueIndex(index, 'ENG-1')[0]?.hint).toBe('ENG-1');
    expect(searchIssueIndex(index, 'zzz')).toEqual([]);
  });

  it('puts an exact identifier first, ahead of a title that merely matches', () => {
    const index = buildIssueIndex(storeWithIssues());

    expect(searchIssueIndex(index, 'eng-1')[0]?.href).toBe('/issue/ENG-1');
  });
});
