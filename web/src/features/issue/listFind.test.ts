import { describe, expect, it } from 'vitest';

import { Store, type Change, type Entity } from '~/store';

import { listFindHits } from './listFind';

const WORKSPACE = 'workspace-1';
const TEAM = 'team-1';
const STATE = 'state-1';
const AT = '2026-01-01T00:00:00.000Z';

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const rows: [string, Entity][] = [
    [
      'team',
      {
        id: TEAM,
        workspaceId: WORKSPACE,
        key: 'ENG',
        name: 'Engineering',
        timezone: 'UTC',
        private: false,
        estimateScale: 'none',
        estimateAllowZero: false,
        estimateExtended: false,
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    ],
    [
      'workflowState',
      {
        id: STATE,
        workspaceId: WORKSPACE,
        teamId: TEAM,
        name: 'Todo',
        category: 'unstarted',
        position: 'a',
        isSystem: false,
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    ],
    [
      'issue',
      {
        id: 'issue-1',
        workspaceId: WORKSPACE,
        teamId: TEAM,
        number: 1,
        title: 'Fix the login flake',
        description: '',
        priority: 0,
        stateId: STATE,
        dueDateSource: 'manual',
        sortOrder: 'a',
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    ],
    [
      'issue',
      {
        id: 'issue-2',
        workspaceId: WORKSPACE,
        teamId: TEAM,
        number: 2,
        title: 'Ship the importer',
        description: '',
        priority: 0,
        stateId: STATE,
        dueDateSource: 'manual',
        sortOrder: 'b',
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    ],
  ];
  store.applyChanges(
    rows.map(([type, payload], index) => ({
      v: index + 1,
      type,
      id: (payload as { id: string }).id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload,
    })) as Change[],
  );
  return store;
}

describe('listFindHits', () => {
  it('returns null for a blank query so the list is unfiltered', () => {
    const store = seeded();
    const corpus = new Set<string>(['issue-1', 'issue-2']);
    expect(listFindHits(store, corpus, '')).toBeNull();
    expect(listFindHits(store, corpus, '   ')).toBeNull();
  });

  it('matches a title substring via the trigram index', () => {
    const store = seeded();
    const corpus = new Set<string>(['issue-1', 'issue-2']);
    expect([...listFindHits(store, corpus, 'login')!]).toEqual(['issue-1']);
    expect([...listFindHits(store, corpus, 'importer')!]).toEqual(['issue-2']);
  });

  it('matches an issue identifier, case-insensitively', () => {
    const store = seeded();
    const corpus = new Set<string>(['issue-1', 'issue-2']);
    expect([...listFindHits(store, corpus, 'eng-2')!]).toEqual(['issue-2']);
    expect([...listFindHits(store, corpus, 'ENG-1')!]).toEqual(['issue-1']);
  });

  it('stays inside the corpus even when the title index has wider hits', () => {
    const store = seeded();
    // Only issue-2 is on this list; a title hit for "the" would otherwise pull both.
    const corpus = new Set<string>(['issue-2']);
    expect([...listFindHits(store, corpus, 'the')!]).toEqual(['issue-2']);
  });
});
