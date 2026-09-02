/**
 * Milestone progress, which is computed rather than stored.
 *
 * The weighting is the part worth pinning: a completed issue counts in full and a started
 * one counts half, so a milestone whose work is all under way reads as half done rather
 * than as not begun. An issue that has not been picked up counts for nothing.
 */

import { describe, expect, it } from 'vitest';

import {
  Store,
  type Change,
  type Entity,
  type Issue,
  type ProjectMilestone,
  type WorkflowState,
} from '~/store';

import { listProjectMilestones } from './helpers';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const PROJECT = '01900000-0000-7000-8000-000000000002';
const TEAM = '01900000-0000-7000-8000-000000000003';
const FIRST = '01900000-0000-7000-8000-000000000004';
const SECOND = '01900000-0000-7000-8000-000000000005';
const AT = '2026-01-01T00:00:00.000Z';

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return {
    v,
    type,
    id: entity.id,
    op: 'upsert',
    actor: { type: 'user', id: 'u1' },
    payload: entity,
  };
}

function state(id: string, category: WorkflowState['category']): WorkflowState {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    name: id,
    color: '#888888',
    category,
    position: id,
    isDefault: false,
    isSystem: false,
    createdAt: AT,
    updatedAt: AT,
  };
}

function milestone(id: string, name: string, sortOrder: string): ProjectMilestone {
  return {
    id,
    workspaceId: WORKSPACE,
    projectId: PROJECT,
    name,
    sortOrder,
    createdAt: AT,
    updatedAt: AT,
  };
}

function issue(id: string, stateId: string, milestoneId: string, completedAt?: string): Issue {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number: 1,
    identifier: `ENG-${id}`,
    title: id,
    description: '',
    stateId,
    priority: 0,
    sortOrder: id,
    dueDateSource: 'manual',
    projectId: PROJECT,
    projectMilestoneId: milestoneId,
    createdAt: AT,
    updatedAt: AT,
    ...(completedAt === undefined ? null : { completedAt }),
  };
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'workflowState', state('todo', 'unstarted')),
    upsert(2, 'workflowState', state('doing', 'started')),
    upsert(3, 'workflowState', state('done', 'completed')),
    upsert(4, 'projectMilestone', milestone(FIRST, 'Beta', 'a')),
    upsert(5, 'projectMilestone', milestone(SECOND, 'Launch', 'b')),
    upsert(6, 'issue', issue('i1', 'done', FIRST, AT)),
    upsert(7, 'issue', issue('i2', 'doing', FIRST)),
    upsert(8, 'issue', issue('i3', 'todo', SECOND)),
  ]);
  return store;
}

describe('listProjectMilestones', () => {
  it('counts a completed issue in full and a started one half', () => {
    const [beta] = listProjectMilestones(seeded(), PROJECT);

    expect(beta?.total).toBe(2);
    expect(beta?.done).toBe(1.5);
    expect(beta?.percent).toBe(75);
  });

  it('marks the first milestone with work left as the current focus', () => {
    const rows = listProjectMilestones(seeded(), PROJECT);

    expect(rows.map((row) => row.current)).toEqual([true, false]);
  });

  it('is empty for a project with no milestones', () => {
    expect(listProjectMilestones(new Store(WORKSPACE), PROJECT)).toEqual([]);
  });
});
