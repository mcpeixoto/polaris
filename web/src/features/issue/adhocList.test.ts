import { describe, expect, it } from 'vitest';

import { Store, type Change, type Issue, type Team } from '~/store';

import {
  adhocListPath,
  adhocListTitle,
  issueIdsForAdhocList,
  parseAdhocIdentifiers,
  parseIssueIdentifier,
} from './adhocList';

const AT = '2026-01-01T00:00:00Z';

function upsert(v: number, type: Change['type'], entity: { id: string }): Change {
  return {
    v,
    type,
    id: entity.id,
    op: 'upsert',
    actor: { type: 'system' },
    payload: entity as never,
  };
}

function team(id: string, key: string): Team {
  return {
    id,
    workspaceId: 'w',
    key,
    name: key,
    timezone: 'UTC',
    private: false,
    estimateScale: 'none',
    estimateAllowZero: false,
    estimateExtended: false,
    cyclesEnabled: false,
    cycleDurationWeeks: 1,
    cycleCooldownWeeks: 0,
    cycleStartDay: 'monday',
    cycleUpcomingCount: 2,
    cycleAutoAddStarted: false,
    cycleAutoAddCompleted: false,
    triageEnabled: false,
    triageRequirePriority: false,
    autoCloseDays: 0,
    autoArchiveDays: 0,
    autoCloseParent: false,
    autoCloseChildren: false,
    createdAt: AT,
    updatedAt: AT,
  };
}

function issue(id: string, teamId: string, number: number, identifier: string): Issue {
  return {
    id,
    workspaceId: 'w',
    teamId,
    number,
    identifier,
    title: id,
    description: '',
    stateId: 's1',
    priority: 0,
    sortOrder: 'a0',
    dueDateSource: 'manual',
    createdAt: AT,
    updatedAt: AT,
  };
}

function seeded(rows: Change[]): Store {
  const store = new Store('w');
  store.applyChanges(rows);
  return store;
}

describe('parseIssueIdentifier', () => {
  it('splits a team key and a number on the last hyphen', () => {
    expect(parseIssueIdentifier('ENG-123')).toEqual({ key: 'ENG', number: 123 });
    expect(parseIssueIdentifier(' eng-7 ')).toEqual({ key: 'ENG', number: 7 });
    expect(parseIssueIdentifier('PLAT-1')).toEqual({ key: 'PLAT', number: 1 });
  });

  it('rejects tokens that are not identifiers', () => {
    expect(parseIssueIdentifier('')).toBeNull();
    expect(parseIssueIdentifier('ENG')).toBeNull();
    expect(parseIssueIdentifier('-1')).toBeNull();
    expect(parseIssueIdentifier('ENG-')).toBeNull();
    expect(parseIssueIdentifier('ENG-0')).toBeNull();
    expect(parseIssueIdentifier('ENG-1a')).toBeNull();
    expect(parseIssueIdentifier('en_g-1')).toBeNull();
  });
});

describe('parseAdhocIdentifiers', () => {
  it('keeps URL order, drops junk, and dedupes', () => {
    expect(parseAdhocIdentifiers('ENG-2,ENG-1,not-an-id,eng-2, ENG-3')).toEqual([
      'ENG-2',
      'ENG-1',
      'ENG-3',
    ]);
  });

  it('is empty when nothing in the path is an identifier', () => {
    expect(parseAdhocIdentifiers('')).toEqual([]);
    expect(parseAdhocIdentifiers('review,please')).toEqual([]);
  });
});

describe('issueIdsForAdhocList', () => {
  it('resolves current identifiers and skips missing ones', () => {
    const store = seeded([
      upsert(1, 'team', team('t1', 'ENG')),
      upsert(2, 'team', team('t2', 'PLAT')),
      upsert(3, 'issue', issue('i1', 't1', 1, 'ENG-1')),
      upsert(4, 'issue', issue('i2', 't1', 2, 'ENG-2')),
      upsert(5, 'issue', issue('i3', 't2', 1, 'PLAT-1')),
    ]);
    expect(issueIdsForAdhocList(store, ['ENG-2', 'MISSING-9', 'PLAT-1', 'ENG-2'])).toEqual([
      'i2',
      'i3',
    ]);
  });

  it('follows a renamed team key rather than a cached identifier', () => {
    const store = seeded([
      upsert(1, 'team', team('t1', 'PLAT')),
      upsert(2, 'issue', issue('i1', 't1', 1, 'ENG-1')),
    ]);
    expect(issueIdsForAdhocList(store, ['ENG-1'])).toEqual([]);
    expect(issueIdsForAdhocList(store, ['PLAT-1'])).toEqual(['i1']);
  });
});

describe('adhocListPath and title', () => {
  it('builds the shareable path from identifiers', () => {
    expect(adhocListPath(['ENG-1', 'ENG-2'])).toBe('/issues/ENG-1,ENG-2');
  });

  it('names a short list by its identifiers and a long one by count', () => {
    expect(adhocListTitle([])).toBe('Issues');
    expect(adhocListTitle(['ENG-1', 'ENG-2'])).toBe('ENG-1, ENG-2');
    expect(adhocListTitle(['A-1', 'A-2', 'A-3', 'A-4', 'A-5'])).toBe('5 issues');
  });
});
