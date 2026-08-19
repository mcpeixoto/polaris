/**
 * Optimistic patches for leaving triage, and the team switch that turns the inbox on.
 *
 * The server is the source of truth for *whether* a leave is allowed. These tests pin what
 * the screen shows in the frame of the keystroke: accept lands on the default status,
 * decline on canceled, duplicate writes the relation, snooze sets a time, and an ordinary
 * edit clears a snooze the way the server will.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createIssue, updateIssue } from '~/features/issue/mutations';
import { Store, type Change, type Entity, type EntityType, type Issue, type Team, type WorkflowState } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import {
  acceptTriageIssue,
  declineTriageIssue,
  markIssueDuplicate,
  requiresPriorityToLeave,
  snoozeIssue,
  updateTeamTriage,
} from './mutations';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const TEAM = '01900000-0000-7000-8000-000000000002';
const TODO = '01900000-0000-7000-8000-000000000003';
const CANCELED = '01900000-0000-7000-8000-000000000004';
const TRIAGE = '01900000-0000-7000-8000-000000000005';
const DUPLICATE = '01900000-0000-7000-8000-000000000006';
const ISSUE = '01900000-0000-7000-8000-000000000007';
const OTHER = '01900000-0000-7000-8000-000000000008';
const AT = '2026-01-01T00:00:00.000Z';

let mutate: ReturnType<typeof vi.fn>;
let engine: SyncEngine;

beforeEach(() => {
  const store = seeded();
  mutate = vi.fn(async (input: { optimistic?: Parameters<Store['applyOptimistic']>[0] }) => {
    if (input.optimistic !== undefined) store.applyOptimistic(input.optimistic);
    return {};
  });
  engine = { store, mutate } as unknown as SyncEngine;
});

describe('updateTeamTriage', () => {
  it('patches the two flags on the team', async () => {
    await updateTeamTriage(engine, TEAM, { enabled: true, requirePriority: true });

    const team = engine.store.get('team', TEAM);
    expect(team?.triageEnabled).toBe(true);
    expect(team?.triageRequirePriority).toBe(true);
    expect(mutate.mock.calls[0]?.[0].variables.input).toEqual({
      teamId: TEAM,
      enabled: true,
      requirePriority: true,
    });
  });
});

describe('leaving triage', () => {
  it('accepts into the team default', async () => {
    await acceptTriageIssue(engine, ISSUE);
    expect(engine.store.get('issue', ISSUE)?.stateId).toBe(TODO);
    expect(mutate.mock.calls[0]?.[0].mutation).toContain('acceptTriageIssue');
  });

  it('declines into the first canceled status', async () => {
    await declineTriageIssue(engine, ISSUE);
    expect(engine.store.get('issue', ISSUE)?.stateId).toBe(CANCELED);
  });

  it('marks a duplicate and writes the relation', async () => {
    await markIssueDuplicate(engine, ISSUE, OTHER);
    const issue = engine.store.get('issue', ISSUE);
    expect(issue?.stateId).toBe(DUPLICATE);
    const relations = [...engine.store.issueRelations.values()];
    expect(relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ issueId: ISSUE, relatedIssueId: OTHER, type: 'duplicate' }),
      ]),
    );
  });

  it('snoozes until the given instant', async () => {
    const until = new Date('2026-08-20T09:00:00.000Z');
    await snoozeIssue(engine, ISSUE, until);
    expect(engine.store.get('issue', ISSUE)?.snoozedUntil).toBe(until.toISOString());
  });

  it('clears a snooze on an ordinary edit, matching the server', async () => {
    const until = new Date('2026-08-20T09:00:00.000Z');
    await snoozeIssue(engine, ISSUE, until);
    await updateIssue(engine, ISSUE, { title: 'Still incoming' });
    expect(engine.store.get('issue', ISSUE)?.snoozedUntil).toBeUndefined();
  });

  it('requires a priority only when the team asked for one', () => {
    expect(requiresPriorityToLeave(engine, [ISSUE])).toBe(false);
    engine.store.applyChanges([
      change(40, 'team', TEAM, { ...team(), triageRequirePriority: true }),
    ]);
    expect(requiresPriorityToLeave(engine, [ISSUE])).toBe(true);
    engine.store.applyChanges([change(41, 'issue', ISSUE, { ...issue(ISSUE, TRIAGE), priority: 2 })]);
    expect(requiresPriorityToLeave(engine, [ISSUE])).toBe(false);
  });
});

describe('createIssue from triage', () => {
  it('lands in the triage status when fromTriage is set', async () => {
    mutate.mockResolvedValue({ createIssue: { issue: issue('new', TRIAGE) } });
    await createIssue(engine, { teamId: TEAM, title: 'Filed in the inbox', fromTriage: true });
    const variables = mutate.mock.calls[0]?.[0].variables.input as { fromTriage?: boolean; stateId?: string };
    expect(variables.fromTriage).toBe(true);
    expect(variables.stateId).toBeUndefined();
  });
});

function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    change(1, 'team', TEAM, team()),
    change(2, 'workflowState', TODO, state(TODO, 'Todo', 'unstarted', true, false)),
    change(3, 'workflowState', CANCELED, state(CANCELED, 'Canceled', 'canceled', false, false)),
    change(4, 'workflowState', TRIAGE, state(TRIAGE, 'Triage', 'triage', false, false)),
    change(5, 'workflowState', DUPLICATE, state(DUPLICATE, 'Duplicate', 'duplicate', false, true)),
    change(6, 'issue', ISSUE, issue(ISSUE, TRIAGE)),
    change(7, 'issue', OTHER, issue(OTHER, TODO, 'Already filed')),
  ]);
  return store;
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

function state(
  id: string,
  name: string,
  category: WorkflowState['category'],
  isDefault: boolean,
  isSystem: boolean,
): WorkflowState {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    name,
    color: '#5e6ad2',
    category,
    position: 'V',
    isDefault,
    isSystem,
    createdAt: AT,
    updatedAt: AT,
  };
}

function issue(id: string, stateId: string, title = 'Incoming'): Issue {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number: id === OTHER ? 2 : 1,
    identifier: id === OTHER ? 'ENG-2' : 'ENG-1',
    title,
    description: '',
    stateId,
    priority: 0,
    sortOrder: 'V',
    dueDateSource: 'manual',
    createdAt: AT,
    updatedAt: AT,
  };
}

function change(v: number, type: EntityType, id: string, payload: Entity): Change {
  return { v, type, id, op: 'upsert', actor: { type: 'system' }, payload };
}
