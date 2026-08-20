import { describe, expect, it } from 'vitest';

import { Store } from '~/store/store';
import type {
  Change,
  Cycle,
  Entity,
  Issue,
  Team,
  TeamMembership,
  WorkflowState,
} from '~/store/types';

import { cycleCapacity } from './computeCapacity';

const NOW = '2026-02-01T12:00:00.000Z';
const ACTOR = { type: 'user', id: 'u1' } as const;

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return { v, type, id: entity.id, op: 'upsert', actor: ACTOR, payload: entity };
}

function teamRow(): Team {
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

function cycleRow(id: string, number: number, startsAt: string, endsAt: string): Cycle {
  return {
    id,
    workspaceId: 'w',
    teamId: 't1',
    number,
    name: `Cycle ${number}`,
    startsAt,
    endsAt,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function membership(id: string, userId: string): TeamMembership {
  return {
    id,
    workspaceId: 'w',
    teamId: 't1',
    userId,
    role: 'member',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function todo(): WorkflowState {
  return {
    id: 's1',
    workspaceId: 'w',
    teamId: 't1',
    name: 'Todo',
    color: '#888',
    category: 'unstarted',
    position: 'a',
    isDefault: true,
    isSystem: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function done(): WorkflowState {
  return {
    ...todo(),
    id: 's2',
    name: 'Done',
    category: 'completed',
    position: 'b',
    isDefault: false,
    isSystem: true,
  };
}

function issue(id: string, cycleId: string, completed: boolean): Issue {
  return {
    id,
    workspaceId: 'w',
    teamId: 't1',
    number: Number(id.slice(1)),
    identifier: `ENG-${id.slice(1)}`,
    title: id,
    description: '',
    stateId: completed ? 's2' : 's1',
    priority: 3,
    sortOrder: id,
    dueDateSource: 'manual',
    cycleId,
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: NOW,
    ...(completed ? { completedAt: '2026-01-10T00:00:00.000Z' } : null),
  };
}

describe('cycleCapacity', () => {
  it('averages completed work from the previous three cycles', () => {
    const store = new Store('w');
    store.applyChanges([
      upsert(1, 'team', teamRow()),
      upsert(2, 'workflowState', todo()),
      upsert(3, 'workflowState', done()),
      upsert(
        4,
        'cycle',
        cycleRow('past1', 1, '2026-01-01T00:00:00.000Z', '2026-01-14T23:59:59.999Z'),
      ),
      upsert(
        5,
        'cycle',
        cycleRow('past2', 2, '2025-12-18T00:00:00.000Z', '2025-12-31T23:59:59.999Z'),
      ),
      upsert(
        6,
        'cycle',
        cycleRow('next', 3, '2026-02-02T00:00:00.000Z', '2026-02-15T23:59:59.999Z'),
      ),
      upsert(7, 'issue', issue('i1', 'past1', true)),
      upsert(8, 'issue', issue('i2', 'past1', true)),
      upsert(9, 'issue', issue('i3', 'past2', true)),
      upsert(10, 'issue', issue('i4', 'next', false)),
      upsert(11, 'issue', issue('i5', 'next', false)),
    ]);

    const now = Date.parse('2026-02-01T12:00:00.000Z');
    const data = cycleCapacity(store, 'next', now);
    expect(data).not.toBeNull();
    expect(data!.source).toBe('velocity');
    expect(data!.cyclesSampled).toBe(2);
    expect(data!.capacity).toBe(2);
    expect(data!.scoped).toBe(2);
    expect(data!.percent).toBe(100);
  });

  it('falls back to member count when nothing has completed yet', () => {
    const store = new Store('w');
    store.applyChanges([
      upsert(1, 'team', teamRow()),
      upsert(2, 'workflowState', todo()),
      upsert(
        3,
        'cycle',
        cycleRow('next', 1, '2026-02-02T00:00:00.000Z', '2026-02-15T23:59:59.999Z'),
      ),
      upsert(4, 'teamMembership', membership('m1', 'u1')),
      upsert(5, 'teamMembership', membership('m2', 'u2')),
      upsert(6, 'issue', issue('i1', 'next', false)),
    ]);

    const data = cycleCapacity(store, 'next', Date.parse(NOW));
    expect(data!.source).toBe('members');
    expect(data!.capacity).toBe(2 * 2 * 5);
    expect(data!.scoped).toBe(1);
    expect(data!.percent).toBe(5);
  });
});
