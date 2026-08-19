import { describe, expect, it } from 'vitest';

import { Store } from '~/store/store';
import type { Change, Cycle, Entity, Issue, Team, WorkflowState } from '~/store/types';

import { buildCycleGraph } from './computeCycleGraph';

const NOW = '2026-01-10T12:00:00.000Z';
const ACTOR = { type: 'user', id: 'u1' } as const;

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return { v, type, id: entity.id, op: 'upsert', actor: ACTOR, payload: entity };
}

function team(id: string): Team {
  return {
    id,
    workspaceId: 'w',
    key: 'ENG',
    name: 'Engineering',
    timezone: 'UTC',
    private: false,
    estimateScale: 'none',
    estimateAllowZero: false,
    estimateExtended: false,
    cyclesEnabled: true,
    cycleDurationWeeks: 2,
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
  };
}

describe('buildCycleGraph', () => {
  it('builds scope and completed series for a cycle', () => {
    const store = new Store('w');
    const teamId = 't1';
    const cycleId = 'cy1';

    const todo: WorkflowState = {
      id: 's1',
      workspaceId: 'w',
      teamId,
      name: 'Todo',
      color: '#888',
      category: 'unstarted',
      position: 'a',
      isDefault: true,
      isSystem: false,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const done: WorkflowState = {
      id: 's2',
      workspaceId: 'w',
      teamId,
      name: 'Done',
      color: '#0a0',
      category: 'completed',
      position: 'b',
      isDefault: false,
      isSystem: true,
      createdAt: NOW,
      updatedAt: NOW,
    };

    const cycle: Cycle = {
      id: cycleId,
      workspaceId: 'w',
      teamId,
      number: 1,
      name: 'Cycle 1',
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: '2026-01-14T23:59:59.999Z',
      createdAt: NOW,
      updatedAt: NOW,
    };

    const issue = (id: string, completedAt?: string): Issue => ({
      id,
      workspaceId: 'w',
      teamId,
      number: Number(id.slice(1)),
      identifier: `ENG-${id.slice(1)}`,
      title: id,
      description: '',
      stateId: completedAt === undefined ? todo.id : done.id,
      priority: 3,
      sortOrder: id,
      dueDateSource: 'manual',
      cycleId,
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: NOW,
      ...(completedAt === undefined ? null : { completedAt }),
    });

    store.applyChanges([
      upsert(1, 'team', team(teamId)),
      upsert(2, 'workflowState', todo),
      upsert(3, 'workflowState', done),
      upsert(4, 'cycle', cycle),
      upsert(5, 'issue', issue('i1', '2026-01-05T00:00:00.000Z')),
      upsert(6, 'issue', issue('i2')),
    ]);

    const data = buildCycleGraph(store, cycleId);
    expect(data).not.toBeNull();
    expect(data!.points.length).toBeGreaterThan(0);
    expect(data!.totalScope).toBe(2);
    expect(data!.totalCompleted).toBe(1);
    expect(data!.successPercent).toBe(50);
  });
});
