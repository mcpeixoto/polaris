/**
 * What the inbox is, as arithmetic.
 *
 * Everything here is pure except the one hook at the bottom, and that is on purpose: the
 * inbox's only genuinely difficult rule is a clock comparison, and a clock comparison
 * buried in a component is a rule nobody can test.
 *
 * **The rule.** A snoozed notification wakes on its own. Its predicate is `snoozedUntil <=
 * now`, not a flag somebody clears, so nothing is written when the moment arrives — the
 * server does not touch the row, no delta is emitted, and a client that only re-reads when
 * the store changes would keep a nine-o'clock reminder hidden all afternoon. See
 * `NotificationIndex` in the store, which declines to index snoozed rows for exactly this
 * reason.
 *
 * So the inbox re-evaluates **on a timer**, and the timer is armed for the next expiry
 * rather than ticking. The alternative — re-evaluating when the window regains focus —
 * loses the case the feature exists for: an inbox left open on a second monitor while its
 * owner works in another application never regains focus, and the row they snoozed until
 * this morning is still hidden this evening. A wake armed for the exact instant costs one
 * timeout, fires once per snooze rather than once per interval, and re-arms itself; when
 * nothing is snoozed there is no timer at all.
 */

import { useEffect, useState } from 'react';

import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { EntityType, Notification, NotificationType, Store, UUID } from '~/store';

/**
 * How many rows the hydration asks for.
 *
 * The server clamps to 500 and the product caps an open inbox at 2,000, so this is the
 * whole of a busy inbox rather than a page of it. Asking for less would mean the badge
 * derived from the replica disagreed with the server's count on exactly the accounts where
 * anybody would notice.
 */
export const INBOX_PAGE_SIZE = 500;

/** Whether a row is visible now: never snoozed, or snoozed to a moment that has passed. */
export function isAwake(row: Notification, now: number): boolean {
  if (row.snoozedUntil === undefined) return true;
  const until = Date.parse(row.snoozedUntil);
  // An unparseable timestamp counts as awake. A row nobody can see and nobody can wake is
  // worse than one that arrives early, and it would be invisible in every screenshot.
  return Number.isNaN(until) || until <= now;
}

/**
 * Folds one row's snooze into the earliest wake still pending.
 *
 * Only the earliest is tracked, because it is the only moment the answer changes on its
 * own: everything after it is recomputed by the render that moment causes.
 */
function withWake(pending: number | null, row: Notification, now: number): number | null {
  if (row.snoozedUntil === undefined) return pending;
  const until = Date.parse(row.snoozedUntil);
  if (Number.isNaN(until) || until <= now) return pending;
  return pending === null || until < pending ? until : pending;
}

/**
 * An answer that expires by itself.
 *
 * Every selector in this file returns one, because every one of them is a statement about
 * the clock as much as about the store: "three unread, and that becomes four at 09:00".
 * Carrying the second half beside the first is what lets the timer be armed for the exact
 * instant instead of polling for it.
 */
export interface Waking {
  /** When this answer stops being true without anything being written, or null if never. */
  readonly wakeAt: number | null;
}

export interface UnreadCount extends Waking {
  readonly count: number;
}

/**
 * The badge: unread rows that are awake, and when that number moves by itself.
 *
 * It walks the store's unread INDEX rather than the notification table. That is the whole
 * difference between this being free and this being the most expensive thing in a sidebar
 * render: the index is already the set of unread ids, bounded by the product's 2,000-row
 * cap, while the table holds every row the replica has ever received, read ones included.
 *
 * Snoozed rows are excluded even though they are unread, because a badge that keeps
 * counting what you have deliberately put aside makes snoozing pointless — and the whole
 * point of returning `wakeAt` is that excluding them costs nothing in correctness: the
 * caller re-asks at the exact instant one of them comes back.
 */
export function unreadCount(store: Store, now: number): UnreadCount {
  let count = 0;
  let wake: number | null = null;
  for (const id of store.unreadNotificationIds()) {
    const row = store.notifications.get(id);
    if (row === undefined) continue;
    if (isAwake(row, now)) {
      count++;
      continue;
    }
    wake = withWake(wake, row, now);
  }
  return { count, wakeAt: wake };
}

/**
 * `now`, refreshed exactly when `at` arrives and at no other time.
 *
 * `now` is in the dependency list beside `at` so that a wake which has been clamped below
 * re-arms rather than firing once and stopping. It cannot spin: `at` is by construction a
 * moment in the future relative to the `now` it was computed from, so the render that
 * follows a wake produces either a later `at` or none.
 */
export function useWakeClock(at: number | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (at === null) return;
    // setTimeout truncates to a 32-bit delay, so anything beyond about 24 days fires
    // immediately and would leave a fortnight-long snooze permanently awake. Clamping and
    // re-arming is the only way to hold a long one.
    const delay = Math.min(Math.max(at - Date.now(), 0) + 1, MAX_TIMEOUT_MS);
    const timer = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [at, now]);

  return now;
}

const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * A live query whose answer knows when it goes stale on its own.
 *
 * The two halves have to be ordered this way round and it is the only part of this that is
 * fiddly: the answer is computed from `now`, and the next `now` is scheduled from the
 * answer. Holding the armed moment in state breaks the circle — the clock is armed from the
 * render that produced the answer rather than from inside it — and costs one extra render
 * per wake, which happens as often as somebody's snooze expires.
 */
export function useWakingQuery<T extends Waking>(
  select: (store: Store, now: number) => T,
  deps: readonly EntityType[],
): T {
  const [armed, setArmed] = useState<number | null>(null);
  const now = useWakeClock(armed);
  const result = useLiveQuery((store) => select(store, now), deps, [now]);

  useEffect(() => setArmed(result.wakeAt), [result.wakeAt]);

  return result;
}

/**
 * The calendar day a timestamp falls in, as `2026-08-16`, in the reader's own zone.
 *
 * The reader's rather than the team's: an inbox is a record of what happened to *you*, and
 * "today" in it means the day you are having. A due date is the opposite case and is
 * reckoned in the team's zone; see features/time.
 *
 * `en-CA` is the shortest route from `Intl` to ISO order and is a formatting trick rather
 * than a language choice — the output is digits either way.
 */
export function dayKeyOf(timestamp: string, timezone: string): string {
  const at = Date.parse(timestamp);
  if (Number.isNaN(at)) return timestamp;
  return dayFormatter(timezone).format(at);
}

/**
 * Formatters are cached by zone because constructing one costs roughly as much as
 * formatting fifty dates, and an inbox of five hundred rows is grouped on every render.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(timezone: string): Intl.DateTimeFormat {
  const hit = formatters.get(timezone);
  if (hit !== undefined) return hit;
  const made = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  formatters.set(timezone, made);
  return made;
}

/**
 * What a notification says happened, with the issue named.
 *
 * Written as whole sentences per type rather than assembled from a verb table, because the
 * grammar differs — you are mentioned *in* an issue, assigned *to* one, and an issue simply
 * becomes due with nobody doing anything. A table would produce "Ada due ENG-4".
 *
 * An unrecognised type still says something. A newer server can deliver a type this build
 * has never heard of, and a blank row is indistinguishable from a rendering fault.
 */
export function describeEvent(type: NotificationType, identifier: string): string {
  switch (type) {
    case 'issue_assigned':
      return `assigned ${identifier} to you`;
    case 'issue_status_changed':
      return `changed the status of ${identifier}`;
    case 'issue_priority_raised':
      return `raised the priority of ${identifier}`;
    case 'issue_due':
      return `${identifier} is due`;
    case 'issue_blocked':
      return `blocked ${identifier}`;
    case 'comment':
      return `commented on ${identifier}`;
    case 'mention':
      return `mentioned you in ${identifier}`;
    case 'sub_issue_completed':
      return `completed a sub-issue of ${identifier}`;
    default:
      return `updated ${identifier}`;
  }
}

/**
 * The tail of a coalesced row — "and 199 others" — or null for a row that is one event.
 *
 * `count` is how many events folded into this row, so the row already names one of them and
 * the tail is about the rest. Getting that off by one is the difference between an inbox
 * that says 200 issues changed and one that says 201 did.
 */
export function coalescedTail(count: number): string | null {
  const others = count - 1;
  if (others <= 0) return null;
  return others === 1 ? 'and 1 other' : `and ${others} others`;
}

/** Rows the inbox can act on, newest first. Snoozed rows are absent until they wake. */
export function awakeNotificationIds(store: Store, now: number): UUID[] {
  const rows: Notification[] = [];
  for (const row of store.notifications.values()) {
    if (isAwake(row, now)) rows.push(row);
  }
  rows.sort(byNewest);
  return rows.map((row) => row.id);
}

/**
 * Newest first, with the id breaking ties.
 *
 * The tie-break is not decoration: a bulk update delivers a run of rows written in the same
 * millisecond, and without it their order is whatever the map happened to iterate — which
 * changes when an unrelated row is marked read, and reads as the list reshuffling itself
 * under the cursor.
 */
function byNewest(a: Notification, b: Notification): number {
  const delta = Date.parse(b.createdAt) - Date.parse(a.createdAt);
  if (delta !== 0 && !Number.isNaN(delta)) return delta;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}
