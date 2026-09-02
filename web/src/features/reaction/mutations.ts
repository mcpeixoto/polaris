/**
 * Emoji reactions on a comment.
 *
 * A reaction is a row rather than a field, for the reason `Reaction` in store/types.ts gives:
 * several people click the same emoji in the same second, and a set written as a whole loses
 * every write but the last. So an add is an upsert of one row and a remove is a delete of one,
 * and neither needs merge logic.
 *
 * Both writes are optimistic, because the pill is the feedback: a reaction that appears a
 * round trip later reads as a click that missed.
 */

import { ADD_REACTION, REMOVE_REACTION } from '~/gql/operations';
import { uuidv7, type Reaction, type UUID } from '~/store';
import { ApiError } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

/**
 * The viewer's reaction with this emoji on this comment, if there is one.
 *
 * The only question either write asks of the replica, and the same one the pill asks to
 * decide whether it is highlighted — so it lives here rather than being written twice.
 */
export function reactionOf(
  engine: SyncEngine,
  commentId: UUID,
  emoji: string,
  userId: UUID,
): Reaction | undefined {
  for (const id of engine.store.reactionIdsFor(commentId)) {
    const row = engine.store.get('reaction', id);
    if (row !== undefined && row.emoji === emoji && row.userId === userId) return row;
  }
  return undefined;
}

/**
 * Adds one, or does nothing if this person has already reacted with it.
 *
 * The server treats a repeat as a success with `version: 0`, so the guard is not there to
 * keep the API honest — it is there so a double click does not draw a second stand-in that
 * only one server row will ever pair with.
 */
export async function addReaction(
  engine: SyncEngine,
  commentId: UUID,
  emoji: string,
  userId: UUID,
): Promise<void> {
  if (reactionOf(engine, commentId, emoji, userId) !== undefined) return;

  const provisional: Reaction = {
    id: uuidv7(),
    workspaceId: engine.store.workspaceId,
    commentId,
    userId,
    emoji,
    createdAt: new Date().toISOString(),
  };

  try {
    await engine.mutate<{ addReaction: { reaction: Reaction } }>({
      mutation: ADD_REACTION,
      variables: { commentId, emoji },
      optimistic: [{ type: 'reaction', id: provisional.id, before: null, after: provisional }],
      // The id is the server's, so the stand-in above has to be swapped for the real row —
      // declared rather than done in the `await`, which a reload does not survive. The
      // comment, the person and the emoji are what this client chose, and they are exactly
      // what the server holds unique, so they are what the delta stream pairs on.
      reconcile: {
        type: 'reaction',
        provisionalId: provisional.id,
        path: ['addReaction', 'reaction'],
        match: ['commentId', 'userId', 'emoji'],
      },
    });
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

/** Removes the viewer's own reaction. Nothing to remove is not a failure — it is the state. */
export async function removeReaction(
  engine: SyncEngine,
  commentId: UUID,
  emoji: string,
  userId: UUID,
): Promise<void> {
  const before = reactionOf(engine, commentId, emoji, userId);
  if (before === undefined) return;

  try {
    await engine.mutate({
      mutation: REMOVE_REACTION,
      variables: { commentId, emoji },
      optimistic: [{ type: 'reaction', id: before.id, before, after: null }],
    });
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

/** What a pill's click does: the same emoji off if it is the viewer's, on if it is not. */
export function toggleReaction(
  engine: SyncEngine,
  commentId: UUID,
  emoji: string,
  userId: UUID,
): Promise<void> {
  return reactionOf(engine, commentId, emoji, userId) === undefined
    ? addReaction(engine, commentId, emoji, userId)
    : removeReaction(engine, commentId, emoji, userId);
}
