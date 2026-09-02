/**
 * The queue's order and its "what next", which together are the whole of the triage
 * screen's advance. The cases that matter are the vanishing row and the last row: both are
 * the ones a reviewer hits on every pass down a queue.
 */

import { describe, expect, it } from 'vitest';

import {
  Store,
  type Change,
  type Entity,
  type EntityType,
  type Issue,
  type Team,
  type WorkflowState,
} from '~/store';

import { nextInQueue, triageQueueIds } from './focus';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const TEAM = '01900000-0000-7000-8000-000000000002';
const TODO = '01900000-0000-7000-8000-000000000003';
const TRIAGE = '01900000-0000-7000-8000-000000000005';
const AT = '2026-01-01T00:00:00.000Z';
const NOW = Date.parse('2026-06-01T00:00:00.000Z');

describe('triageQueueIds', () => {
  it('lists only unarchived, awake triage work, in manual order', () => {
    const store = seeded([
      issue('i3', TRIAGE, { sortOrder: 'c' }),
      issue('i1', TRIAGE, { sortOrder: 'a' }),
      issue('i2', TRIAGE, { sortOrder: 'b' }),
      issue('i4', TODO, { sortOrder: 'd' }),
      issue('i5', TRIAGE, { sortOrder: 'e', archivedAt: AT }),
      issue('i6', TRIAGE, { sortOrder: 'f', snoozedUntil: '2099-01-01T00:00:00.000Z' }),
    ]);
    expect(triageQueueIds(store, TEAM, NOW)).toEqual(['i1', 'i2', 'i3']);
  });

  it('brings a snooze back once its moment has passed', () => {
    const store = seeded([issue('i1', TRIAGE, { snoozedUntil: '2026-03-01T00:00:00.000Z' })]);
    expect(triageQueueIds(store, TEAM, NOW)).toEqual(['i1']);
  });

  it('orders by id when two rows share a sort order, so the queue cannot reshuffle', () => {
    const store = seeded([
      issue('i2', TRIAGE, { sortOrder: 'a' }),
      issue('i1', TRIAGE, { sortOrder: 'a' }),
    ]);
    expect(triageQueueIds(store, TEAM, NOW)).toEqual(['i1', 'i2']);
  });
});

describe('nextInQueue', () => {
  it('moves to the row after the one just decided', () => {
    expect(nextInQueue(['a', 'b', 'c'], 'b')).toBe('c');
  });

  it('holds at the end of the queue rather than jumping back to the top', () => {
    expect(nextInQueue(['a', 'b', 'c'], 'c')).toBe('b');
  });

  it('falls to the first row when the current one is already gone', () => {
    expect(nextInQueue(['a', 'b'], 'gone')).toBe('a');
    expect(nextInQueue(['a', 'b'], null)).toBe('a');
  });

  it('has nowhere to go once the queue is empty', () => {
    expect(nextInQueue([], 'a')).toBeNull();
    expect(nextInQueue(['a'], 'a')).toBeNull();
  });
});

function seeded(issues: readonly Issue[]): Store {
  const store = new Store(WORKSPACE);
  const changes: Change[] = [
    change(1, 'team', TEAM, team()),
    change(2, 'workflowState', TODO, state(TODO, 'Todo', 'unstarted')),
    change(3, 'workflowState', TRIAGE, state(TRIAGE, 'Triage', 'triage')),
  ];
  issues.forEach((entity, index) => {
    changes.push(change(4 + index, 'issue', entity.id, entity));
  });
  store.applyChanges(changes);
  return store;
}

function change(v: number, type: EntityType, id: string, payload: Entity): Change {
  return { v, type, id, op: 'upsert', actor: { type: 'system' }, payload };
}

function team(): Team {
  return {
    id: TEAM,
    workspaceId: WORKSPACE,
    key: 'ENG',
    name: 'Engineering',
    timezone: 'Europe/Lisbon',
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
    triageEnabled: true,
    triageRequirePriority: false,
    autoCloseDays: 0,
    autoArchiveDays: 0,
    autoCloseParent: false,
    autoCloseChildren: false,
    createdAt: AT,
    updatedAt: AT,
  };
}

function state(id: string, name: string, category: WorkflowState['category']): WorkflowState {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    name,
    color: '#5e6ad2',
    category,
    position: 'V',
    isDefault: category === 'unstarted',
    isSystem: false,
    createdAt: AT,
    updatedAt: AT,
  };
}

function issue(id: string, stateId: string, extra: Partial<Issue> = {}): Issue {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number: Number(id.slice(1)),
    identifier: `ENG-${id.slice(1)}`,
    title: `Issue ${id}`,
    description: '',
    stateId,
    priority: 0,
    sortOrder: 'V',
    dueDateSource: 'manual',
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  };
}
