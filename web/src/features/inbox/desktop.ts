/**
 * Which unread inbox rows should fire a system notification this frame.
 *
 * The first snapshot is silence: hydrating a busy inbox must not pop fifty banners for
 * mail that arrived while this laptop was closed. After that, only ids that were not in
 * the previous snapshot are announced.
 */

import { useEffect, useRef } from 'react';

import { useLiveQuery } from '~/hooks/useLiveQuery';
import { notify } from '~/platform/runtime';
import type { Store, UUID } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { describeEvent, isAwake } from './inbox';
import { hydrateInbox } from './mutations';

export function idsToAnnounce(
  current: ReadonlySet<UUID>,
  seen: ReadonlySet<UUID>,
  primed: boolean,
): { readonly announce: readonly UUID[]; readonly seen: ReadonlySet<UUID> } {
  const next = new Set(seen);
  if (!primed) {
    for (const id of current) next.add(id);
    return { announce: [], seen: next };
  }
  const announce: UUID[] = [];
  for (const id of current) {
    if (next.has(id)) continue;
    next.add(id);
    announce.push(id);
  }
  return { announce, seen: next };
}

/**
 * Fires a system notification for unread inbox rows that arrive after the first snapshot.
 *
 * Hydrates once so the badge and this announcer agree about what was already waiting.
 * The preference is `desktop` on the viewer's bag; absent means off.
 */
export function useDesktopNotifications(engine: SyncEngine, viewerId: UUID | null): void {
  useEffect(() => {
    hydrateInbox(engine).catch(() => {
      /* The inbox screen retries; a failed hydrate here just means we announce from deltas. */
    });
  }, [engine]);

  const seen = useRef(new Set<UUID>());
  const primed = useRef(false);

  const snapshot = useLiveQuery(
    (store) => desktopSnapshot(store, viewerId),
    ['notification', 'issue', 'user'],
    [viewerId],
  );

  useEffect(() => {
    if (snapshot === null) return;
    // Off (or not yet granted) still seeds `seen`, so flipping the switch later does not
    // dump every already-unread row as a banner. Same silence as the first snapshot.
    const next = idsToAnnounce(snapshot.unread, seen.current, primed.current && snapshot.desktop);
    seen.current = new Set(next.seen);
    primed.current = true;
    if (!snapshot.desktop) return;
    for (const id of next.announce) {
      const row = snapshot.bodies.get(id);
      if (row === undefined) continue;
      notify({ title: 'Polaris', body: row.body, route: row.route });
    }
  }, [snapshot]);
}

interface DesktopSnapshot {
  readonly desktop: boolean;
  readonly unread: ReadonlySet<UUID>;
  readonly bodies: ReadonlyMap<UUID, { readonly body: string; readonly route: string }>;
}

function desktopSnapshot(store: Store, viewerId: UUID | null): DesktopSnapshot | null {
  if (viewerId === null) return null;
  const desktop = store.users.get(viewerId)?.notificationPrefs?.desktop === true;
  const unread = new Set<UUID>();
  const bodies = new Map<UUID, { readonly body: string; readonly route: string }>();
  const now = Date.now();
  for (const row of store.notifications.values()) {
    if (row.readAt !== undefined) continue;
    if (!isAwake(row, now)) continue;
    unread.add(row.id);
    const issue = row.issueId === undefined ? undefined : store.get('issue', row.issueId);
    const identifier = issue?.identifier ?? 'an issue';
    bodies.set(row.id, {
      body: describeEvent(row.type, identifier),
      route: issue === undefined ? '/inbox' : `/issue/${issue.identifier}`,
    });
  }
  return { desktop, unread, bodies };
}
