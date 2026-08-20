import { describe, expect, it } from 'vitest';

import { EMPTY_FILTER } from '~/filter';
import { Store } from '~/store/store';
import type { Change, Dashboard, DashboardTile, Entity, Issue, Team } from '~/store/types';

import { andFilters, issueIdsForTile } from './issueIds';

const NOW = '2026-03-01T12:00:00.000Z';
const ACTOR = { type: 'user', id: 'u1' } as const;

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return { v, type, id: entity.id, op: 'upsert', actor: ACTOR, payload: entity };
}

function team(id: string, over: Partial<Team> = {}): Team {
  return {
    id,
    workspaceId: 'w',
    key: id.toUpperCase(),
    name: id,
    timezone: 'UTC',
    private: false,
    estimateScale: 'fibonacci',
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
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function issue(id: string, teamId: string, over: Partial<Issue> = {}): Issue {
  return {
    id,
    workspaceId: 'w',
    teamId,
    number: 1,
    identifier: `ENG-${id}`,
    title: id,
    description: '',
    stateId: 's1',
    priority: 0,
    sortOrder: id,
    dueDateSource: 'manual',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function dash(over: Partial<Dashboard> = {}): Dashboard {
  return {
    id: 'd1',
    workspaceId: 'w',
    name: 'Delivery',
    description: '',
    filter: EMPTY_FILTER,
    sortOrder: 'a0',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function tileRow(over: Partial<DashboardTile> = {}): DashboardTile {
  return {
    id: 'tile1',
    workspaceId: 'w',
    dashboardId: 'd1',
    title: '',
    measure: 'count',
    slice: 'assignee',
    display: 'chart',
    filter: EMPTY_FILTER,
    sortOrder: 'a0',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

describe('issueIdsForTile', () => {
  it('drops private-team issues from a workspace dashboard', () => {
    const store = new Store('w');
    store.applyChanges([
      upsert(1, 'team', team('open', { key: 'ENG', name: 'Eng' })),
      upsert(2, 'team', team('secret', { private: true, key: 'SEC', name: 'Secret' })),
      upsert(3, 'issue', issue('i1', 'open')),
      upsert(4, 'issue', issue('i2', 'secret')),
    ]);
    expect(issueIdsForTile(store, dash(), tileRow())).toEqual(['i1']);
  });

  it('keeps private-team issues on a personal dashboard', () => {
    const store = new Store('w');
    store.applyChanges([
      upsert(1, 'team', team('open', { key: 'ENG', name: 'Eng' })),
      upsert(2, 'team', team('secret', { private: true, key: 'SEC', name: 'Secret' })),
      upsert(3, 'issue', issue('i1', 'open')),
      upsert(4, 'issue', issue('i2', 'secret')),
    ]);
    expect(
      issueIdsForTile(store, dash({ ownerId: 'u1' }), tileRow())
        .slice()
        .sort(),
    ).toEqual(['i1', 'i2']);
  });

  it('scopes a team dashboard to that team', () => {
    const store = new Store('w');
    store.applyChanges([
      upsert(1, 'team', team('open', { key: 'ENG', name: 'Eng' })),
      upsert(2, 'team', team('ops', { key: 'OPS', name: 'Ops' })),
      upsert(3, 'issue', issue('i1', 'open')),
      upsert(4, 'issue', issue('i2', 'ops')),
    ]);
    expect(issueIdsForTile(store, dash({ teamId: 'ops' }), tileRow())).toEqual(['i2']);
  });
});

describe('andFilters', () => {
  it('returns the other side when one filter is empty', () => {
    const clause = { field: 'priority' as const, op: 'eq' as const, values: ['1'] };
    expect(andFilters(EMPTY_FILTER, clause)).toEqual(clause);
  });
});
