/**
 * My Issues: everything assigned to the viewer, across every team they can reach.
 *
 * Deliberately thin. It is the issue list with a different source — same virtualiser, same
 * selection model, same eleven registered shortcuts, same bulk pickers — because a second
 * copy of all of that is where a shortcut gets fixed in one list and not the other, and
 * nobody notices for a month.
 *
 * The one real difference is what a selection can span. A team's list is by construction all
 * one team; this one is not, and statuses belong to a team — so the bulk status control is
 * unavailable for a cross-team selection rather than offering one team's statuses for
 * another team's issues. That is handled in IssueList, where the selection lives.
 */

import { useMemo } from 'react';

import { EmptyState } from '~/components';
import { EntityLoading, useStoreSettled } from '~/features/entity-gate/EntityGate';
import { useViewerId } from '~/hooks/useViewer';
import { IssueList, type IssueListSource } from './IssueList';

export function MyIssues() {
  const viewerId = useViewerId();
  const settled = useStoreSettled();

  // Memoised because the source is part of the list's query identity: an object built
  // inline would be a new one every render, and the query would never be reused.
  const source = useMemo<IssueListSource | null>(
    () => (viewerId === null ? null : { kind: 'assignee', userId: viewerId }),
    [viewerId],
  );

  if (source === null) {
    // Reachable for a moment on a cold boot, before the viewer row lands. It used to be an
    // `EmptyState` titled "Loading your work" — a wait dressed as an answer, which is the
    // fourth loading idiom `EntityGate` exists to retire. Once the replica has settled and
    // there is still no viewer, the wait is over and the honest thing to say is that this
    // client cannot tell whose issues to show.
    return settled ? (
      <EmptyState
        title="We cannot tell who you are"
        description="This device is signed in but the viewer's own row has not arrived. Reload, or sign in again."
      />
    ) : (
      <EntityLoading label="Loading your issues…" lines={5} />
    );
  }

  return <IssueList source={source} heading="My issues" />;
}
