/**
 * What the menu offers, read straight out of a real store.
 *
 * The rule with teeth is the one about a selection: a value the targets disagree on must be
 * ticked nowhere. A menu that ticked the first row's assignee while acting on six would tell
 * somebody the bulk change had already happened.
 */

import { describe, expect, it } from 'vitest';

import {
  Store,
  type Change,
  type Issue,
  type IssueLabel,
  type Label,
  type Team,
  type User,
  type WorkflowState,
} from '~/store';

import { readRowMenuOptions } from './rowMenuOptions';

const WORKSPACE = 'workspace-1';
const ENG = 'team-eng';
const AT = '2026-01-01T00:00:00Z';

function team(): Team {
  return {
    id: ENG,
    workspaceId: WORKSPACE,
    key: 'ENG',
    name: 'Engineering',
    timezone: 'Europe/Lisbon',
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
    createdAt: AT,
    updatedAt: AT,
  };
}

function state(
  id: string,
  name: string,
  category: WorkflowState['category'],
  position: string,
  isSystem = false,
): WorkflowState {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: ENG,
    name,
    color: '#5e6ad2',
    category,
    position,
    isDefault: category === 'unstarted',
    isSystem,
    createdAt: AT,
    updatedAt: AT,
  };
}

function person(id: string, name: string): User {
  return {
    id,
    workspaceId: WORKSPACE,
    name,
    displayName: name,
    timezone: 'Europe/Lisbon',
    role: 'member',
    status: 'active',
    kind: 'human',
    createdAt: AT,
    updatedAt: AT,
  };
}

function issue(id: string, number: number, extras: Partial<Issue> = {}): Issue {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: ENG,
    number,
    identifier: `ENG-${number}`,
    title: `Issue ${String(number)}`,
    description: '',
    stateId: 's-todo',
    priority: 0,
    sortOrder: 'V',
    dueDateSource: 'manual',
    createdAt: AT,
    updatedAt: AT,
    ...extras,
  };
}

function label(): Label {
  return {
    id: 'l-bug',
    workspaceId: WORKSPACE,
    teamId: ENG,
    name: 'Bug',
    color: '#eb5757',
    isGroup: false,
    position: 'V',
    createdAt: AT,
    updatedAt: AT,
  };
}

function on(issueId: string): IssueLabel {
  return {
    id: `${issueId}:l-bug`,
    workspaceId: WORKSPACE,
    teamId: ENG,
    issueId,
    labelId: 'l-bug',
    createdAt: AT,
  };
}

function seeded(rows: readonly [string, { id: string }][]): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges(
    rows.map(([type, entity], index) => ({
      v: index + 1,
      type,
      id: entity.id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload: entity,
    })) as Change[],
  );
  return store;
}

const BASE: [string, { id: string }][] = [
  ['team', team()],
  ['workflowState', state('s-doing', 'In Progress', 'started', 'V')],
  ['workflowState', state('s-todo', 'Todo', 'unstarted', 'V')],
  ['workflowState', state('s-dup', 'Duplicate', 'duplicate', 'V', true)],
  ['user', person('u-ada', 'Ada Lovelace')],
  ['label', label()],
];

describe('readRowMenuOptions', () => {
  it('orders the statuses by category and hides the system one', () => {
    const store = seeded([...BASE, ['issue', issue('issue-1', 1)]]);

    const options = readRowMenuOptions(store, 'issue-1', ['issue-1'], '');

    // Category order, not insertion order — and no Duplicate, which is assigned by the
    // system when an issue is closed as one and never chosen by hand.
    expect(options.states?.map((row) => row.id)).toEqual(['s-todo', 's-doing']);
    expect(options.stateId).toBe('s-todo');
  });

  it('ticks a label every target carries, and drops one only some do', () => {
    const store = seeded([
      ...BASE,
      ['issue', issue('issue-1', 1)],
      ['issue', issue('issue-2', 2)],
      ['issueLabel', on('issue-1')],
    ]);

    const one = readRowMenuOptions(store, 'issue-1', ['issue-1'], '');
    expect(one.labels?.[0]?.options[0]?.applied).toBe(true);

    const both = readRowMenuOptions(store, 'issue-1', ['issue-1', 'issue-2'], '');
    expect(both.labels?.[0]?.options[0]?.applied).toBe(false);
  });

  it('ticks nothing a selection disagrees about', () => {
    const store = seeded([
      ...BASE,
      ['issue', issue('issue-1', 1, { assigneeId: 'u-ada', priority: 1 })],
      ['issue', issue('issue-2', 2, { priority: 3 })],
    ]);

    const options = readRowMenuOptions(store, 'issue-1', ['issue-1', 'issue-2'], '');

    // `undefined` and not `null`: null is a real answer for an assignee — nobody — and the
    // two must not be confused, or the menu ticks "No assignee" for a mixed selection.
    expect(options.assigneeId).toBeUndefined();
    expect(options.priority).toBeUndefined();
  });

  it('offers the team’s estimate ladder, with none at the top', () => {
    const store = seeded([...BASE, ['issue', issue('issue-1', 1, { estimate: 3 })]]);

    const options = readRowMenuOptions(store, 'issue-1', ['issue-1'], '');

    expect(options.estimates?.map((row) => row.label)).toEqual([
      'No estimate',
      '1',
      '2',
      '3',
      '5',
      '8',
    ]);
    expect(options.estimate).toBe(3);
  });

  it('offers no cycles for a team that does not run them', () => {
    const store = seeded([...BASE, ['issue', issue('issue-1', 1)]]);

    expect(readRowMenuOptions(store, 'issue-1', ['issue-1'], '').cycles).toEqual([]);
  });

  it('answers with nothing at all for an issue the replica does not hold', () => {
    const store = seeded(BASE);

    // A search result that only exists on the wire: there is no row to read, and inventing
    // empty lists would draw cascades that choose nothing.
    expect(readRowMenuOptions(store, 'issue-9', ['issue-9'], '')).toEqual({});
  });
});
