/**
 * My Issues: Assigned, Created, and Subscribed — the morning routing surface.
 *
 * Still the issue list with a different source for each tab: same virtualiser, same
 * selection model, same shortcuts. Assigned defaults to Focus ordering (urgent → SLA →
 * blockers → cycle → active → triage → backlog → completed); Created and Subscribed use
 * the ordinary display defaults, with Focus available in the menu.
 *
 * Activity is skipped. That tab is a cross-issue event feed (created, updated, commented,
 * reacted, opened PR). Per-issue activity is already a network fetch, not replica data, and
 * wiring a personal activity corpus would be a new backend surface — not a thin source swap.
 */

import { useMemo } from 'react';
import { useLocation } from 'react-router';

import { EmptyState, type TabItem } from '~/components';
import { EntityLoading, useStoreSettled } from '~/features/entity-gate/EntityGate';
import { useViewerId } from '~/hooks/useViewer';
import type { UUID } from '~/store';

import { IssueList, type IssueListSource } from './IssueList';

export type MyIssuesTab = 'assigned' | 'created' | 'subscribed';

export function myIssuesTabFromPath(pathname: string): MyIssuesTab {
  if (pathname.endsWith('/created')) return 'created';
  if (pathname.endsWith('/subscribed')) return 'subscribed';
  return 'assigned';
}

export function myIssuesSource(tab: MyIssuesTab, viewerId: UUID): IssueListSource {
  if (tab === 'created') return { kind: 'creator', userId: viewerId };
  if (tab === 'subscribed') return { kind: 'subscriber', userId: viewerId };
  return { kind: 'assignee', userId: viewerId };
}

const TAB_ITEMS: readonly TabItem[] = [
  { id: 'assigned', label: 'Assigned', to: '/my-issues', end: true },
  { id: 'created', label: 'Created', to: '/my-issues/created' },
  { id: 'subscribed', label: 'Subscribed', to: '/my-issues/subscribed' },
];

export function MyIssues() {
  const viewerId = useViewerId();
  const settled = useStoreSettled();
  const { pathname } = useLocation();
  const tab = myIssuesTabFromPath(pathname);

  // Memoised because the source is part of the list's query identity: an object built
  // inline would be a new one every render, and the query would never be reused.
  const source = useMemo<IssueListSource | null>(
    () => (viewerId === null ? null : myIssuesSource(tab, viewerId)),
    [viewerId, tab],
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

  return <IssueList source={source} heading="My issues" tabs={TAB_ITEMS} />;
}
