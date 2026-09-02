/**
 * One curve per project, over the same descendant set the rest of the screen counts.
 */

import { describe, expect, it } from 'vitest';

import { Store } from '~/store/store';
import type { Change, Entity, Issue, Project, ProjectStatus } from '~/store/types';

import { buildInitiativeGraph } from './computeInitiativeGraph';

const W = 'w1';
const AT = '2026-01-01T00:00:00.000Z';
const ACTOR = { type: 'user', id: 'u1' } as const;

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return { v, type, id: entity.id, op: 'upsert', actor: ACTOR, payload: entity };
}

function status(): ProjectStatus {
  return {
    id: 'ps1',
    workspaceId: W,
    name: 'In progress',
    color: '#5e6ad2',
    category: 'started',
    position: 'a',
    isDefault: false,
    createdAt: AT,
    updatedAt: AT,
  };
}

function project(id: string, name: string): Project {
  return {
    id,
    workspaceId: W,
    name,
    description: '',
    color: '#5e6ad2',
    statusId: 'ps1',
    priority: 0,
    sortOrder: id,
    updateSchedule: 'default',
    createdAt: AT,
    updatedAt: AT,
  };
}

function issue(id: string, projectId: string, createdAt: string, completedAt?: string): Issue {
  return {
    id,
    workspaceId: W,
    teamId: 't1',
    number: 1,
    identifier: `ENG-${id}`,
    title: id,
    description: '',
    stateId: 's1',
    priority: 3,
    sortOrder: id,
    dueDateSource: 'manual',
    projectId,
    createdAt,
    updatedAt: createdAt,
    ...(completedAt === undefined ? null : { completedAt }),
  };
}

function initiative(id: string, name: string): Entity {
  return {
    id,
    workspaceId: W,
    name,
    description: '',
    status: 'planned',
    priority: 0,
    sortOrder: id,
    createdAt: AT,
    updatedAt: AT,
  } as Entity;
}

function seeded(): Store {
  const store = new Store(W);
  store.applyChanges([
    upsert(1, 'projectStatus', status()),
    upsert(2, 'project', project('p1', 'Alpha')),
    upsert(3, 'project', project('p2', 'Beta')),
    upsert(4, 'initiative', initiative('parent', 'Company goals')),
    upsert(5, 'initiative', initiative('child', 'Platform')),
    upsert(6, 'initiativeRelation', {
      id: 'ir1',
      workspaceId: W,
      parentInitiativeId: 'parent',
      childInitiativeId: 'child',
      sortOrder: 'a',
      createdAt: AT,
    }),
    upsert(7, 'initiativeProject', {
      id: 'ip1',
      workspaceId: W,
      initiativeId: 'parent',
      projectId: 'p1',
      sortOrder: 'a',
      createdAt: AT,
    }),
    upsert(8, 'initiativeProject', {
      id: 'ip2',
      workspaceId: W,
      initiativeId: 'child',
      projectId: 'p2',
      sortOrder: 'a',
      createdAt: AT,
    }),
    upsert(9, 'issue', issue('i1', 'p1', AT, '2026-01-08T00:00:00.000Z')),
    upsert(10, 'issue', issue('i2', 'p1', AT)),
    upsert(11, 'issue', issue('i3', 'p2', AT, '2026-01-20T00:00:00.000Z')),
  ]);
  return store;
}

describe('buildInitiativeGraph', () => {
  it('draws one series per project, including a sub-initiative’s', () => {
    const data = buildInitiativeGraph(seeded(), 'parent');
    expect(data).not.toBeNull();
    expect(data!.series.map((row) => row.name).sort()).toEqual(['Alpha', 'Beta']);
    expect(data!.totalScope).toBe(3);
    expect(data!.totalCompleted).toBe(2);
  });

  it('accumulates completed issues rather than counting each week alone', () => {
    const data = buildInitiativeGraph(seeded(), 'parent')!;
    const alpha = data.series.find((row) => row.name === 'Alpha')!;
    expect(alpha.weeks.length).toBe(data.weekStarts.length);
    // Never falls: the curve is a running total, so a quiet week flattens it.
    for (let i = 1; i < alpha.weeks.length; i++) {
      expect(alpha.weeks[i]!.completed).toBeGreaterThanOrEqual(alpha.weeks[i - 1]!.completed);
    }
    expect(alpha.weeks[alpha.weeks.length - 1]!.completed).toBe(1);
    expect(alpha.completed).toBe(1);
    expect(alpha.total).toBe(2);
  });

  it('answers null when the initiative has no projects', () => {
    const store = new Store(W);
    store.applyChanges([upsert(1, 'initiative', initiative('lonely', 'Lonely'))]);
    expect(buildInitiativeGraph(store, 'lonely')).toBeNull();
  });

  it('answers null when the projects hold no issues', () => {
    const store = new Store(W);
    store.applyChanges([
      upsert(1, 'projectStatus', status()),
      upsert(2, 'project', project('p1', 'Alpha')),
      upsert(3, 'initiative', initiative('i', 'Fresh')),
      upsert(4, 'initiativeProject', {
        id: 'ip1',
        workspaceId: W,
        initiativeId: 'i',
        projectId: 'p1',
        sortOrder: 'a',
        createdAt: AT,
      }),
    ]);
    expect(buildInitiativeGraph(store, 'i')).toBeNull();
  });
});
