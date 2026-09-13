/**
 * Leave triage, optionally posting a comment first.
 *
 * The comment is a separate write from the status change on purpose: accept and decline are
 * already their own mutations, and bundling a comment into them would mean a server change
 * for what is a client courtesy. Empty body skips the comment write entirely — the common
 * case of accepting without a note must not queue a no-op.
 */

import { postComment } from '~/features/issue/mutations';
import type { UUID } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { acceptTriageIssue, declineTriageIssue } from './mutations';

export function acceptTriageIssuesWithComment(
  engine: SyncEngine,
  ids: readonly UUID[],
  comment: string,
  authorId: UUID | null,
): Promise<void> {
  return all(ids.map((id) => acceptTriageIssueWithComment(engine, id, comment, authorId)));
}

export function declineTriageIssuesWithComment(
  engine: SyncEngine,
  ids: readonly UUID[],
  comment: string,
  authorId: UUID | null,
): Promise<void> {
  return all(ids.map((id) => declineTriageIssueWithComment(engine, id, comment, authorId)));
}

export async function acceptTriageIssueWithComment(
  engine: SyncEngine,
  id: UUID,
  comment: string,
  authorId: UUID | null,
): Promise<void> {
  await maybeComment(engine, id, comment, authorId);
  await acceptTriageIssue(engine, id);
}

export async function declineTriageIssueWithComment(
  engine: SyncEngine,
  id: UUID,
  comment: string,
  authorId: UUID | null,
): Promise<void> {
  await maybeComment(engine, id, comment, authorId);
  await declineTriageIssue(engine, id);
}

async function maybeComment(
  engine: SyncEngine,
  issueId: UUID,
  comment: string,
  authorId: UUID | null,
): Promise<void> {
  const body = comment.trim();
  if (body === '') return;
  await postComment(engine, {
    issueId,
    body,
    ...(authorId === null ? null : { authorId }),
  });
}

function all(writes: readonly Promise<void>[]): Promise<void> {
  return Promise.all(writes).then(() => undefined);
}
