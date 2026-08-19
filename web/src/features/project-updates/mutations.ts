import { fromWire, toWire } from '~/gql/enums';
import {
  uuidv7,
  type EntityOf,
  type EntityPatch,
  type ProjectUpdateHealth,
  type UUID,
} from '~/store';
import { ApiError } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { CREATE_PROJECT_UPDATE, DELETE_PROJECT_UPDATE, UPDATE_PROJECT_UPDATE } from './operations';

type ProjectUpdate = EntityOf<'projectUpdate'>;

export interface NewProjectUpdate {
  readonly projectId: UUID;
  readonly health: ProjectUpdateHealth;
  readonly body?: string | undefined;
  /** The viewer. Absent only while the viewer query is still in flight. */
  readonly authorId?: UUID | undefined;
}

export interface ProjectUpdatePatch {
  readonly id: UUID;
  readonly health?: ProjectUpdateHealth | undefined;
  readonly body?: string | undefined;
}

export async function createProjectUpdate(
  engine: SyncEngine,
  input: NewProjectUpdate,
): Promise<UUID> {
  const store = engine.store;
  const id = uuidv7();
  const now = new Date().toISOString();
  const provisional: ProjectUpdate = {
    id,
    workspaceId: store.workspaceId,
    projectId: input.projectId,
    health: input.health,
    body: input.body ?? '',
    authorId: input.authorId ?? id,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const data = await engine.mutate<{ createProjectUpdate: { projectUpdate: ProjectUpdate } }>({
      mutation: CREATE_PROJECT_UPDATE,
      variables: {
        input: {
          projectId: input.projectId,
          health: toWire(input.health),
          body: input.body ?? '',
        },
      },
      optimistic: [{ type: 'projectUpdate', id, before: null, after: provisional }],
    });
    const real = fromWire(
      'projectUpdate',
      data.createProjectUpdate.projectUpdate as EntityOf<'projectUpdate'>,
    );
    const patch: EntityPatch[] = [
      { type: 'projectUpdate', id: real.id, before: provisional, after: real },
    ];
    if (real.id !== id) {
      patch.unshift({ type: 'projectUpdate', id, before: null, after: null });
    }
    store.applyOptimistic(patch);
    return real.id;
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return id;
    throw error;
  }
}

export async function updateProjectUpdate(
  engine: SyncEngine,
  patch: ProjectUpdatePatch,
): Promise<void> {
  const store = engine.store;
  const before = store.get('projectUpdate', patch.id);
  if (before === undefined) return;

  const after: ProjectUpdate = {
    ...before,
    ...(patch.health === undefined ? null : { health: patch.health }),
    ...(patch.body === undefined ? null : { body: patch.body }),
    editedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    const data = await engine.mutate<{ updateProjectUpdate: { projectUpdate: ProjectUpdate } }>({
      mutation: UPDATE_PROJECT_UPDATE,
      variables: {
        input: {
          id: patch.id,
          ...(patch.health === undefined ? null : { health: toWire(patch.health) }),
          ...(patch.body === undefined ? null : { body: patch.body }),
        },
      },
      optimistic: [{ type: 'projectUpdate', id: patch.id, before, after }],
    });
    const real = fromWire(
      'projectUpdate',
      data.updateProjectUpdate.projectUpdate as EntityOf<'projectUpdate'>,
    );
    store.applyOptimistic([{ type: 'projectUpdate', id: real.id, before: after, after: real }]);
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

export async function deleteProjectUpdate(engine: SyncEngine, id: UUID): Promise<void> {
  const store = engine.store;
  const before = store.get('projectUpdate', id);
  if (before === undefined) return;

  try {
    await engine.mutate({
      mutation: DELETE_PROJECT_UPDATE,
      variables: { id },
      optimistic: [{ type: 'projectUpdate', id, before, after: null }],
    });
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}
