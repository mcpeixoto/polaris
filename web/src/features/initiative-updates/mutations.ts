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

import {
  CREATE_INITIATIVE_UPDATE,
  DELETE_INITIATIVE_UPDATE,
  UPDATE_INITIATIVE_UPDATE,
} from './operations';

type InitiativeUpdate = EntityOf<'initiativeUpdate'>;

export interface NewInitiativeUpdate {
  readonly initiativeId: UUID;
  readonly health: ProjectUpdateHealth;
  readonly body?: string | undefined;
  /** The viewer. Absent only while the viewer query is still in flight. */
  readonly authorId?: UUID | undefined;
}

export interface InitiativeUpdatePatch {
  readonly id: UUID;
  readonly health?: ProjectUpdateHealth | undefined;
  readonly body?: string | undefined;
}

export async function createInitiativeUpdate(
  engine: SyncEngine,
  input: NewInitiativeUpdate,
): Promise<UUID> {
  const store = engine.store;
  const id = uuidv7();
  const now = new Date().toISOString();
  const provisional: InitiativeUpdate = {
    id,
    workspaceId: store.workspaceId,
    initiativeId: input.initiativeId,
    health: input.health,
    body: input.body ?? '',
    authorId: input.authorId ?? id,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const data = await engine.mutate<{
      createInitiativeUpdate: { initiativeUpdate: InitiativeUpdate };
    }>({
      mutation: CREATE_INITIATIVE_UPDATE,
      variables: {
        input: {
          initiativeId: input.initiativeId,
          health: toWire(input.health),
          body: input.body ?? '',
        },
      },
      optimistic: [{ type: 'initiativeUpdate', id, before: null, after: provisional }],
    });
    const real = fromWire(
      'initiativeUpdate',
      data.createInitiativeUpdate.initiativeUpdate as EntityOf<'initiativeUpdate'>,
    );
    const patch: EntityPatch[] = [
      { type: 'initiativeUpdate', id: real.id, before: provisional, after: real },
    ];
    if (real.id !== id) {
      patch.unshift({ type: 'initiativeUpdate', id, before: null, after: null });
    }
    store.applyOptimistic(patch);
    return real.id;
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return id;
    throw error;
  }
}

export async function updateInitiativeUpdate(
  engine: SyncEngine,
  patch: InitiativeUpdatePatch,
): Promise<void> {
  const store = engine.store;
  const before = store.get('initiativeUpdate', patch.id);
  if (before === undefined) return;

  const after: InitiativeUpdate = {
    ...before,
    ...(patch.health === undefined ? null : { health: patch.health }),
    ...(patch.body === undefined ? null : { body: patch.body }),
    editedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    const data = await engine.mutate<{
      updateInitiativeUpdate: { initiativeUpdate: InitiativeUpdate };
    }>({
      mutation: UPDATE_INITIATIVE_UPDATE,
      variables: {
        input: {
          id: patch.id,
          ...(patch.health === undefined ? null : { health: toWire(patch.health) }),
          ...(patch.body === undefined ? null : { body: patch.body }),
        },
      },
      optimistic: [{ type: 'initiativeUpdate', id: patch.id, before, after }],
    });
    const real = fromWire(
      'initiativeUpdate',
      data.updateInitiativeUpdate.initiativeUpdate as EntityOf<'initiativeUpdate'>,
    );
    store.applyOptimistic([{ type: 'initiativeUpdate', id: real.id, before: after, after: real }]);
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

export async function deleteInitiativeUpdate(engine: SyncEngine, id: UUID): Promise<void> {
  const store = engine.store;
  const before = store.get('initiativeUpdate', id);
  if (before === undefined) return;

  try {
    await engine.mutate({
      mutation: DELETE_INITIATIVE_UPDATE,
      variables: { id },
      optimistic: [{ type: 'initiativeUpdate', id, before, after: null }],
    });
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}
