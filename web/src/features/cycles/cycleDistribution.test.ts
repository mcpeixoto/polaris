import { describe, expect, it } from 'vitest';

import {
  Store,
  type Change,
  type Cycle,
  type Issue,
  type Team,
  type User,
  type WorkflowState,
} from '~/store';

import { cycleMemberShares } from './cycleDistribution';

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

function team(): Team {
  return {
    id: 't1',
    workspaceId: 'w',
    key: 'ENG',
    name: 'Engineering',
    timezone: 'UTC',
    private: false,
    estimateScale: 'none',
    estimateAllowZero: false,
    estimateExtended: false,
    cyclesEnabled: true,
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

function user(id: string, displayName: string): User {
  return {
    id,
    workspaceId: 'w',
    name: displayName,
    displayName,
    timezone: 'UTC',
    role: 'member',
    status: 'active',
    kind: 'human',
    createdAt: AT,
    updatedAt: AT,
  };
}

function state(id: string, category: WorkflowState['category']): WorkflowState {
  return {
    id,
    workspaceId: 'w',
    teamId: 't1',
    name: id,
    color: '#5e6ad2',
    category,
    position: 'a0',
    isDefault: false,
    isSystem: false,
    createdAt: AT,
    updatedAt: AT,
  };
}

function cycle(): Cycle {
  return {
    id: 'c1',
    workspaceId: 'w',
    teamId: 't1',
    number: 1,
    name: 'Cycle 1',
    startsAt: AT,
    endsAt: '2026-01-15T00:00:00Z',
    createdAt: AT,
    updatedAt: AT,
  };
}

function issue(id: string, over: Partial<Issue> = {}): Issue {
  return {
    id,
    workspaceId: 'w',
    teamId: 't1',
    number: 1,
    identifier: 'ENG-1',
    title: id,
    description: '',
    stateId: 'todo',
    priority: 0,
    sortOrder: 'a0',
    dueDateSource: 'manual',
    cycleId: 'c1',
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

describe('cycleMemberShares', () => {
  it('groups live cycle issues by assignee, with unassigned last', () => {
    const store = new Store('w');
    store.applyChanges([
      upsert(1, 'team', team()),
      upsert(2, 'user', user('ada', 'Ada')),
      upsert(3, 'workflowState', state('todo', 'unstarted')),
      upsert(4, 'workflowState', state('done', 'completed')),
      upsert(5, 'cycle', cycle()),
      upsert(6, 'issue', issue('a1', { assigneeId: 'ada' })),
      upsert(7, 'issue', issue('a2', { assigneeId: 'ada', stateId: 'done' })),
      upsert(8, 'issue', issue('u1')),
    ]);

    const rows = cycleMemberShares(store, 'c1');
    expect(rows.map((row) => row.userId)).toEqual(['ada', null]);
    expect(rows[0]).toMatchObject({ name: 'Ada', issueCount: 2, completed: 1 });
    expect(rows[1]).toMatchObject({ name: 'Unassigned', issueCount: 1, completed: 0 });
  });
});
