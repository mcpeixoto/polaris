/**
 * Creating, retargeting and removing a milestone.
 *
 * `projectMilestone` was a replicated row with no writer anywhere in the client — the
 * timeline drew ticks for milestones nothing could create. The reconciliation matters as
 * much as the write: the API mints the id, so the stand-in is drawn under a client id and
 * has to be pairable from the outbox, not only from the tail of this await.
 */

import { describe, expect, it, vi } from 'vitest';

import { Store, type Change, type Entity, type ProjectMilestone } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import {
  createProjectMilestone,
  deleteProjectMilestone,
  updateProjectMilestone,
} from './mutations';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const PROJECT = '01900000-0000-7000-8000-000000000002';
const MILESTONE = '01900000-0000-7000-8000-000000000003';
const AT = '2026-01-01T00:00:00.000Z';

const existing: ProjectMilestone = {
  id: MILESTONE,
  workspaceId: WORKSPACE,
  projectId: PROJECT,
  name: 'Beta',
  targetDate: '2026-03-01',
  sortOrder: 'a',
  createdAt: AT,
  updatedAt: AT,
};

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

function seeded() {
  const store = new Store(WORKSPACE);
  store.applyChanges([upsert(1, 'projectMilestone', existing)]);
  const mutate = vi
    .fn()
    .mockResolvedValue({ createProjectMilestone: { milestone: { id: 'server-id' } } });
  return { store, mutate, engine: { store, mutate } as unknown as SyncEngine };
}

describe('createProjectMilestone', () => {
  it('appends after the milestones already there, and pairs on project and name', async () => {
    const { engine, mutate } = seeded();

    await createProjectMilestone(engine, { projectId: PROJECT, name: '  Launch  ' });

    const call = mutate.mock.calls[0]![0];
    expect(call.variables.input).toEqual({ projectId: PROJECT, name: 'Launch' });
    expect(call.optimistic[0].after.sortOrder > existing.sortOrder).toBe(true);
    // Names repeat across projects, so the project is half of what identifies the row.
    expect(call.reconcile.match).toEqual(['projectId', 'name']);
  });

  it('refuses a name that is only whitespace, without reaching the API', async () => {
    const { engine, mutate } = seeded();

    expect(await createProjectMilestone(engine, { projectId: PROJECT, name: '   ' })).toBe('');
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe('updateProjectMilestone', () => {
  it('spells an emptied target date as the API does', async () => {
    const { engine, mutate } = seeded();

    await updateProjectMilestone(engine, MILESTONE, { targetDate: null });

    expect(mutate.mock.calls[0]![0].variables.input).toEqual({ id: MILESTONE, clearTarget: true });
    expect(mutate.mock.calls[0]![0].optimistic[0].after.targetDate).toBeUndefined();
  });

  it('renames without touching the date', async () => {
    const { engine, mutate } = seeded();

    await updateProjectMilestone(engine, MILESTONE, { name: 'Public beta' });

    expect(mutate.mock.calls[0]![0].variables.input).toEqual({
      id: MILESTONE,
      name: 'Public beta',
    });
  });
});

describe('deleteProjectMilestone', () => {
  it('takes the row out locally in the same frame', async () => {
    const { engine, mutate } = seeded();

    await deleteProjectMilestone(engine, MILESTONE);

    expect(mutate.mock.calls[0]![0].optimistic[0]).toMatchObject({
      type: 'projectMilestone',
      id: MILESTONE,
      after: null,
    });
  });

  it('does nothing for a milestone the replica has never seen', async () => {
    const { engine, mutate } = seeded();

    await deleteProjectMilestone(engine, 'nobody');

    expect(mutate).not.toHaveBeenCalled();
  });
});
