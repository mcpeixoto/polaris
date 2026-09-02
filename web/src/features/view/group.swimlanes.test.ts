/**
 * The two display options that change what a group *is*: show-empty-groups and sub-grouping.
 *
 * A sibling file rather than more cases in `group.test.ts`, because both of these argue
 * against a rule that file's cases exist to pin — "an empty status column is information",
 * and "one issue in one group per label". Neither rule is wrong; both are now answerable,
 * and keeping the two sets of cases apart keeps it obvious which is the default.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { Store } from '~/store';
import type { Issue, User, WorkflowState } from '~/store';
import { groupIssues, subGroupIssues } from './group';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const TEAM = '01900000-0000-7000-8000-0000000000b1';
const ADA = '01900000-0000-7000-8000-0000000000a1';
const GRACE = '01900000-0000-7000-8000-0000000000a2';
const AT = '2026-01-01T00:00:00Z';

const TODO = '01900000-0000-7000-8000-0000000000c1';
const DOING = '01900000-0000-7000-8000-0000000000c2';

function state(id: string, name: string, category: string): WorkflowState {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    name,
    color: '#888',
    category: category as WorkflowState['category'],
    position: 'a0',
    isDefault: false,
    isSystem: false,
    createdAt: AT,
    updatedAt: AT,
  };
}

function user(id: string, name: string): User {
  return {
    id,
    workspaceId: WORKSPACE,
    name,
    displayName: name.split(' ')[0]!,
    role: 'member',
    status: 'active',
    kind: 'human',
    createdAt: AT,
    updatedAt: AT,
  } as User;
}

function issue(over: Partial<Issue> & { id: string }): Issue {
  return {
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number: 1,
    identifier: 'ENG-1',
    title: 'An issue',
    description: '',
    stateId: TODO,
    priority: 0,
    sortOrder: 'a0',
    dueDateSource: 'manual',
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

let store: Store;

beforeEach(() => {
  // `new Store` rather than `Store.open`: this file needs a replica, not a persisted one,
  // and the neighbouring cases only reach for `open` because they predate the constructor
  // being usable on its own.
  store = new Store(WORKSPACE);
  store.applyChanges([
    {
      v: 1,
      type: 'workflowState',
      id: TODO,
      op: 'upsert',
      actor: { type: 'system' },
      payload: state(TODO, 'Todo', 'unstarted'),
    },
    {
      v: 2,
      type: 'workflowState',
      id: DOING,
      op: 'upsert',
      actor: { type: 'system' },
      payload: state(DOING, 'Doing', 'started'),
    },
    {
      v: 3,
      type: 'user',
      id: ADA,
      op: 'upsert',
      actor: { type: 'system' },
      payload: user(ADA, 'Ada Lovelace'),
    },
    {
      v: 4,
      type: 'user',
      id: GRACE,
      op: 'upsert',
      actor: { type: 'system' },
      payload: user(GRACE, 'Grace Hopper'),
    },
  ]);
});

describe('show empty groups', () => {
  it('drops the padding when it is turned off', () => {
    const groups = groupIssues(
      [issue({ id: 'i1' })],
      store,
      'state',
      'manual',
      'asc',
      undefined,
      undefined,
      false,
    );

    expect(groups.map((group) => group.label)).toEqual(['Todo']);
  });

  it('drops the priority padding too', () => {
    const groups = groupIssues(
      [issue({ id: 'i1', priority: 2 })],
      store,
      'priority',
      'manual',
      'asc',
      undefined,
      undefined,
      false,
    );

    expect(groups.length).toBe(1);
  });

  it('still pads by default, which is the rule the module opens with', () => {
    const groups = groupIssues([issue({ id: 'i1' })], store, 'state', 'manual', 'asc');

    expect(groups.map((group) => group.label)).toEqual(['Todo', 'Doing']);
  });
});

describe('sub-grouping', () => {
  const issues = [
    issue({ id: 'i1', stateId: TODO, assigneeId: ADA }),
    issue({ id: 'i2', stateId: TODO, assigneeId: GRACE }),
    issue({ id: 'i3', stateId: DOING, assigneeId: ADA }),
  ];

  it('splits each group and names both dimensions', () => {
    const grouped = groupIssues(issues, store, 'state', 'manual', 'asc');

    const lanes = subGroupIssues(grouped, store, 'assignee', 'manual', 'asc');

    expect(lanes.map((lane) => lane.label)).toEqual(['Todo · Ada', 'Todo · Grace', 'Doing · Ada']);
    expect(lanes.map((lane) => lane.issues.length)).toEqual([1, 1, 1]);
  });

  it('gives every lane a key of its own', () => {
    const lanes = subGroupIssues(
      groupIssues(issues, store, 'state', 'manual', 'asc'),
      store,
      'assignee',
      'manual',
      'asc',
    );

    // The key is the DOM key, the collapse key and the board column id all at once, so two
    // lanes sharing one would be two groups the screen cannot tell apart.
    expect(new Set(lanes.map((lane) => lane.key)).size).toBe(lanes.length);
  });

  it('keeps the outer group’s status, so the heading keeps its icon', () => {
    const lanes = subGroupIssues(
      groupIssues(issues, store, 'state', 'manual', 'asc'),
      store,
      'assignee',
      'manual',
      'asc',
    );

    expect(lanes[0]?.stateId).toBe(TODO);
    expect(lanes[2]?.stateId).toBe(DOING);
  });

  it('never pads a lane, whatever the outer padding said', () => {
    // A status crossed with an assignee is not a fixed set anybody can see the whole of, and
    // a board of statuses times people is a screen of zeroes.
    const lanes = subGroupIssues(
      groupIssues(issues, store, 'state', 'manual', 'asc'),
      store,
      'priority',
      'manual',
      'asc',
    );

    expect(lanes.every((lane) => lane.issues.length > 0)).toBe(true);
  });

  it('leaves an empty group alone rather than dividing nothing', () => {
    const grouped = groupIssues(
      [issue({ id: 'i1', stateId: TODO })],
      store,
      'state',
      'manual',
      'asc',
    );

    const lanes = subGroupIssues(grouped, store, 'assignee', 'manual', 'asc');

    expect(lanes.map((lane) => lane.label)).toEqual(['Todo · Unassigned', 'Doing']);
  });

  it('is the identity when there is no sub-grouping', () => {
    const grouped = groupIssues(issues, store, 'state', 'manual', 'asc');

    expect(subGroupIssues(grouped, store, 'none', 'manual', 'asc')).toEqual(grouped);
  });
});
