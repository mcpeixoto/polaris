import { beforeEach, describe, expect, it } from 'vitest';

import { Store } from '~/store';
import type { Issue, WorkflowState } from '~/store';
import { groupIssues, sortIssues } from './group';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const TEAM = '01900000-0000-7000-8000-0000000000b1';
const OTHER_TEAM = '01900000-0000-7000-8000-0000000000b2';
const ADA = '01900000-0000-7000-8000-0000000000a1';
const GRACE = '01900000-0000-7000-8000-0000000000a2';
const AT = '2026-01-01T00:00:00Z';

const TODO = '01900000-0000-7000-8000-0000000000c1';
const DOING = '01900000-0000-7000-8000-0000000000c2';
const DONE = '01900000-0000-7000-8000-0000000000c3';
const OTHER_TODO = '01900000-0000-7000-8000-0000000000d1';

function state(
  id: string,
  name: string,
  category: string,
  position: string,
  teamId: string = TEAM,
): WorkflowState {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId,
    name,
    color: '#888',
    category: category as WorkflowState['category'],
    position,
    isDefault: false,
    isSystem: false,
    createdAt: AT,
    updatedAt: AT,
  };
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

beforeEach(async () => {
  store = await Store.open(WORKSPACE, {});
  store.applyChanges([
    {
      v: 1,
      type: 'workflowState',
      id: TODO,
      op: 'upsert',
      actor: { type: 'system' },
      payload: state(TODO, 'Todo', 'unstarted', 'a0'),
    },
    {
      v: 2,
      type: 'workflowState',
      id: DOING,
      op: 'upsert',
      actor: { type: 'system' },
      payload: state(DOING, 'Doing', 'started', 'a0'),
    },
    {
      v: 3,
      type: 'workflowState',
      id: DONE,
      op: 'upsert',
      actor: { type: 'system' },
      payload: state(DONE, 'Done', 'completed', 'a0'),
    },
  ]);
});

describe('grouping', () => {
  // "Nothing is in review" is a fact somebody wants to see, and a board whose columns
  // appear and disappear as work moves through it is one nobody builds a habit around.
  it('keeps empty status groups', () => {
    const groups = groupIssues([issue({ id: 'i1' })], store, 'state', 'manual', 'asc');
    expect(groups.map((g) => g.label)).toEqual(['Todo', 'Doing', 'Done']);
    expect(groups[1]?.issues).toEqual([]);
  });

  // Statuses belong to a team. Padding a team's list from every status in the workspace
  // puts another team's columns on this team's board — three "Todo"s in a three-team
  // workspace — for issues that could never land in them.
  it('does not pad a team view with another team\'s statuses', () => {
    store.applyChanges([
      {
        v: 10,
        type: 'workflowState',
        id: OTHER_TODO,
        op: 'upsert',
        actor: { type: 'system' },
        payload: state(OTHER_TODO, 'Todo', 'unstarted', 'a0', OTHER_TEAM),
      },
    ]);
    const groups = groupIssues([issue({ id: 'i1' })], store, 'state', 'manual', 'asc', TEAM);
    expect(groups.map((g) => g.label)).toEqual(['Todo', 'Doing', 'Done']);
    expect(groups.every((g) => g.stateId !== OTHER_TODO)).toBe(true);
  });

  // A view that spans teams has no one team's status list to show, so it shows the
  // statuses its issues are actually in rather than every status in the workspace.
  it('pads an unscoped view only from the teams its issues are in', () => {
    store.applyChanges([
      {
        v: 11,
        type: 'workflowState',
        id: OTHER_TODO,
        op: 'upsert',
        actor: { type: 'system' },
        payload: state(OTHER_TODO, 'Todo', 'unstarted', 'a0', OTHER_TEAM),
      },
    ]);
    const groups = groupIssues([issue({ id: 'i1' })], store, 'state', 'manual', 'asc');
    expect(groups.every((g) => g.stateId !== OTHER_TODO)).toBe(true);
  });

  // Position is a fractional index and is only comparable within a category. Sorting on it
  // alone produces an order that looks almost right, which is worse than one that looks
  // wrong.
  it('orders statuses by category before position', () => {
    store.applyChanges([
      {
        v: 4,
        type: 'workflowState',
        id: DONE,
        op: 'upsert',
        actor: { type: 'system' },
        payload: state(DONE, 'Done', 'completed', 'a0'),
      },
    ]);
    // Scoped to the team, because an empty unscoped view has no team whose status list to
    // show — the ordering under test is of the padded columns, not of the scoping.
    const groups = groupIssues([], store, 'state', 'manual', 'asc', TEAM);
    expect(groups.map((g) => g.label)).toEqual(['Todo', 'Doing', 'Done']);
  });

  it('offers every priority, in display order rather than numeric order', () => {
    const groups = groupIssues(
      [issue({ id: 'i1', priority: 3 })],
      store,
      'priority',
      'manual',
      'asc',
    );
    // 0 means "no priority" and must not lead.
    expect(groups.map((g) => g.label)).toEqual(['Urgent', 'High', 'Medium', 'Low', 'No priority']);
  });

  // The residue, not a value. Putting "Unassigned" first pushes the actual work below the
  // fold.
  it('sorts the unset group last', () => {
    const groups = groupIssues(
      [issue({ id: 'i1' }), issue({ id: 'i2', assigneeId: ADA })],
      store,
      'assignee',
      'manual',
      'asc',
    );
    expect(groups.at(-1)?.label).toBe('Unassigned');
  });

  it('does not invent an assignee column for everybody in the workspace', () => {
    const groups = groupIssues(
      [issue({ id: 'i1', assigneeId: ADA })],
      store,
      'assignee',
      'manual',
      'asc',
    );
    expect(groups).toHaveLength(1);
    expect(groups.every((g) => g.userId !== GRACE)).toBe(true);
  });

  it('puts everything in one group when grouping is off', () => {
    const groups = groupIssues(
      [issue({ id: 'i1' }), issue({ id: 'i2', stateId: DONE })],
      store,
      'none',
      'manual',
      'asc',
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.issues).toHaveLength(2);
  });
});

describe('ordering', () => {
  it('orders by priority rank, not by the stored number', () => {
    const issues = [
      issue({ id: 'none', priority: 0, sortOrder: 'a0' }),
      issue({ id: 'urgent', priority: 1, sortOrder: 'a1' }),
      issue({ id: 'low', priority: 4, sortOrder: 'a2' }),
    ];
    expect(sortIssues(issues, store, 'priority', 'asc').map((i) => i.id)).toEqual([
      'urgent',
      'low',
      'none',
    ]);
  });

  // An issue with no due date is not due soonest. Treating an absent value as the smallest
  // one fills the top of a deadline view with work that has no deadline.
  it('sorts the undated last, in both directions', () => {
    const issues = () => [
      issue({ id: 'undated', sortOrder: 'a0' }),
      issue({ id: 'soon', dueDate: '2026-02-01', sortOrder: 'a1' }),
      issue({ id: 'later', dueDate: '2026-09-01', sortOrder: 'a2' }),
    ];
    expect(sortIssues(issues(), store, 'dueDate', 'asc').map((i) => i.id)).toEqual([
      'soon',
      'later',
      'undated',
    ]);
    // Reversing the direction reverses the dated ones. The undated moving to the front is
    // the honest consequence of one comparator; what must not happen is them interleaving.
    const desc = sortIssues(issues(), store, 'dueDate', 'desc').map((i) => i.id);
    expect(desc.slice(1)).toEqual(['later', 'soon']);
  });

  it('sorts the unestimated last', () => {
    const issues = [
      issue({ id: 'unestimated', sortOrder: 'a0' }),
      issue({ id: 'small', estimate: 1, sortOrder: 'a1' }),
    ];
    expect(sortIssues(issues, store, 'estimate', 'asc').map((i) => i.id)).toEqual([
      'small',
      'unestimated',
    ]);
  });

  // Without a deterministic tie-break, a list ordered by priority visibly reshuffles its
  // equal-priority rows every time anything in the workspace changes, and it looks like a
  // rendering bug because it is one.
  it('breaks ties deterministically, whatever order the input arrived in', () => {
    const a = issue({ id: 'a', priority: 2, sortOrder: 'a0' });
    const b = issue({ id: 'b', priority: 2, sortOrder: 'a1' });
    expect(sortIssues([a, b], store, 'priority', 'asc').map((i) => i.id)).toEqual(['a', 'b']);
    expect(sortIssues([b, a], store, 'priority', 'asc').map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('orders manually by the fractional index, which compares as a plain string', () => {
    const issues = [
      issue({ id: 'third', sortOrder: 'a2' }),
      issue({ id: 'first', sortOrder: 'a0' }),
      issue({ id: 'second', sortOrder: 'a1' }),
    ];
    expect(sortIssues(issues, store, 'manual', 'asc').map((i) => i.id)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });
});
