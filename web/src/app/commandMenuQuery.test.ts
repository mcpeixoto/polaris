import { describe, expect, it } from 'vitest';

import type { Action } from '~/keys';
import { Store, type Change, type Entity } from '~/store';

import { matchIssues, matchUsers, parseCommandQuery, rankActions } from './commandMenuQuery';

const AT = '2026-08-20T12:00:00.000Z';

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

describe('parseCommandQuery', () => {
  it('treats > as commands, # as issues, @ as people', () => {
    expect(parseCommandQuery('>create')).toEqual({ scope: 'command', needle: 'create' });
    expect(parseCommandQuery('#ENG-1')).toEqual({ scope: 'issue', needle: 'ENG-1' });
    expect(parseCommandQuery('@ada')).toEqual({ scope: 'user', needle: 'ada' });
    expect(parseCommandQuery('archive')).toEqual({ scope: 'mixed', needle: 'archive' });
  });
});

describe('rankActions', () => {
  const actions = [
    { id: 'a', title: 'Create issue', group: 'Issues' },
    { id: 'b', title: 'Archive issue', group: 'Issues' },
  ] as Action[];

  it('prefers a word-start match', () => {
    const ranked = rankActions(actions, 'cri');
    expect(ranked[0]?.title).toBe('Create issue');
  });
});

describe('matchIssues', () => {
  it('finds an issue by identifier or title and skips archived rows', () => {
    const store = new Store('w1');
    store.applyChanges([
      upsert(1, 'team', {
        id: 't1',
        workspaceId: 'w1',
        key: 'ENG',
        name: 'Eng',
        timezone: 'UTC',
        private: false,
        estimateScale: 'exponential',
        issueLimit: 60000,
        triageEnabled: false,
        triageRequirePriority: false,
        autoCloseDays: 0,
        autoArchiveDays: 0,
        createdAt: AT,
        updatedAt: AT,
      } as Entity),
      upsert(2, 'issue', {
        id: 'i1',
        workspaceId: 'w1',
        teamId: 't1',
        number: 1,
        identifier: 'ENG-1',
        title: 'Login redirect',
        description: '',
        stateId: 's1',
        priority: 0,
        sortOrder: 'a0',
        dueDateSource: 'manual',
        createdAt: AT,
        updatedAt: AT,
      } as Entity),
      upsert(3, 'issue', {
        id: 'i2',
        workspaceId: 'w1',
        teamId: 't1',
        number: 2,
        identifier: 'ENG-2',
        title: 'Archived',
        description: '',
        stateId: 's1',
        priority: 0,
        sortOrder: 'a1',
        dueDateSource: 'manual',
        archivedAt: AT,
        createdAt: AT,
        updatedAt: AT,
      } as Entity),
    ]);

    const byId = matchIssues(store, 'ENG-1');
    expect(byId.map((hit) => hit.id)).toEqual(['i1']);
    expect(byId[0]?.href).toBe('/issue/ENG-1');

    const byTitle = matchIssues(store, 'login');
    expect(byTitle.map((hit) => hit.id)).toEqual(['i1']);
    expect(matchIssues(store, 'Archived').map((hit) => hit.id)).toEqual([]);
  });
});

describe('matchUsers', () => {
  it('matches people and ignores agents', () => {
    const store = new Store('w1');
    store.applyChanges([
      upsert(1, 'user', {
        id: 'u1',
        workspaceId: 'w1',
        name: 'Ada Lovelace',
        displayName: 'Ada',
        timezone: 'UTC',
        role: 'member',
        status: 'active',
        kind: 'human',
        createdAt: AT,
        updatedAt: AT,
      } as Entity),
      upsert(2, 'user', {
        id: 'bot',
        workspaceId: 'w1',
        name: 'Polaris Agent',
        displayName: 'Agent',
        timezone: 'UTC',
        role: 'member',
        status: 'active',
        kind: 'app',
        createdAt: AT,
        updatedAt: AT,
      } as Entity),
    ]);
    expect(matchUsers(store, 'ada').map((hit) => hit.id)).toEqual(['u1']);
    expect(matchUsers(store, 'agent').map((hit) => hit.id)).toEqual([]);
  });
});
