import { fromWire } from '~/gql/enums';
import { uuidv7, type EntityOf, type EntityPatch, type UUID } from '~/store';
import { ApiError } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { ARCHIVE_DOCUMENT, CREATE_DOCUMENT, DELETE_DOCUMENT, UPDATE_DOCUMENT } from './operations';

type Document = EntityOf<'document'>;

export interface NewDocument {
  readonly teamId: UUID;
  readonly projectId?: UUID | undefined;
  readonly title: string;
  readonly body?: string | undefined;
}

export interface DocumentPatch {
  readonly id: UUID;
  readonly title?: string | undefined;
  readonly body?: string | undefined;
}

export async function createDocument(engine: SyncEngine, input: NewDocument): Promise<UUID> {
  const store = engine.store;
  const id = uuidv7();
  const now = new Date().toISOString();
  const provisional: Document = {
    id,
    workspaceId: store.workspaceId,
    teamId: input.teamId,
    ...(input.projectId === undefined ? null : { projectId: input.projectId }),
    title: input.title,
    body: input.body ?? '',
    sortOrder: 'a',
    createdAt: now,
    updatedAt: now,
  };

  try {
    const data = await engine.mutate<{ createDocument: { document: Document } }>({
      mutation: CREATE_DOCUMENT,
      variables: {
        input: {
          teamId: input.teamId,
          projectId: input.projectId,
          title: input.title,
          body: input.body ?? '',
        },
      },
      optimistic: [{ type: 'document', id, before: null, after: provisional }],
    });
    const real = fromWire('document', data.createDocument.document as EntityOf<'document'>);
    const patch: EntityPatch[] = [
      { type: 'document', id: real.id, before: provisional, after: real },
    ];
    if (real.id !== id) {
      patch.unshift({ type: 'document', id, before: null, after: null });
    }
    store.applyOptimistic(patch);
    return real.id;
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return id;
    throw error;
  }
}

export async function updateDocument(engine: SyncEngine, patch: DocumentPatch): Promise<void> {
  const store = engine.store;
  const before = store.get('document', patch.id);
  if (before === undefined) return;

  const after: Document = {
    ...before,
    ...(patch.title === undefined ? null : { title: patch.title }),
    ...(patch.body === undefined ? null : { body: patch.body }),
    updatedAt: new Date().toISOString(),
  };

  try {
    const data = await engine.mutate<{ updateDocument: { document: Document } }>({
      mutation: UPDATE_DOCUMENT,
      variables: {
        input: {
          id: patch.id,
          title: patch.title,
          body: patch.body,
        },
      },
      optimistic: [{ type: 'document', id: patch.id, before, after }],
    });
    const real = fromWire('document', data.updateDocument.document as EntityOf<'document'>);
    store.applyOptimistic([{ type: 'document', id: real.id, before: after, after: real }]);
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

export async function archiveDocument(
  engine: SyncEngine,
  id: UUID,
  archived: boolean,
): Promise<void> {
  const store = engine.store;
  const before = store.get('document', id) ?? null;
  try {
    await engine.mutate({
      mutation: ARCHIVE_DOCUMENT,
      variables: { id, archived },
      optimistic:
        before === null ? [] : [{ type: 'document', id, before, after: archived ? null : before }],
    });
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

export async function deleteDocument(engine: SyncEngine, id: UUID): Promise<void> {
  const store = engine.store;
  const before = store.get('document', id) ?? null;
  try {
    await engine.mutate({
      mutation: DELETE_DOCUMENT,
      variables: { id },
      optimistic: before === null ? [] : [{ type: 'document', id, before, after: null }],
    });
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}
