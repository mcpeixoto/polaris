import { describe, expect, it } from 'vitest';

import type { Action } from '~/keys';
import { Store, type Change, type Entity } from '~/store';

import {
  matchIssues,
  matchNamedEntities,
  matchUsers,
  parseCommandQuery,
  rankActions,
} from './commandMenuQuery';

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
      } as unknown as Entity),
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
      } as unknown as Entity),
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
      } as unknown as Entity),
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
      } as unknown as Entity),
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
      } as unknown as Entity),
    ]);
    expect(matchUsers(store, 'ada').map((hit) => hit.id)).toEqual(['u1']);
    expect(matchUsers(store, 'agent').map((hit) => hit.id)).toEqual([]);
  });
});

/**
 * The kinds the palette learned after issues and people. The claim is not the ranking — that
 * is `subsequenceScore`, already covered — but that each kind is looked in, routed to the
 * page it actually has, and that a view somebody else made private is not offered.
 */
describe('matchNamedEntities', () => {
  function seeded(): Store {
    const store = new Store('w1');
    store.applyChanges([
      upsert(1, 'projectStatus', {
        id: 'ps1',
        workspaceId: 'w1',
        name: 'In progress',
        color: '#5e6ad2',
        category: 'started',
        position: 'a',
        isDefault: true,
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity),
      upsert(2, 'project', {
        id: 'p1',
        workspaceId: 'w1',
        name: 'Orbital launch',
        description: '',
        color: '#5e6ad2',
        statusId: 'ps1',
        priority: 0,
        sortOrder: 'a',
        updateSchedule: 'never',
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity),
      upsert(3, 'project', {
        id: 'p2',
        workspaceId: 'w1',
        name: 'Orbital archive',
        description: '',
        color: '#5e6ad2',
        statusId: 'ps1',
        priority: 0,
        sortOrder: 'b',
        updateSchedule: 'never',
        archivedAt: AT,
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity),
      upsert(4, 'initiative', {
        id: 'i1',
        workspaceId: 'w1',
        name: 'Orbital programme',
        description: '',
        status: 'active',
        priority: 0,
        sortOrder: 'a',
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity),
      upsert(5, 'document', {
        id: 'd1',
        workspaceId: 'w1',
        title: 'Orbital notes',
        content: '',
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity),
      upsert(6, 'view', {
        id: 'v1',
        workspaceId: 'w1',
        name: 'Orbital work',
        filter: { kind: 'group', op: 'and', children: [] },
        display: {},
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity),
      upsert(7, 'view', {
        id: 'v2',
        workspaceId: 'w1',
        name: 'Orbital private',
        ownerId: 'someone-else',
        filter: { kind: 'group', op: 'and', children: [] },
        display: {},
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity),
    ]);
    return store;
  }

  it('finds one of each kind, under its own heading, at the route it has', () => {
    const sections = matchNamedEntities(seeded(), 'orbital', 'u1');
    expect(sections.map((section) => section.group)).toEqual([
      'Projects',
      'Initiatives',
      'Documents',
      'Views',
    ]);
    const hrefs = sections.flatMap((section) => section.hits.map((hit) => hit.href));
    expect(hrefs).toEqual(['/project/p1', '/initiative/i1', '/document/d1', '/view/v1']);
  });

  it('leaves out what is archived, and a view that belongs to somebody else', () => {
    const titles = matchNamedEntities(seeded(), 'orbital', 'u1').flatMap((section) =>
      section.hits.map((hit) => hit.title),
    );
    expect(titles).not.toContain('Orbital archive');
    expect(titles).not.toContain('Orbital private');
  });

  it('answers nothing where nothing matches', () => {
    expect(matchNamedEntities(seeded(), 'zzz', 'u1')).toEqual([]);
  });
});
