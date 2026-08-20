import { fromWire } from '~/gql/enums';
import { uuidv7, type EntityOf, type EntityPatch, type UUID } from '~/store';
import { ApiError } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { CREATE_ASK_FORM, DELETE_ASK_FORM } from './operations';

type AskForm = EntityOf<'askForm'>;

export interface NewAskForm {
  readonly teamId: UUID;
  readonly name: string;
  readonly description?: string | undefined;
}

export async function createAskForm(engine: SyncEngine, input: NewAskForm): Promise<UUID> {
  const store = engine.store;
  const id = uuidv7();
  const now = new Date().toISOString();
  const provisional: AskForm = {
    id,
    workspaceId: store.workspaceId,
    teamId: input.teamId,
    name: input.name,
    description: input.description ?? '',
    token: '',
    createdAt: now,
    updatedAt: now,
  };

  try {
    const data = await engine.mutate<{ createAskForm: { askForm: AskForm } }>({
      mutation: CREATE_ASK_FORM,
      variables: {
        input: {
          teamId: input.teamId,
          name: input.name,
          description: input.description,
        },
      },
      optimistic: [{ type: 'askForm', id, before: null, after: provisional }],
    });
    const real = fromWire('askForm', data.createAskForm.askForm as EntityOf<'askForm'>);
    const patch: EntityPatch[] = [
      { type: 'askForm', id: real.id, before: provisional, after: real },
    ];
    if (real.id !== id) {
      patch.unshift({ type: 'askForm', id, before: null, after: null });
    }
    store.applyOptimistic(patch);
    return real.id;
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return id;
    throw error;
  }
}

export async function deleteAskForm(engine: SyncEngine, id: UUID): Promise<void> {
  const store = engine.store;
  const before = store.get('askForm', id);
  if (before === undefined) return;
  try {
    await engine.mutate({
      mutation: DELETE_ASK_FORM,
      variables: { id },
      optimistic: [{ type: 'askForm', id, before, after: null }],
    });
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}
