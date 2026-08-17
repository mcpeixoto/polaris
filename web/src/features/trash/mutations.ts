/**
 * Reading the trash, and undoing a delete.
 *
 * Two calls, and neither of them behaves the way the rest of this client's data access does.
 *
 * **The listing is a plain network read.** Everything else on screen is a query over the local
 * replica, refreshed by deltas. A deleted issue is the one thing the replica deliberately does
 * not hold — the server emits a delete for it and the client keeps no residue — so there is
 * nothing to select and nothing to subscribe to. `fetchDeletedIssues` hands its answer to the
 * caller, the screen keeps it in component state, and the row disappears from that state when
 * it is restored. That also means the trash is the one screen in the product with a genuine
 * loading state, a genuine failure state and a retry, because it is the one screen that cannot
 * be drawn from what this browser already knows.
 *
 * **The restore has no optimistic patch**, and cannot have one. There is no `before` to hold:
 * the issue left this replica when the delete arrived. Worse, the change the server publishes
 * for a restore is not always an upsert — an issue that was *archived* before it was deleted
 * comes back as a delete, because archived work is never cached by a client — so a client that
 * optimistically wrote the issue back into the store would put a row into the list that the
 * next bootstrap silently removes again. Waiting for the delta is not a compromise here; it is
 * the only version that is correct in both cases.
 *
 * There is deliberately no delete in this file. `deleteIssue` belongs with the other issue
 * writes and the outbox replays it like any other mutation; what belongs *here* is the way
 * back, because the way back is what makes a delete safe to offer. Wiring the two together is
 * two lines at the call site — see `restoreIssue` — rather than a dependency between features.
 */

import { fromWire } from '~/gql/enums';
import type { Issue, UUID } from '~/store';
import { gql } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { DELETED_ISSUES_QUERY, RESTORE_ISSUE } from './operations';

/**
 * How long a deleted issue can be brought back.
 *
 * Restated from the server's `IssueRestoreWindow`, which is the only authority: the purge job
 * hard-deletes on the same schedule, so a client that advertised longer would be offering to
 * restore rows that are no longer there. It is stated on screen rather than kept as an
 * implementation detail, because "where did my issue go" is the question the trash exists to
 * answer and "for how long can I still fix this" is the half of the answer that decides what
 * somebody does next.
 */
export const RESTORE_WINDOW_DAYS = 30;

/**
 * Everything deleted within the window that this member is allowed to see.
 *
 * The server scopes it to the caller's teams and orders it by deletion time, newest first. The
 * order is kept exactly as it arrives and must not be re-sorted here: the client has no
 * `deletedAt` to sort by — the field is not on the `Issue` type — so any ordering this code
 * invented would be an ordering by something else wearing the label "recently deleted".
 *
 * `signal` is taken so a screen that unmounts mid-flight can abandon the request rather than
 * setting state on a component that has gone.
 */
export async function fetchDeletedIssues(signal?: AbortSignal): Promise<readonly Issue[]> {
  const data = await gql<{ deletedIssues: Issue[] }>(DELETED_ISSUES_QUERY, undefined, { signal });
  // These rows came over GraphQL, where an enumerated value is spelled in upper case, while
  // everything already in the replica arrived from the sync stream in the database's spelling.
  // No column on this screen reads an enum today — which is exactly why converting here rather
  // than at the one call site matters: the next reader inherits the fix instead of the bug.
  // See ~/gql/enums.
  return data.deletedIssues.map((issue) => fromWire('issue', issue));
}

/**
 * Brings a deleted issue back.
 *
 * Returns nothing, and that is a decision rather than an omission. The mutation's response
 * carries the issue, but the store must not be written from it (see the note at the top of this
 * file), so the only thing a caller could do with it is render a row the delta is about to
 * render anyway. Returning `Promise<void>` also makes this directly usable as an undo:
 *
 *     await deleteIssue(engine, issue.id);
 *     offerUndo({
 *       label: `Deleted ${issue.identifier}`,
 *       undo: () => restoreIssue(engine, issue.id),
 *     });
 *
 * which is how a delete feeds the undo stack. It is two lines at the call site on purpose. The
 * undo stack knows nothing about issues, this feature knows nothing about toasts, and the
 * screen that owns both is the only place where the label — the user's words for what just
 * happened — is actually known.
 *
 * Rejects like any other mutation. The caller has somewhere to put the failure: a restore that
 * silently did nothing would leave the row sitting in the trash looking as though the button
 * were broken.
 */
export async function restoreIssue(engine: SyncEngine, id: UUID): Promise<void> {
  await engine.mutate({ mutation: RESTORE_ISSUE, variables: { id } });
}
