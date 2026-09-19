/**
 * A list scans statuses in the opposite direction to a board.
 *
 * The board is a pipeline — backlog, then unstarted, then started, then done — and
 * `group.test.ts` pins that as the default, because pickers and settings share it.
 * The list is a scan of what to look at: done, then moving, then waiting, then parked,
 * then dead. That split lives in `groupIssues`'s layout argument, not in `CATEGORY_ORDER`.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { Store } from '~/store';
import type { Issue, WorkflowState } from '~/store';
import { groupIssues } from './group';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const TEAM = '01900000-0000-7000-8000-0000000000b1';
const AT = '2026-01-01T00:00:00Z';

const BACKLOG = '01900000-0000-7000-8000-0000000000c0';
const TODO = '01900000-0000-7000-8000-0000000000c1';
const DOING = '01900000-0000-7000-8000-0000000000c2';
const DONE = '01900000-0000-7000-8000-0000000000c3';
const CANCELED = '01900000-0000-7000-8000-0000000000c4';

function state(id: string, name: string, category: string, position: string): WorkflowState {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
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
      id: BACKLOG,
      op: 'upsert',
      actor: { type: 'system' },
      payload: state(BACKLOG, 'Backlog', 'backlog', 'a0'),
    },
    {
      v: 2,
      type: 'workflowState',
      id: TODO,
      op: 'upsert',
      actor: { type: 'system' },
      payload: state(TODO, 'Todo', 'unstarted', 'a0'),
    },
    {
      v: 3,
      type: 'workflowState',
      id: DOING,
      op: 'upsert',
      actor: { type: 'system' },
      payload: state(DOING, 'Doing', 'started', 'a0'),
    },
    {
      v: 4,
      type: 'workflowState',
      id: DONE,
      op: 'upsert',
      actor: { type: 'system' },
      payload: state(DONE, 'Done', 'completed', 'a0'),
    },
    {
      v: 5,
      type: 'workflowState',
      id: CANCELED,
      op: 'upsert',
      actor: { type: 'system' },
      payload: state(CANCELED, 'Canceled', 'canceled', 'a0'),
    },
  ]);
});

describe('list status group order', () => {
  it('reads finished work first, then moving, then waiting, then parked, then dead', () => {
    const groups = groupIssues([], store, 'state', 'manual', 'asc', TEAM, undefined, true, 'list');
    expect(groups.map((g) => g.label)).toEqual(['Done', 'Doing', 'Todo', 'Backlog', 'Canceled']);
  });

  it('keeps the pipeline when the layout is a board', () => {
    const groups = groupIssues([], store, 'state', 'manual', 'asc', TEAM, undefined, true, 'board');
    expect(groups.map((g) => g.label)).toEqual(['Backlog', 'Todo', 'Doing', 'Done', 'Canceled']);
  });

  it('keeps the pipeline when no layout is given, so callers that are not a view stay put', () => {
    const groups = groupIssues([], store, 'state', 'manual', 'asc', TEAM);
    expect(groups.map((g) => g.label)).toEqual(['Backlog', 'Todo', 'Doing', 'Done', 'Canceled']);
  });

  it('orders category groups the same way as named statuses', () => {
    const issues = [
      issue({ id: 'i-done', stateId: DONE }),
      issue({ id: 'i-todo', stateId: TODO }),
      issue({ id: 'i-doing', stateId: DOING }),
      issue({ id: 'i-backlog', stateId: BACKLOG }),
      issue({ id: 'i-canceled', stateId: CANCELED }),
    ];
    const list = groupIssues(
      issues,
      store,
      'stateCategory',
      'manual',
      'asc',
      TEAM,
      undefined,
      false,
      'list',
    );
    expect(list.map((g) => g.key)).toEqual([
      'completed',
      'started',
      'unstarted',
      'backlog',
      'canceled',
    ]);

    const board = groupIssues(
      issues,
      store,
      'stateCategory',
      'manual',
      'asc',
      TEAM,
      undefined,
      false,
      'board',
    );
    expect(board.map((g) => g.key)).toEqual([
      'backlog',
      'unstarted',
      'started',
      'completed',
      'canceled',
    ]);
  });
});
