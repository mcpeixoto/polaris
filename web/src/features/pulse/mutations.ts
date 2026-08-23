import { fromWire } from '~/gql/enums';
import { uuidv7, type EntityOf, type UUID } from '~/store';
import { ApiError } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { CREATE_PULSE_FEED, DELETE_PULSE_FEED, UPDATE_PULSE_FEED } from './operations';

type PulseFeed = EntityOf<'pulseFeed'>;

export interface NewPulseFeed {
  readonly userId: UUID;
  readonly name: string;
  readonly projectIds: readonly UUID[];
}

export interface PulseFeedPatch {
  readonly id: UUID;
  readonly name?: string | undefined;
  readonly projectIds?: readonly UUID[] | undefined;
}

export async function createPulseFeed(engine: SyncEngine, input: NewPulseFeed): Promise<UUID> {
  const store = engine.store;
  const id = uuidv7();
  const now = new Date().toISOString();
  const provisional: PulseFeed = {
    id,
    workspaceId: store.workspaceId,
    userId: input.userId,
    name: input.name,
    projectIds: input.projectIds,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const data = await engine.mutate<{ createPulseFeed: { pulseFeed: PulseFeed } }>({
      mutation: CREATE_PULSE_FEED,
      variables: {
        input: {
          name: input.name,
          projectIds: input.projectIds,
        },
      },
      optimistic: [{ type: 'pulseFeed', id, before: null, after: provisional }],
      reconcile: {
        type: 'pulseFeed',
        provisionalId: id,
        path: ['createPulseFeed', 'pulseFeed'],
        // And from the delta stream, which usually gets here first — the socket pushes the
        // row the moment the mutation commits, while the response is still travelling back.
        // Whose feed and what they called it.
        match: ['userId', 'name'],
      },
    });
    return data.createPulseFeed.pulseFeed.id;
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return id;
    throw error;
  }
}

export async function updatePulseFeed(engine: SyncEngine, input: PulseFeedPatch): Promise<void> {
  const store = engine.store;
  const before = store.get('pulseFeed', input.id);
  if (before === undefined) return;
  const provisional: PulseFeed = {
    ...before,
    name: input.name ?? before.name,
    projectIds: input.projectIds ?? before.projectIds,
    updatedAt: new Date().toISOString(),
  };
  try {
    const data = await engine.mutate<{ updatePulseFeed: { pulseFeed: PulseFeed } }>({
      mutation: UPDATE_PULSE_FEED,
      variables: {
        input: {
          id: input.id,
          name: input.name,
          projectIds: input.projectIds,
        },
      },
      optimistic: [{ type: 'pulseFeed', id: input.id, before, after: provisional }],
    });
    const real = fromWire('pulseFeed', data.updatePulseFeed.pulseFeed as EntityOf<'pulseFeed'>);
    store.applyOptimistic([{ type: 'pulseFeed', id: real.id, before: provisional, after: real }]);
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

export async function deletePulseFeed(engine: SyncEngine, id: UUID): Promise<void> {
  const store = engine.store;
  const before = store.get('pulseFeed', id);
  if (before === undefined) return;
  try {
    await engine.mutate({
      mutation: DELETE_PULSE_FEED,
      variables: { id },
      optimistic: [{ type: 'pulseFeed', id, before, after: null }],
    });
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}
