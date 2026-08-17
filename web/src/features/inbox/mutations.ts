/**
 * Every write the inbox makes, and the one read that fills it.
 *
 * The writes follow the same bargain as the issue mutations: compute the change locally,
 * hand it to `engine.mutate` with the optimistic patch, and return. The row is read, snoozed
 * or gone on the keystroke; the request happens afterwards, to somebody else's schedule.
 *
 * The read is the odd one out in this client, and `operations.ts` says why: the bootstrap
 * snapshot does not carry notifications, so without `hydrateInbox` a freshly bootstrapped
 * browser shows an empty inbox to somebody who opened the app precisely to find out what
 * they had missed.
 */

import { INBOX_PAGE_SIZE } from './inbox';
import {
  DELETE_NOTIFICATION,
  INBOX_QUERY,
  MARK_ALL_NOTIFICATIONS_READ,
  MARK_NOTIFICATION_READ,
  SNOOZE_NOTIFICATION,
  UPDATE_NOTIFICATION_PREFS,
} from './operations';
import type { EntityPatch, Notification, NotificationPrefs, Store, User, UUID } from '~/store';
import { gql } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

export { report } from '~/features/issue/mutations';

/**
 * Fills the replica's inbox from the server, once.
 *
 * Cached against the store object rather than against the workspace id, so that swapping
 * workspaces asks again and a second screen mounting in the same frame does not put a
 * second request on the wire. A failure is not cached: the usual cause is the network, and
 * a client that gave up on ever having an inbox because one request failed during boot
 * would stay empty for the rest of the session.
 *
 * Rows already in the replica are left alone. The store carries the delta stream *and* the
 * user's own unsent writes, and this response carries neither — so preferring it would flip
 * a notification the user marked read a moment ago back to unread, which is the one thing an
 * inbox may never do.
 *
 * The known gap: a resync clears the replica and re-runs the bootstrap, which still does not
 * carry notifications, and this will not run again for that store. The inbox then refills
 * from deltas alone until the page is reloaded. Closing it properly means adding
 * notifications to the bootstrap stream rather than papering over it here.
 */
const hydrated = new WeakMap<Store, Promise<void>>();

export function hydrateInbox(engine: SyncEngine): Promise<void> {
  const store = engine.store;
  const existing = hydrated.get(store);
  if (existing !== undefined) return existing;

  const request = gql<{ notifications: Notification[] }>(INBOX_QUERY, { first: INBOX_PAGE_SIZE })
    .then((data) => {
      const patch: EntityPatch[] = [];
      for (const row of data.notifications) {
        if (store.notifications.has(row.id)) continue;
        patch.push({ type: 'notification', id: row.id, before: null, after: row });
      }
      // One write for the whole page: the badge and the list both subscribe to this, and
      // five hundred separate writes would be five hundred renders of each.
      if (patch.length > 0) store.applyOptimistic(patch);
    })
    .catch((error: unknown) => {
      hydrated.delete(store);
      throw error;
    });

  hydrated.set(store, request);
  return request;
}

/** Marks one row read or unread. Read is a timestamp, so unread is the field going away. */
export async function markNotificationRead(
  engine: SyncEngine,
  id: UUID,
  read: boolean,
): Promise<void> {
  const before = engine.store.get('notification', id);
  if (before === undefined) return;
  if ((before.readAt !== undefined) === read) return;

  const now = new Date().toISOString();
  const after: Notification = read
    ? { ...before, readAt: now, updatedAt: now }
    : withoutReadAt(before, now);

  await engine.mutate({
    mutation: MARK_NOTIFICATION_READ,
    variables: { id, read },
    optimistic: [{ type: 'notification', id, before, after }],
  });
}

/**
 * Clears the whole inbox in one mutation.
 *
 * Snoozed rows are included, because the server includes them: "mark all read" means the
 * inbox, not the part of it visible at this instant, and a badge that stayed at three after
 * the user cleared it would be reporting rows they cannot see.
 */
export async function markAllNotificationsRead(engine: SyncEngine): Promise<void> {
  const store = engine.store;
  const now = new Date().toISOString();
  const optimistic: EntityPatch[] = [];

  for (const id of store.unreadNotificationIds()) {
    const before = store.notifications.get(id);
    if (before === undefined) continue;
    optimistic.push({
      type: 'notification',
      id,
      before,
      after: { ...before, readAt: now, updatedAt: now },
    });
  }
  // Nothing to do, and the server agrees: it emits no version block for an empty inbox
  // rather than taking the workspace lock for a button people press twice.
  if (optimistic.length === 0) return;

  await engine.mutate({
    mutation: MARK_ALL_NOTIFICATIONS_READ,
    variables: {},
    optimistic,
  });
}

/**
 * Hides a row until `until`, or wakes it now when that is null.
 *
 * Nothing writes the row when the time arrives — the predicate is a comparison against the
 * clock — so the only thing this has to get right is the timestamp itself. See inbox.ts for
 * how the screen finds out that the moment has come.
 */
export async function snoozeNotification(
  engine: SyncEngine,
  id: UUID,
  until: Date | null,
): Promise<void> {
  const before = engine.store.get('notification', id);
  if (before === undefined) return;

  const now = new Date().toISOString();
  const after: Notification =
    until === null
      ? withoutSnooze(before, now)
      : { ...before, snoozedUntil: until.toISOString(), updatedAt: now };

  await engine.mutate({
    mutation: SNOOZE_NOTIFICATION,
    variables: { id, until: until === null ? null : until.toISOString() },
    optimistic: [{ type: 'notification', id, before, after }],
  });
}

/**
 * Removes a row from the inbox.
 *
 * Locally a delete, which is what the server's own change for it is — the row is soft
 * deleted there so a replayed fan-out cannot deliver it again, but nothing about it is ever
 * sent to this client afterwards, and a client holding a row it can never show or act on is
 * a leak rather than a cache.
 */
export async function dismissNotification(engine: SyncEngine, id: UUID): Promise<void> {
  const before = engine.store.get('notification', id);
  if (before === undefined) return;

  await engine.mutate({
    mutation: DELETE_NOTIFICATION,
    variables: { id },
    optimistic: [{ type: 'notification', id, before, after: null }],
  });
}

/**
 * The row with `readAt` removed rather than set to undefined.
 *
 * Deleting the key matters: the store persists entities into IndexedDB and compares results
 * structurally, and `{ readAt: undefined }` is a different object from one without the key —
 * enough to make a no-op update look like a change and re-render every open list.
 */
function withoutReadAt(row: Notification, updatedAt: string): Notification {
  const { readAt: _readAt, ...rest } = row;
  return { ...rest, updatedAt };
}

function withoutSnooze(row: Notification, updatedAt: string): Notification {
  const { snoozedUntil: _snoozedUntil, ...rest } = row;
  return { ...rest, updatedAt };
}

/**
 * Writes the notification preferences bag.
 *
 * The whole bag every time, because that is the mutation's shape: `updateNotificationPrefs`
 * replaces what is stored rather than merging into it. So this takes the bag as the caller
 * currently believes it to be and applies a patch over it — which is what keeps a client
 * built before some future preference existed from deleting that preference every time
 * somebody changes their digest cadence.
 *
 * Optimistic like everything else. A preference is written as a side effect of moving a
 * control the user is already looking at, and a switch that waits for a round trip before it
 * moves is a switch people press twice.
 */
export async function updateNotificationPrefs(
  engine: SyncEngine,
  userId: UUID,
  patch: NotificationPrefs,
): Promise<void> {
  const before = engine.store.get('user', userId);
  if (before === undefined) return;

  const prefs: NotificationPrefs = { ...before.notificationPrefs, ...patch };
  const after: User = { ...before, notificationPrefs: prefs, updatedAt: new Date().toISOString() };

  await engine.mutate({
    mutation: UPDATE_NOTIFICATION_PREFS,
    variables: { prefs },
    optimistic: [{ type: 'user', id: userId, before, after }],
  });
}
