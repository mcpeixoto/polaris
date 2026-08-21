import { describe, expect, it } from 'vitest';

import { Store, type Change, type Entity } from '~/store';

import { latestInitiativeUpdate, linkedProjectHealths } from './helpers';

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

describe('initiative update helpers', () => {
  it('derives initiative health from the newest live update', () => {
    const store = new Store('w1');
    store.applyChanges([
      upsert(1, 'initiative', {
        id: 'i1',
        workspaceId: 'w1',
        name: 'Reliability',
        description: '',
        status: 'active',
        priority: 0,
        sortOrder: 'a',
        createdAt: AT,
        updatedAt: AT,
      }),
      upsert(2, 'initiativeUpdate', {
        id: 'u-old',
        workspaceId: 'w1',
        initiativeId: 'i1',
        health: 'on_track',
        body: 'First',
        authorId: 'u1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: AT,
      }),
      upsert(3, 'initiativeUpdate', {
        id: 'u-new',
        workspaceId: 'w1',
        initiativeId: 'i1',
        health: 'at_risk',
        body: 'Second',
        authorId: 'u1',
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: AT,
      }),
    ]);
    expect(latestInitiativeUpdate(store, 'i1')?.health).toBe('at_risk');
  });

  it('rolls up linked project health including projects with no update', () => {
    const store = new Store('w1');
    store.applyChanges([
      upsert(1, 'initiative', {
        id: 'i1',
        workspaceId: 'w1',
        name: 'Reliability',
        description: '',
        status: 'active',
        priority: 0,
        sortOrder: 'a',
        createdAt: AT,
        updatedAt: AT,
      }),
      upsert(2, 'project', {
        id: 'p1',
        workspaceId: 'w1',
        name: 'API',
        description: '',
        color: '#000',
        statusId: 's1',
        priority: 0,
        sortOrder: 'a',
        updateSchedule: 'default',
        createdAt: AT,
        updatedAt: AT,
      }),
      upsert(3, 'project', {
        id: 'p2',
        workspaceId: 'w1',
        name: 'Web',
        description: '',
        color: '#000',
        statusId: 's1',
        priority: 0,
        sortOrder: 'b',
        updateSchedule: 'default',
        createdAt: AT,
        updatedAt: AT,
      }),
      upsert(4, 'initiativeProject', {
        id: 'ip1',
        workspaceId: 'w1',
        initiativeId: 'i1',
        projectId: 'p1',
        createdAt: AT,
      }),
      upsert(5, 'initiativeProject', {
        id: 'ip2',
        workspaceId: 'w1',
        initiativeId: 'i1',
        projectId: 'p2',
        createdAt: AT,
      }),
      upsert(6, 'projectUpdate', {
        id: 'pu1',
        workspaceId: 'w1',
        projectId: 'p1',
        health: 'off_track',
        body: '',
        authorId: 'u1',
        createdAt: AT,
        updatedAt: AT,
      }),
    ]);
    expect(linkedProjectHealths(store, 'i1')).toEqual([
      { projectId: 'p1', name: 'API', health: 'off_track' },
      { projectId: 'p2', name: 'Web', health: null },
    ]);
  });
});
