/**
 * Leaving triage with an optional comment.
 *
 * The comment write and the status write are separate mutations; this file pins that an
 * empty note skips the comment entirely and a non-empty one lands before the leave.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  Store,
  type Change,
  type Entity,
  type EntityType,
  type Issue,
  type Team,
  type WorkflowState,
} from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { acceptTriageIssueWithComment, declineTriageIssueWithComment } from './decide';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const TEAM = '01900000-0000-7000-8000-000000000002';
const TODO = '01900000-0000-7000-8000-000000000003';
const CANCELED = '01900000-0000-7000-8000-000000000004';
const TRIAGE = '01900000-0000-7000-8000-000000000005';
const ISSUE = '01900000-0000-7000-8000-000000000007';
const AUTHOR = '01900000-0000-7000-8000-000000000009';
const AT = '2026-01-01T00:00:00.000Z';

let engine: SyncEngine;
let store: Store;

beforeEach(() => {
  store = seeded();
  const mutate = vi.fn(async (input: { optimistic?: Parameters<Store['applyOptimistic']>[0] }) => {
    if (input.optimistic !== undefined) store.applyOptimistic(input.optimistic);
    return {};
  });
  engine = { store, mutate } as unknown as SyncEngine;
});

describe('acceptTriageIssueWithComment', () => {
  it('skips the comment write when the note is empty', async () => {
    await acceptTriageIssueWithComment(engine, ISSUE, '  ', AUTHOR);
    expect(store.comments.size).toBe(0);
    expect(store.get('issue', ISSUE)?.stateId).toBe(TODO);
  });

  it('posts the comment before leaving triage', async () => {
    await acceptTriageIssueWithComment(engine, ISSUE, 'On it.', AUTHOR);
    expect([...store.comments.values()].map((c) => c.body)).toEqual(['On it.']);
    expect(store.get('issue', ISSUE)?.stateId).toBe(TODO);
  });
});

describe('declineTriageIssueWithComment', () => {
  it('posts a polite decline note then cancels', async () => {
    await declineTriageIssueWithComment(engine, ISSUE, 'Not in scope.', AUTHOR);
    expect([...store.comments.values()].map((c) => c.body)).toEqual(['Not in scope.']);
    expect(store.get('issue', ISSUE)?.stateId).toBe(CANCELED);
  });
});

function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    change(1, 'team', TEAM, team()),
    change(2, 'workflowState', TODO, state(TODO, 'Todo', 'unstarted')),
    change(3, 'workflowState', CANCELED, state(CANCELED, 'Canceled', 'canceled')),
    change(4, 'workflowState', TRIAGE, state(TRIAGE, 'Triage', 'triage')),
    change(5, 'issue', ISSUE, issue(ISSUE, 1, 'Crash')),
  ]);
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

function issue(id: string, number: number, title: string): Issue {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number,
    identifier: `ENG-${number}`,
    title,
    description: '',
    stateId: TRIAGE,
    priority: 0,
    sortOrder: 'a0',
    dueDateSource: 'manual',
    createdAt: AT,
    updatedAt: AT,
  };
}
