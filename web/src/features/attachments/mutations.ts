/**
 * Link attachments on an issue.
 *
 * URL-idempotent: posting the same URL twice is an update of the existing card, which is
 * why an integration can be stateless and why the optimistic path here keys the stand-in
 * by a client-minted id that the server's response then replaces.
 */

import { fromWire } from '~/gql/enums';
import { CREATE_ATTACHMENT, DELETE_ATTACHMENT } from '~/gql/operations';
import { uuidv7, type Attachment, type EntityOf, type EntityPatch, type UUID } from '~/store';
import { ApiError } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

export interface NewAttachment {
  readonly issueId: UUID;
  readonly url: string;
  readonly title?: string | undefined;
}

export async function createAttachment(engine: SyncEngine, input: NewAttachment): Promise<void> {
  const store = engine.store;
  const issue = store.get('issue', input.issueId);
  if (issue === undefined) return;
  const now = new Date().toISOString();
  const provisional: Attachment = {
    id: uuidv7(),
    workspaceId: store.workspaceId,
    issueId: input.issueId,
    teamId: issue.teamId,
    url: input.url.trim(),
    title: (input.title ?? '').trim(),
    createdAt: now,
    updatedAt: now,
  };

  try {
    const data = await engine.mutate<{ createAttachment: { attachment: Attachment } }>({
      mutation: CREATE_ATTACHMENT,
      variables: {
        input: {
          issueId: input.issueId,
          url: input.url.trim(),
          ...(input.title === undefined || input.title.trim() === '' ? null : { title: input.title.trim() }),
        },
      },
      optimistic: [{ type: 'attachment', id: provisional.id, before: null, after: provisional }],
    });
    const real = fromWire('attachment', data.createAttachment.attachment as EntityOf<'attachment'>);
    const existing = store.get('attachment', real.id) ?? null;
    const patch: EntityPatch[] = [{ type: 'attachment', id: real.id, before: existing, after: real }];
    if (real.id !== provisional.id) {
      patch.unshift({ type: 'attachment', id: provisional.id, before: null, after: null });
    }
    store.applyOptimistic(patch);
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

export async function deleteAttachment(engine: SyncEngine, id: UUID): Promise<void> {
  const before = engine.store.get('attachment', id);
  if (before === undefined) return;
  await engine.mutate({
    mutation: DELETE_ATTACHMENT,
    variables: { id },
    optimistic: [{ type: 'attachment', id, before, after: null }],
  });
}
