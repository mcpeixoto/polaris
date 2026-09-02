/**
 * Which unread inbox rows should fire a system notification this frame.
 *
 * The first snapshot is silence: hydrating a busy inbox must not pop fifty banners for
 * mail that arrived while this laptop was closed. After that, only ids that were not in
 * the previous snapshot are announced.
 */

import { useEffect, useRef } from 'react';

import { useLiveQuery } from '~/hooks/useLiveQuery';
import { isWindowFocused, notify, setBadgeCount } from '~/platform/runtime';
import type { Store, UUID } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { describeEvent, isAwake, notificationHref, unreadCount, useWakingQuery } from './inbox';
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
 * One banner per row, or one banner for all of them.
 *
 * Reconnecting after a day offline delivers a delta full of ids that were all "new since the
 * previous snapshot", and firing one notification each is fifty banners for a laptop being
 * opened. The rule the desktop doc states is the one implemented here: individually up to
 * five, and above that a single line saying how many.
 */
export const NOTIFICATION_BURST_LIMIT = 5;

export function announcements(
  bodies: readonly { readonly body: string; readonly route: string }[],
): readonly { title: string; body: string; route?: string }[] {
  if (bodies.length === 0) return [];
  if (bodies.length <= NOTIFICATION_BURST_LIMIT) {
    return bodies.map((row) => ({ title: 'Polaris', body: row.body, route: row.route }));
  }
  return [{ title: 'Polaris', body: `${bodies.length} updates`, route: '/inbox' }];
}

/**
 * Whether a banner is worth showing at all.
 *
 * A comment arriving while the reader is looking at the inbox produces a banner over the
 * thing it is announcing. Focused *and* on the inbox, because a focused window on an issue
 * screen is not showing the notification that just arrived — the inbox is.
 */
export function shouldAnnounce(focused: boolean, pathname: string): boolean {
  return !(focused && pathname.startsWith('/inbox'));
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
    if (!shouldAnnounce(isWindowFocused(), window.location.pathname)) return;

    const rows = next.announce
      .map((id) => snapshot.bodies.get(id))
      .filter((row): row is { body: string; route: string } => row !== undefined);
    for (const payload of announcements(rows)) notify(payload);
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
      body: describeEvent(row.type, identifier, row.payload),
      route:
        notificationHref(row.type, row.payload, row.issueId) ??
        (issue === undefined ? '/inbox' : `/issue/${issue.identifier}`),
    });
  }
  return { desktop, unread, bodies };
}

/**
 * Keeps the dock, taskbar or tab title showing how many inbox rows are waiting.
 *
 * `setBadgeCount` and `unreadCount` both existed and neither was ever called, so the count
 * this product is built around reached no surface at all: the settings screen promises "the
 * tab badge still updates either way" beside the browser-notification switch, and the tab
 * said `Polaris` however much was waiting.
 *
 * Through `useWakingQuery` rather than a plain live query because the number moves without
 * anything being written — a snoozed row waking is a clock comparison — and a badge that
 * only re-counted on a delta would keep a nine-o'clock reminder out of the title all day.
 */
export function useUnreadBadge(): void {
  const { count } = useWakingQuery(unreadCount, ['notification']);
  useEffect(() => {
    setBadgeCount(count);
  }, [count]);
}
