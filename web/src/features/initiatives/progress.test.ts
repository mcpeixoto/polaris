/**
 * The rollup counts what the health strip counts — the whole descendant set, once each.
 */

import { describe, expect, it } from 'vitest';

import { linkedProjectHealths } from '~/features/initiative-updates/helpers';
import { Store } from '~/store/store';
import type { Change, Entity, Issue, Project, ProjectStatus } from '~/store/types';

import { initiativeProgress, listInitiativeProjectRows, projectProgress } from './progress';

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

function project(id: string, name: string, extra: Partial<Project> = {}): Project {
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
    ...extra,
  };
}

function issue(id: string, projectId: string, completed: boolean): Issue {
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
    createdAt: AT,
    updatedAt: AT,
    ...(completed ? { completedAt: '2026-01-05T00:00:00.000Z' } : null),
  };
}

/**
 * parent → child, parent owns "Alpha", child owns "Beta", and both own "Shared" so the
 * walk has a project it can reach twice.
 */
function seeded(): Store {
  const store = new Store(W);
  store.applyChanges([
    upsert(1, 'projectStatus', status()),
    upsert(2, 'project', project('p1', 'Alpha', { leadId: 'u1' })),
    upsert(3, 'project', project('p2', 'Beta', { targetDate: '2026-06-01' })),
    upsert(4, 'project', project('p3', 'Shared')),
    upsert(5, 'user', {
      id: 'u1',
      workspaceId: W,
      name: 'ada',
      displayName: 'Ada Lovelace',
      timezone: 'UTC',
      role: 'admin',
      status: 'active',
      kind: 'human',
      createdAt: AT,
      updatedAt: AT,
    }),
    upsert(6, 'initiative', {
      id: 'parent',
      workspaceId: W,
      name: 'Company goals',
      description: '',
      status: 'planned',
      priority: 0,
      sortOrder: 'a',
      createdAt: AT,
      updatedAt: AT,
    }),
    upsert(7, 'initiative', {
      id: 'child',
      workspaceId: W,
      name: 'Platform',
      description: '',
      status: 'planned',
      priority: 0,
      sortOrder: 'b',
      createdAt: AT,
      updatedAt: AT,
    }),
    upsert(8, 'initiativeRelation', {
      id: 'ir1',
      workspaceId: W,
      parentInitiativeId: 'parent',
      childInitiativeId: 'child',
      sortOrder: 'a',
      createdAt: AT,
    }),
    upsert(9, 'initiativeProject', {
      id: 'ip1',
      workspaceId: W,
      initiativeId: 'parent',
      projectId: 'p1',
      sortOrder: 'a',
      createdAt: AT,
    }),
    upsert(10, 'initiativeProject', {
      id: 'ip2',
      workspaceId: W,
      initiativeId: 'child',
      projectId: 'p2',
      sortOrder: 'a',
      createdAt: AT,
    }),
    upsert(11, 'initiativeProject', {
      id: 'ip3',
      workspaceId: W,
      initiativeId: 'parent',
      projectId: 'p3',
      sortOrder: 'b',
      createdAt: AT,
    }),
    upsert(12, 'initiativeProject', {
      id: 'ip4',
      workspaceId: W,
      initiativeId: 'child',
      projectId: 'p3',
      sortOrder: 'b',
      createdAt: AT,
    }),
    upsert(13, 'issue', issue('i1', 'p1', true)),
    upsert(14, 'issue', issue('i2', 'p1', false)),
    upsert(15, 'issue', issue('i3', 'p2', true)),
    upsert(16, 'issue', issue('i4', 'p3', false)),
  ]);
  return store;
}

describe('initiativeProgress', () => {
  it('counts issues across descendants, each project once', () => {
    const store = seeded();
    expect(initiativeProgress(store, 'parent')).toEqual({ completed: 2, total: 4, percent: 50 });
  });

  it('counts only the sub-initiative’s own reach from the sub-initiative', () => {
    const store = seeded();
    expect(initiativeProgress(store, 'child')).toEqual({ completed: 1, total: 2, percent: 50 });
  });

  it('reports zero rather than complete when there is nothing to do', () => {
    const store = new Store(W);
    store.applyChanges([
      upsert(1, 'initiative', {
        id: 'empty',
        workspaceId: W,
        name: 'Empty',
        description: '',
        status: 'planned',
        priority: 0,
        sortOrder: 'a',
        createdAt: AT,
        updatedAt: AT,
      }),
    ]);
    expect(initiativeProgress(store, 'empty')).toEqual({ completed: 0, total: 0, percent: 0 });
  });

  it('leaves an archived project out, exactly as the health strip does', () => {
    const store = seeded();
    store.applyChanges([
      upsert(20, 'project', project('p1', 'Alpha', { archivedAt: AT, leadId: 'u1' })),
    ]);
    expect(initiativeProgress(store, 'parent')).toEqual({ completed: 1, total: 2, percent: 50 });
    expect(linkedProjectHealths(store, 'parent').map((row) => row.name)).toEqual([
      'Beta',
      'Shared',
    ]);
  });
});

describe('projectProgress', () => {
  it('counts completed against total for one project', () => {
    expect(projectProgress(seeded(), 'p1')).toEqual({ completed: 1, total: 2, percent: 50 });
  });
});

describe('listInitiativeProjectRows', () => {
  it('lists the same projects the health strip does', () => {
    const store = seeded();
    expect(listInitiativeProjectRows(store, 'parent').map((row) => row.name)).toEqual(
      linkedProjectHealths(store, 'parent').map((row) => row.name),
    );
  });

  it('marks an inherited project as not directly linked', () => {
    const rows = listInitiativeProjectRows(seeded(), 'parent');
    const direct = new Map(rows.map((row) => [row.name, row.direct]));
    expect(direct.get('Alpha')).toBe(true);
    expect(direct.get('Beta')).toBe(false);
  });

  it('carries the status, lead, target date and progress a row draws', () => {
    const rows = listInitiativeProjectRows(seeded(), 'parent');
    const alpha = rows.find((row) => row.name === 'Alpha')!;
    expect(alpha.statusCategory).toBe('started');
    expect(alpha.leadName).not.toBeNull();
    expect(alpha.progress.percent).toBe(50);
    expect(rows.find((row) => row.name === 'Beta')!.targetDate).toBe('2026-06-01');
  });
});
