import { describe, expect, it } from 'vitest';

import { Store } from '~/store/store';
import type { Change, Entity, Project, ProjectDependency, ProjectStatus } from '~/store/types';

import { barEndX, buildProjectTimeline } from './computeProjectTimeline';

const NOW = '2026-02-10T12:00:00.000Z';
const ACTOR = { type: 'user', id: 'u1' } as const;

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return { v, type, id: entity.id, op: 'upsert', actor: ACTOR, payload: entity };
}

function status(id: string, category: ProjectStatus['category'] = 'started'): ProjectStatus {
  return {
    id,
    workspaceId: 'w',
    name: category,
    color: '#5e6ad2',
    category,
    position: 'a',
    isDefault: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function project(
  id: string,
  opts: Partial<Pick<Project, 'startDate' | 'targetDate' | 'priority' | 'sortOrder'>> = {},
): Project {
  return {
    id,
    workspaceId: 'w',
    name: id,
    description: '',
    color: '#5e6ad2',
    statusId: 'ps',
    priority: opts.priority ?? 0,
    sortOrder: opts.sortOrder ?? 'a',
    updateSchedule: 'default',
    startDate: opts.startDate,
    targetDate: opts.targetDate,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe('buildProjectTimeline', () => {
  it('places bars from start and target dates', () => {
    const store = new Store('w');
    store.applyChanges([
      upsert(1, 'projectStatus', status('ps')),
      upsert(2, 'project', project('p1', { startDate: '2026-01-01', targetDate: '2026-01-31' })),
    ]);

    const data = buildProjectTimeline(store, undefined, 'all', 'month', false, false);
    expect(data.bars).toHaveLength(1);
    expect(data.bars[0]?.projectId).toBe('p1');
    expect(data.bars[0]?.startDay).toBe('2026-01-01');
    expect(data.bars[0]?.endDay).toBe('2026-01-31');
    expect(data.bars[0]?.width).toBeGreaterThan(0);
  });

  it('lists projects without dates as unscheduled', () => {
    const store = new Store('w');
    store.applyChanges([
      upsert(1, 'projectStatus', status('ps')),
      upsert(2, 'project', project('p1')),
    ]);

    const data = buildProjectTimeline(store, undefined, 'all', 'month', false, false);
    expect(data.bars).toHaveLength(0);
    expect(data.unscheduled).toHaveLength(1);
    expect(data.unscheduled[0]?.id).toBe('p1');
  });

  it('draws dependency lines between dated projects', () => {
    const store = new Store('w');
    const dep: ProjectDependency = {
      id: 'd1',
      workspaceId: 'w',
      blockingProjectId: 'blocker',
      blockedProjectId: 'blocked',
      createdAt: NOW,
    };
    store.applyChanges([
      upsert(1, 'projectStatus', status('ps')),
      upsert(
        2,
        'project',
        project('blocker', { startDate: '2026-01-01', targetDate: '2026-01-15' }),
      ),
      upsert(
        3,
        'project',
        project('blocked', { startDate: '2026-01-20', targetDate: '2026-02-01' }),
      ),
      upsert(4, 'projectDependency', dep),
    ]);

    const data = buildProjectTimeline(store, undefined, 'all', 'month', false, true);
    expect(data.dependencies).toHaveLength(1);
    expect(data.dependencies[0]?.violated).toBe(false);
    expect(data.dependencies[0]?.x2).toBeGreaterThan(data.dependencies[0]?.x1 ?? 0);
  });

  it('marks violated dependencies in red logic', () => {
    const store = new Store('w');
    const dep: ProjectDependency = {
      id: 'd1',
      workspaceId: 'w',
      blockingProjectId: 'blocker',
      blockedProjectId: 'blocked',
      createdAt: NOW,
    };
    store.applyChanges([
      upsert(1, 'projectStatus', status('ps')),
      upsert(
        2,
        'project',
        project('blocker', { startDate: '2026-01-01', targetDate: '2026-02-15' }),
      ),
      upsert(
        3,
        'project',
        project('blocked', { startDate: '2026-01-10', targetDate: '2026-02-01' }),
      ),
      upsert(4, 'projectDependency', dep),
    ]);

    const data = buildProjectTimeline(store, undefined, 'all', 'month', false, true);
    expect(data.dependencies[0]?.violated).toBe(true);
  });
});

describe('barEndX', () => {
  it('returns the right edge of a bar', () => {
    expect(barEndX({ x: 10, width: 40 })).toBe(50);
  });
});
