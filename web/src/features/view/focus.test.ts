/**
 * Focus bucketing for My Issues Assigned.
 *
 * The product claim is a curated route: urgent → SLA → blockers → cycle → active →
 * triage → backlog → completed, exclusive first-match, empty sections omitted, started
 * work first within a section.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { Store } from '~/store';
import type { Issue, IssueRelation, WorkflowState } from '~/store';
import { groupIssues } from './group';
import { focusKeyOf, sortFocusIssues } from './focus';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const TEAM = '01900000-0000-7000-8000-0000000000b1';
const AT = '2026-01-01T00:00:00Z';

const TODO = '01900000-0000-7000-8000-0000000000c1';
const DOING = '01900000-0000-7000-8000-0000000000c2';
const DONE = '01900000-0000-7000-8000-0000000000c3';
const TRIAGE = '01900000-0000-7000-8000-0000000000c4';
const BACKLOG = '01900000-0000-7000-8000-0000000000c5';

function state(id: string, name: string, category: WorkflowState['category']): WorkflowState {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    name,
    color: '#888',
    category,
    position: 'a0',
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

function blocks(id: string, from: string, to: string): IssueRelation {
  return {
    id,
    workspaceId: WORKSPACE,
    issueId: from,
    relatedIssueId: to,
    type: 'blocks',
    teamId: TEAM,
    relatedTeamId: TEAM,
    createdAt: AT,
  };
}

let store: Store;
let version = 0;

beforeEach(async () => {
  version = 0;
  store = await Store.open(WORKSPACE, {});
  store.applyChanges([
    upsert(++version, 'workflowState', TODO, state(TODO, 'Todo', 'unstarted')),
    upsert(++version, 'workflowState', DOING, state(DOING, 'Doing', 'started')),
    upsert(++version, 'workflowState', DONE, state(DONE, 'Done', 'completed')),
    upsert(++version, 'workflowState', TRIAGE, state(TRIAGE, 'Triage', 'triage')),
    upsert(++version, 'workflowState', BACKLOG, state(BACKLOG, 'Backlog', 'backlog')),
  ]);
});

describe('focusKeyOf', () => {
  it('puts urgent ahead of every later rule, including SLA and blockers', () => {
    const urgent = issue({
      id: 'u',
      priority: 1,
      dueDateSource: 'sla',
      cycleId: 'cycle-1',
    });
    store.applyChanges([
      upsert(++version, 'issue', 'u', urgent),
      upsert(++version, 'issueRelation', 'r1', blocks('r1', 'u', 'other')),
    ]);
    expect(focusKeyOf(urgent, store)).toBe('urgent');
  });

  it('routes SLA, blockers, cycle, triage, backlog and completed in order', () => {
    const rows = [
      issue({ id: 'sla', dueDateSource: 'sla' }),
      issue({ id: 'block', title: 'Blocks' }),
      issue({ id: 'cycle', cycleId: 'c1' }),
      issue({ id: 'triage', stateId: TRIAGE }),
      issue({ id: 'backlog', stateId: BACKLOG }),
      issue({ id: 'done', stateId: DONE }),
      issue({ id: 'active', stateId: TODO }),
    ];
    store.applyChanges([
      ...rows.map((row) => upsert(++version, 'issue', row.id, row)),
      upsert(++version, 'issueRelation', 'r1', blocks('r1', 'block', 'active')),
    ]);

    expect(focusKeyOf(rows[0]!, store)).toBe('sla');
    expect(focusKeyOf(rows[1]!, store)).toBe('blockers');
    expect(focusKeyOf(rows[2]!, store)).toBe('cycle');
    expect(focusKeyOf(rows[3]!, store)).toBe('triage');
    expect(focusKeyOf(rows[4]!, store)).toBe('backlog');
    expect(focusKeyOf(rows[5]!, store)).toBe('completed');
    expect(focusKeyOf(rows[6]!, store)).toBe('active');
  });
});

describe('Focus grouping', () => {
  it('orders sections as the curated route and omits empty ones', () => {
    const rows = [
      issue({ id: 'done', stateId: DONE, priority: 2 }),
      issue({ id: 'urgent', priority: 1 }),
      issue({ id: 'active', stateId: DOING, priority: 3 }),
    ];
    const groups = groupIssues(rows, store, 'focus', 'manual', 'asc', undefined, undefined, false);
    expect(groups.map((g) => g.key)).toEqual(['urgent', 'active', 'completed']);
    expect(groups.map((g) => g.label)).toEqual(['Urgent', 'Active', 'Completed']);
  });

  it('puts started work before unstarted within a section, then by priority', () => {
    const rows = [
      issue({ id: 'low-todo', stateId: TODO, priority: 4 }),
      issue({ id: 'high-todo', stateId: TODO, priority: 2 }),
      issue({ id: 'med-doing', stateId: DOING, priority: 3 }),
    ];
    expect(sortFocusIssues(rows, store).map((i) => i.id)).toEqual([
      'med-doing',
      'high-todo',
      'low-todo',
    ]);
  });

  it('keeps Focus order even when the display menu asks for updated', () => {
    const rows = [issue({ id: 'done', stateId: DONE }), issue({ id: 'urgent', priority: 1 })];
    const groups = groupIssues(
      rows,
      store,
      'focus',
      'updatedAt',
      'desc',
      undefined,
      undefined,
      false,
    );
    expect(groups.map((g) => g.key)).toEqual(['urgent', 'completed']);
  });
});

function upsert(
  v: number,
  type: 'workflowState' | 'issue' | 'issueRelation',
  id: string,
  payload: WorkflowState | Issue | IssueRelation,
) {
  return { v, type, id, op: 'upsert' as const, actor: { type: 'system' as const }, payload };
}
