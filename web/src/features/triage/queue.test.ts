/**
 * What counts as "still waiting on somebody".
 *
 * The answer decides whether the inbox is a screen at all once intake has been turned off,
 * so the edges matter: an archived issue is not waiting on anybody and must not hold the
 * screen open, and a snoozed one is, because a snooze defers a decision rather than making
 * it. The short-circuit is here too — the shell asks this on every issue delta.
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

import { triageQueueCount } from './queue';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const TEAM = '01900000-0000-7000-8000-000000000002';
const OTHER_TEAM = '01900000-0000-7000-8000-00000000000a';
const TODO = '01900000-0000-7000-8000-000000000003';
const TRIAGE = '01900000-0000-7000-8000-000000000005';
const AT = '2026-01-01T00:00:00.000Z';

describe('triageQueueCount', () => {
  it('counts what is sitting in a triage status, snoozed work included', () => {
    const store = seeded([
      issue('i1', TRIAGE),
      issue('i2', TRIAGE, { snoozedUntil: '2099-01-01T00:00:00.000Z' }),
      issue('i3', TODO),
    ]);
    expect(triageQueueCount(store, TEAM)).toBe(2);
  });

  it('leaves out archived work, which the inbox does not list either', () => {
    const store = seeded([issue('i1', TRIAGE), issue('i2', TRIAGE, { archivedAt: AT })]);
    expect(triageQueueCount(store, TEAM)).toBe(1);
  });

  it('is zero for a team that has no triage status, without reading its issues', () => {
    const store = seeded([issue('i1', TODO)]);
    expect(triageQueueCount(store, OTHER_TEAM)).toBe(0);
  });
});

function seeded(issues: readonly Issue[]): Store {
  const store = new Store(WORKSPACE);
  const changes: Change[] = [
    change(1, 'team', TEAM, team(TEAM, 'ENG')),
    change(2, 'team', OTHER_TEAM, team(OTHER_TEAM, 'DES')),
    change(3, 'workflowState', TODO, state(TODO, 'Todo', 'unstarted')),
    change(4, 'workflowState', TRIAGE, state(TRIAGE, 'Triage', 'triage')),
  ];
  issues.forEach((entity, index) => {
    changes.push(change(5 + index, 'issue', entity.id, entity));
  });
  store.applyChanges(changes);
  return store;
}

function change(v: number, type: EntityType, id: string, payload: Entity): Change {
  return { v, type, id, op: 'upsert', actor: { type: 'system' }, payload };
}

function team(id: string, key: string): Team {
  return {
    id,
    workspaceId: WORKSPACE,
    key,
    name: key,
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
