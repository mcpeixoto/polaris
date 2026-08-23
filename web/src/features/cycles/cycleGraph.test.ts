import { describe, expect, it } from 'vitest';

import { Store } from '~/store/store';
import type { Change, Cycle, Entity, Issue, Team, User, WorkflowState } from '~/store/types';

import { buildCycleGraph } from './computeCycleGraph';

const NOW = '2026-01-10T12:00:00.000Z';
const ACTOR = { type: 'user', id: 'u1' } as const;

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return { v, type, id: entity.id, op: 'upsert', actor: ACTOR, payload: entity };
}

function team(id: string, estimateScale: Team['estimateScale'] = 'none'): Team {
  return {
    id,
    workspaceId: 'w',
    key: 'ENG',
    name: 'Engineering',
    timezone: 'UTC',
    private: false,
    estimateScale,
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

function cycle(id: string, teamId: string): Cycle {
  return {
    id,
    workspaceId: 'w',
    teamId,
    number: 1,
    name: 'Cycle 1',
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: '2026-01-14T23:59:59.999Z',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function state(
  id: string,
  teamId: string,
  category: WorkflowState['category'],
  name: string,
): WorkflowState {
  return {
    id,
    workspaceId: 'w',
    teamId,
    name,
    color: '#888',
    category,
    position: id,
    isDefault: category === 'unstarted',
    isSystem: category === 'completed',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function issue(
  id: string,
  teamId: string,
  cycleId: string,
  stateId: string,
  over: Partial<Issue> = {},
): Issue {
  return {
    id,
    workspaceId: 'w',
    teamId,
    number: Number(id.replace(/\D/g, '') || '1'),
    identifier: `ENG-${id}`,
    title: id,
    description: '',
    stateId,
    priority: 3,
    sortOrder: id,
    dueDateSource: 'manual',
    cycleId,
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: NOW,
    ...over,
  };
}

describe('buildCycleGraph', () => {
  it('builds scope, started, completed and a weekday-flattened target', () => {
    const store = new Store('w');
    const teamId = 't1';
    const cycleId = 'cy1';
    const todo = state('s1', teamId, 'unstarted', 'Todo');
    const started = state('s2', teamId, 'started', 'In Progress');
    const done = state('s3', teamId, 'completed', 'Done');

    store.applyChanges([
      upsert(1, 'team', team(teamId)),
      upsert(2, 'workflowState', todo),
      upsert(3, 'workflowState', started),
      upsert(4, 'workflowState', done),
      upsert(5, 'cycle', cycle(cycleId, teamId)),
      upsert(
        6,
        'issue',
        issue('i1', teamId, cycleId, done.id, { completedAt: '2026-01-05T00:00:00.000Z' }),
      ),
      upsert(
        7,
        'issue',
        issue('i2', teamId, cycleId, started.id, { startedAt: '2026-01-03T00:00:00.000Z' }),
      ),
    ]);

    const data = buildCycleGraph(store, cycleId);
    expect(data).not.toBeNull();
    expect(data!.points.length).toBe(14);
    expect(data!.totalScope).toBe(2);
    expect(data!.totalCompleted).toBe(1);
    expect(data!.totalStarted).toBe(1);
    expect(data!.successPercent).toBe(63);

    const first = data!.points[0]!;
    const last = data!.points[data!.points.length - 1]!;
    expect(first.target).toBeGreaterThan(0);
    expect(last.target).toBe(2);

    const saturday = data!.points.find((point) => point.day === '2026-01-03');
    const friday = data!.points.find((point) => point.day === '2026-01-02');
    expect(saturday).toBeDefined();
    expect(friday).toBeDefined();
    expect(saturday!.target).toBe(friday!.target);

    const jan5 = data!.points.find((point) => point.day === '2026-01-05');
    expect(jan5!.completed).toBe(1);
    expect(jan5!.started).toBeGreaterThanOrEqual(1);
    expect(jan5!.completedDelta).toBe(1);
  });

  it('counts estimate points when the team estimates', () => {
    const store = new Store('w');
    store.applyChanges([
      upsert(1, 'team', team('t1', 'fibonacci')),
      upsert(2, 'workflowState', state('s1', 't1', 'unstarted', 'Todo')),
      upsert(3, 'cycle', cycle('cy1', 't1')),
      upsert(4, 'issue', issue('i1', 't1', 'cy1', 's1', { estimate: 5 })),
      upsert(5, 'issue', issue('i2', 't1', 'cy1', 's1')),
    ]);

    const data = buildCycleGraph(store, 'cy1');
    expect(data!.unitLabel).toBe('points');
    expect(data!.totalScope).toBe(6);
  });

  it('reports the window and the issue count, so the view can say "not yet"', () => {
    const store = new Store('w');
    store.applyChanges([
      upsert(1, 'team', team('t1', 'fibonacci')),
      upsert(2, 'workflowState', state('s1', 't1', 'unstarted', 'Todo')),
      upsert(3, 'cycle', cycle('cy1', 't1')),
    ]);

    // An empty cycle is not a null graph — the window is real, there is simply nothing on
    // it. `totalScope` cannot answer this on its own: a zero-point issue weighs nothing.
    const empty = buildCycleGraph(store, 'cy1');
    expect(empty).not.toBeNull();
    expect(empty!.issueCount).toBe(0);
    expect(empty!.startsAt).toBe('2026-01-01T00:00:00.000Z');

    store.applyChanges([
      upsert(4, 'issue', issue('i1', 't1', 'cy1', 's1', { estimate: 0 })),
      upsert(5, 'issue', issue('i2', 't1', 'cy1', 's1', { estimate: 0 })),
    ]);
    const zeroPoint = buildCycleGraph(store, 'cy1');
    expect(zeroPoint!.issueCount).toBe(2);
    expect(zeroPoint!.totalScope).toBe(0);
  });

  it('breaks work down per assignee', () => {
    const store = new Store('w');
    const user: User = {
      id: 'u1',
      workspaceId: 'w',
      name: 'ada',
      displayName: 'Ada',
      timezone: 'UTC',
      role: 'member',
      status: 'active',
      kind: 'human',
      createdAt: NOW,
      updatedAt: NOW,
    };
    store.applyChanges([
      upsert(1, 'team', team('t1')),
      upsert(2, 'user', user),
      upsert(3, 'workflowState', state('s1', 't1', 'completed', 'Done')),
      upsert(4, 'cycle', cycle('cy1', 't1')),
      upsert(
        5,
        'issue',
        issue('i1', 't1', 'cy1', 's1', {
          assigneeId: 'u1',
          completedAt: '2026-01-04T00:00:00.000Z',
        }),
      ),
      upsert(6, 'issue', issue('i2', 't1', 'cy1', 's1')),
    ]);

    const data = buildCycleGraph(store, 'cy1');
    expect(data!.assignees.map((row) => row.name).sort()).toEqual(['Ada', 'Unassigned']);
    expect(data!.assignees.find((row) => row.name === 'Ada')!.percent).toBe(100);
  });
});
