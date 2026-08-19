import { fromWire } from '~/gql/enums';
import { uuidv7, type EntityOf, type EntityPatch, type UUID } from '~/store';
import { ApiError } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import {
  ADD_INITIATIVE_PROJECT,
  CREATE_INITIATIVE,
  REMOVE_INITIATIVE_PROJECT,
  UPDATE_INITIATIVE,
} from './operations';

type Initiative = EntityOf<'initiative'>;
type InitiativeProject = EntityOf<'initiativeProject'>;

export interface NewInitiative {
  readonly name: string;
  readonly description?: string | undefined;
  readonly ownerId?: UUID | undefined;
}

export async function createInitiative(engine: SyncEngine, input: NewInitiative): Promise<UUID> {
  const store = engine.store;
  const id = uuidv7();
  const now = new Date().toISOString();
  const provisional: Initiative = {
    id,
    workspaceId: store.workspaceId,
    name: input.name,
    description: input.description ?? '',
    status: 'planned',
    priority: 0,
    sortOrder: 'z',
    ...(input.ownerId === undefined ? null : { ownerId: input.ownerId }),
    createdAt: now,
    updatedAt: now,
  };

  try {
    const data = await engine.mutate<{ createInitiative: { initiative: Initiative } }>({
      mutation: CREATE_INITIATIVE,
      variables: {
        input: {
          name: input.name,
          description: input.description ?? '',
          ownerId: input.ownerId,
        },
      },
      optimistic: [{ type: 'initiative', id, before: null, after: provisional }],
    });
    const real = fromWire('initiative', data.createInitiative.initiative as EntityOf<'initiative'>);
    const patch: EntityPatch[] = [
      { type: 'initiative', id: real.id, before: provisional, after: real },
    ];
    if (real.id !== id) {
      patch.unshift({ type: 'initiative', id, before: null, after: null });
    }
    store.applyOptimistic(patch);
    return real.id;
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return id;
    throw error;
  }
}

export async function updateInitiativeDescription(
  engine: SyncEngine,
  id: UUID,
  description: string,
): Promise<void> {
  const store = engine.store;
  const before = store.get('initiative', id);
  if (before === undefined) return;

  const after: Initiative = { ...before, description, updatedAt: new Date().toISOString() };

  try {
    const data = await engine.mutate<{ updateInitiative: { initiative: Initiative } }>({
      mutation: UPDATE_INITIATIVE,
      variables: { input: { id, description } },
      optimistic: [{ type: 'initiative', id, before, after }],
    });
    const real = fromWire('initiative', data.updateInitiative.initiative as EntityOf<'initiative'>);
    store.applyOptimistic([{ type: 'initiative', id: real.id, before: after, after: real }]);
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

export async function addInitiativeProject(
  engine: SyncEngine,
  initiativeId: UUID,
  projectId: UUID,
): Promise<void> {
  const store = engine.store;
  const id = uuidv7();
  const now = new Date().toISOString();
  const provisional: InitiativeProject = {
    id,
    workspaceId: store.workspaceId,
    initiativeId,
    projectId,
    createdAt: now,
  };

  try {
    const data = await engine.mutate<{
      addInitiativeProject: { initiativeProject: InitiativeProject };
    }>({
      mutation: ADD_INITIATIVE_PROJECT,
      variables: { initiativeId, projectId },
      optimistic: [{ type: 'initiativeProject', id, before: null, after: provisional }],
    });
    const real = fromWire(
      'initiativeProject',
      data.addInitiativeProject.initiativeProject as EntityOf<'initiativeProject'>,
    );
    const patch: EntityPatch[] = [
      { type: 'initiativeProject', id: real.id, before: provisional, after: real },
    ];
    if (real.id !== id) {
      patch.unshift({ type: 'initiativeProject', id, before: null, after: null });
    }
    store.applyOptimistic(patch);
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

export async function removeInitiativeProject(
  engine: SyncEngine,
  initiativeId: UUID,
  projectId: UUID,
): Promise<void> {
  const store = engine.store;
  const link = [...store.initiativeProjectIdsFor(initiativeId)]
    .map((rowId) => store.get('initiativeProject', rowId))
    .find((row) => row?.projectId === projectId);
  if (link === undefined) return;

  try {
    await engine.mutate({
      mutation: REMOVE_INITIATIVE_PROJECT,
      variables: { initiativeId, projectId },
      optimistic: [{ type: 'initiativeProject', id: link.id, before: link, after: null }],
    });
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}
