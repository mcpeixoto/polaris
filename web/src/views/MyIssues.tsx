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
import { useViewerId } from '~/hooks/useViewer';
import { IssueList, type IssueListSource } from './IssueList';

export function MyIssues() {
  const viewerId = useViewerId();

  // Memoised because the source is part of the list's query identity: an object built
  // inline would be a new one every render, and the query would never be reused.
  const source = useMemo<IssueListSource | null>(
    () => (viewerId === null ? null : { kind: 'assignee', userId: viewerId }),
    [viewerId],
  );

  if (source === null) {
    // Reachable for a moment on a cold boot, before the viewer query lands. An empty state
    // rather than a spinner: the list that follows occupies the same space, so nothing
    // moves when it arrives.
    return (
      <EmptyState title="Loading your work" description="Finding the issues assigned to you." />
    );
  }

  return <IssueList source={source} heading="My Issues" />;
}
