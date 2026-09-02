/**
 * The cycle graph in a team that is not on UTC.
 *
 * Every fixture in cycleGraph.test.ts is `timezone: 'UTC'`, which is why the graph could
 * reckon its days in UTC for as long as it did and never fail a test. A cycle begins at
 * 12:01 AM in the team's zone, so a window stored as Tokyo midnight starts a day earlier in
 * UTC and one stored as Los Angeles midnight ends a day later — one extra column at the
 * front for half the world and one missing at the back for the other half, with the weekend
 * flattening sliding across the Friday/Monday edge either way.
 */

import { describe, expect, it } from 'vitest';

import { Store } from '~/store/store';
import type { Change, Cycle, Entity, Issue, Team, WorkflowState } from '~/store/types';

import { buildCycleGraph } from './computeCycleGraph';

const AT = '2026-01-01T00:00:00.000Z';
const ACTOR = { type: 'user', id: 'u1' } as const;

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return { v, type, id: entity.id, op: 'upsert', actor: ACTOR, payload: entity };
}

function team(timezone: string): Team {
  return {
    id: 't1',
    workspaceId: 'w',
    key: 'ENG',
    name: 'Engineering',
    timezone,
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
    createdAt: AT,
    updatedAt: AT,
  };
}

function cycle(startsAt: string, endsAt: string): Cycle {
  return {
    id: 'cy1',
    workspaceId: 'w',
    teamId: 't1',
    number: 1,
    name: 'Cycle 1',
    startsAt,
    endsAt,
    createdAt: AT,
    updatedAt: AT,
  };
}

function state(id: string, category: WorkflowState['category']): WorkflowState {
  return {
    id,
    workspaceId: 'w',
    teamId: 't1',
    name: category,
    color: '#888',
    category,
    position: id,
    isDefault: category === 'unstarted',
    isSystem: category === 'completed',
    createdAt: AT,
    updatedAt: AT,
  };
}

function issue(id: string, stateId: string, over: Partial<Issue> = {}): Issue {
  return {
    id,
    workspaceId: 'w',
    teamId: 't1',
    number: 1,
    identifier: `ENG-${id}`,
    title: id,
    description: '',
    stateId,
    priority: 3,
    sortOrder: id,
    dueDateSource: 'manual',
    cycleId: 'cy1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: AT,
    ...over,
  };
}

function seeded(timezone: string, startsAt: string, endsAt: string, issues: Issue[] = []): Store {
  const store = new Store('w');
  store.applyChanges([
    upsert(1, 'team', team(timezone)),
    upsert(2, 'workflowState', state('s-todo', 'unstarted')),
    upsert(3, 'workflowState', state('s-done', 'completed')),
    upsert(4, 'cycle', cycle(startsAt, endsAt)),
    ...issues.map((entity, index) => upsert(5 + index, 'issue', entity)),
  ]);
  return store;
}

describe('buildCycleGraph in a team that is not on UTC', () => {
  it('starts on the team’s first day, not on the UTC day before it', () => {
    // 2026-01-05 00:00 and 2026-01-18 23:59:59.999 in Tokyo, which is 9 hours ahead.
    const store = seeded('Asia/Tokyo', '2026-01-04T15:00:00.000Z', '2026-01-18T14:59:59.999Z');

    const data = buildCycleGraph(store, 'cy1');
    expect(data).not.toBeNull();
    expect(data!.points[0]!.day).toBe('2026-01-05');
    expect(data!.points[data!.points.length - 1]!.day).toBe('2026-01-18');
    expect(data!.points.length).toBe(14);
  });

  it('ends on the team’s last day, not a day short of it', () => {
    // 2026-01-05 00:00 and 2026-01-18 23:59:59.999 in Los Angeles, 8 hours behind.
    const store = seeded(
      'America/Los_Angeles',
      '2026-01-05T08:00:00.000Z',
      '2026-01-19T07:59:59.999Z',
    );

    const data = buildCycleGraph(store, 'cy1');
    expect(data!.points[0]!.day).toBe('2026-01-05');
    expect(data!.points[data!.points.length - 1]!.day).toBe('2026-01-18');
    expect(data!.points.length).toBe(14);
  });

  it('flattens the weekend on the team’s calendar', () => {
    const store = seeded('Asia/Tokyo', '2026-01-04T15:00:00.000Z', '2026-01-18T14:59:59.999Z', [
      issue('i1', 's-todo'),
      issue('i2', 's-todo'),
    ]);

    const data = buildCycleGraph(store, 'cy1');
    const at = (day: string) => data!.points.find((point) => point.day === day)!;
    // Friday the 9th, Saturday the 10th, Sunday the 11th, Monday the 12th. The target only
    // climbs on the weekdays, so the two weekend days hold Friday's number.
    expect(at('2026-01-10').target).toBe(at('2026-01-09').target);
    expect(at('2026-01-11').target).toBe(at('2026-01-09').target);
    expect(at('2026-01-12').target).toBeGreaterThan(at('2026-01-09').target);
  });

  it('closes a day at the team’s midnight, so late work lands on the right column', () => {
    // 05:00 on the 6th in Tokyo. Reckoned in UTC it is still the 5th.
    const store = seeded('Asia/Tokyo', '2026-01-04T15:00:00.000Z', '2026-01-18T14:59:59.999Z', [
      issue('i1', 's-done', { completedAt: '2026-01-05T20:00:00.000Z' }),
    ]);

    const data = buildCycleGraph(store, 'cy1');
    const at = (day: string) => data!.points.find((point) => point.day === day)!;
    expect(at('2026-01-05').completed).toBe(0);
    expect(at('2026-01-06').completed).toBe(1);
  });
});
