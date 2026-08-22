/**
 * Link attachments on an issue.
 *
 * URL-idempotent: posting the same URL twice is an update of the existing card, which is
 * why an integration can be stateless and why the optimistic path here keys the stand-in
 * by a client-minted id that the server's response then replaces.
 */

import { CREATE_ATTACHMENT, DELETE_ATTACHMENT } from '~/gql/operations';
import { uuidv7, type Attachment, type UUID } from '~/store';
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
    await engine.mutate<{ createAttachment: { attachment: Attachment } }>({
      mutation: CREATE_ATTACHMENT,
      variables: {
        input: {
          issueId: input.issueId,
          url: input.url.trim(),
          ...(input.title === undefined || input.title.trim() === ''
            ? null
            : { title: input.title.trim() }),
        },
      },
      optimistic: [{ type: 'attachment', id: provisional.id, before: null, after: provisional }],
      // The API mints an attachment's id, so the stand-in has to be swapped for the real
      // row — and the swap has to be reachable from somewhere other than this `await`.
      // Doing it after the await only works when this call is still alive to see the
      // response: leave the issue before it lands, or take a 429 or an offline blip that
      // sends the mutation to the outbox, and nothing ever pairs the two. The stand-in is
      // persisted like any other write, so it survives the reload, and the real row then
      // arrives on the delta stream beside it — one link, two cards, for good. Declared
      // rather than done, so `SyncEngine.settle` runs it from the outbox too.
      reconcile: {
        type: 'attachment',
        provisionalId: provisional.id,
        path: ['createAttachment', 'attachment'],
        // And the same row off the delta stream, which usually gets here first — see
        // `adopt`. Issue and URL are exactly the pair the server holds unique, so a match
        // here is not a near-miss. It is a match on the URL *as typed*: the server lower
        // cases the scheme and the host, so a link pasted in mixed case falls through to
        // the response instead, which is the slower half of the same answer rather than a
        // wrong one.
        match: ['issueId', 'url'],
      },
    });
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
