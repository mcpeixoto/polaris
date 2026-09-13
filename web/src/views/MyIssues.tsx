/**
 * My Issues: Assigned, Created, Subscribed, and Activity — the morning routing surface.
 *
 * The first three are the issue list with a different source for each tab: same virtualiser,
 * same selection model, same shortcuts. Assigned defaults to Focus ordering (urgent → SLA →
 * blockers → cycle → active → triage → backlog → completed); Created and Subscribed use
 * the ordinary display defaults, with Focus available in the menu.
 *
 * Activity is a network-fetched personal cut of issue_history — the same curated store
 * issue detail already loads on demand. It is not a replica source swap: history is not
 * synced into IndexedDB, and reactions are not written to issue_history yet.
 */

import { useMemo } from 'react';
import { useLocation } from 'react-router';

import { EmptyState, type TabItem } from '~/components';
import { EntityLoading, useStoreSettled } from '~/features/entity-gate/EntityGate';
import { useViewerId } from '~/hooks/useViewer';
import type { UUID } from '~/store';

import { IssueList, type IssueListSource } from './IssueList';
import { MyIssuesActivity } from './MyIssuesActivity';

export type MyIssuesTab = 'assigned' | 'created' | 'subscribed' | 'activity';

export function myIssuesTabFromPath(pathname: string): MyIssuesTab {
  if (pathname.endsWith('/created')) return 'created';
  if (pathname.endsWith('/subscribed')) return 'subscribed';
  if (pathname.endsWith('/activity')) return 'activity';
  return 'assigned';
}

export function myIssuesSource(
  tab: Exclude<MyIssuesTab, 'activity'>,
  viewerId: UUID,
): IssueListSource {
  if (tab === 'created') return { kind: 'creator', userId: viewerId };
  if (tab === 'subscribed') return { kind: 'subscriber', userId: viewerId };
  return { kind: 'assignee', userId: viewerId };
}

export const MY_ISSUES_TABS: readonly TabItem[] = [
  { id: 'assigned', label: 'Assigned', to: '/my-issues', end: true },
  { id: 'created', label: 'Created', to: '/my-issues/created' },
  { id: 'subscribed', label: 'Subscribed', to: '/my-issues/subscribed' },
  { id: 'activity', label: 'Activity', to: '/my-issues/activity' },
];

export function MyIssues() {
  const viewerId = useViewerId();
  const settled = useStoreSettled();
  const { pathname } = useLocation();
  const tab = myIssuesTabFromPath(pathname);

  // Memoised because the source is part of the list's query identity: an object built
  // inline would be a new one every render, and the query would never be reused.
  const source = useMemo<IssueListSource | null>(() => {
    if (viewerId === null || tab === 'activity') return null;
    return myIssuesSource(tab, viewerId);
  }, [viewerId, tab]);

  if (viewerId === null) {
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

  if (tab === 'activity') {
    return <MyIssuesActivity tabs={MY_ISSUES_TABS} />;
  }

  if (source === null) {
    return <EntityLoading label="Loading your issues…" lines={5} />;
  }

  return <IssueList source={source} heading="My issues" tabs={MY_ISSUES_TABS} />;
}
