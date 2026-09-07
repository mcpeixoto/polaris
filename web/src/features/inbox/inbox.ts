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
  inputs: readonly unknown[] = [],
): T {
  const [armed, setArmed] = useState<number | null>(null);
  const now = useWakeClock(armed);
  const result = useLiveQuery((store) => select(store, now), deps, [now, ...inputs]);

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
export function describeEvent(
  type: NotificationType,
  identifier: string,
  payload?: unknown,
): string {
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
    case 'view_issue_added':
      return `${identifier} was added to a view you follow`;
    case 'view_issue_completed':
      return `completed ${identifier} in a view you follow`;
    case 'pulse_digest': {
      const count = pulseDigestCount(payload);
      return count === 1 ? 'Pulse: 1 project update' : `Pulse: ${count} project updates`;
    }
    case 'project_issue_added':
      return `${identifier} was added to a project you follow`;
    case 'project_issue_completed':
      return `completed ${identifier} in a project you follow`;
    case 'project_update':
      return 'posted an update on a project you follow';
    case 'initiative_issue_added':
      return `${identifier} was added to an initiative you follow`;
    case 'initiative_issue_completed':
      return `completed ${identifier} in an initiative you follow`;
    case 'initiative_update':
      return 'posted an update on an initiative you follow';
    case 'customer_request_added':
      return identifier === 'an issue'
        ? 'added a request for a customer you follow'
        : `added a request on ${identifier}`;
    case 'customer_request_important':
      return identifier === 'an issue'
        ? 'marked a request important for a customer you follow'
        : `marked a request on ${identifier} important`;
    case 'customer_request_completed':
      return `completed a request on ${identifier}`;
    default:
      return `updated ${identifier}`;
  }
}

/**
 * Where opening a row should go when it is not an issue, or when the issue is not the
 * thing being talked about.
 *
 * Pulse is a digest of many projects, so it has nowhere else to land. A project or
 * initiative update has no issue. A customer request may not have one yet either — the
 * payload then carries the customer id, never a title.
 */
export function notificationHref(
  type: NotificationType,
  payload: unknown,
  issueId: UUID | undefined,
): string | undefined {
  if (type === 'pulse_digest') return '/pulse';
  if (type === 'project_update') {
    const id = payloadId(payload, 'projectId');
    return id === undefined ? undefined : `/project/${id}/activity`;
  }
  if (type === 'initiative_update') {
    const id = payloadId(payload, 'initiativeId');
    return id === undefined ? undefined : `/initiative/${id}/activity`;
  }
  if (
    (type === 'customer_request_added' ||
      type === 'customer_request_important' ||
      type === 'customer_request_completed') &&
    issueId === undefined
  ) {
    const id = payloadId(payload, 'customerId');
    return id === undefined ? undefined : `/customer/${id}`;
  }
  return undefined;
}

export function payloadId(payload: unknown, key: string): string | undefined {
  if (payload === null || typeof payload !== 'object' || !(key in payload)) return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function pulseDigestCount(payload: unknown): number {
  if (payload !== null && typeof payload === 'object' && 'count' in payload) {
    const n = Number((payload as { count: unknown }).count);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  return 0;
}

/**
 * The tail of a coalesced row — "and 199 others" — or null for a row that is one event.
 *
 * `count` is how many events folded into this row, so the row already names one of them and
 * the tail is about the rest. Getting that off by one is the difference between an inbox
 * that says 200 issues changed and one that says 201 did.
 */
/**
 * How old a row is, in the two or three characters a 58px row has room for.
 *
 * "6d" rather than "6 days ago": the column is read for its magnitude, at a glance, down a
 * list — the full sentence is on the `<time>`'s tooltip for anyone who wants it. Truncated
 * rather than rounded, like `when`, because "2d" for something 36 hours old is a claim about
 * the future. Under a minute reads "now": a row that arrived while the inbox was open is the
 * one case the reader already knows the answer to.
 */
export function age(timestamp: string, now: number = Date.now()): string {
  const at = Date.parse(timestamp);
  if (Number.isNaN(at)) return '';
  const seconds = Math.max(0, Math.trunc((now - at) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.trunc(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.trunc(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.trunc(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.trunc(days / 7)}w`;
  if (days < 365) return `${Math.trunc(days / 30)}mo`;
  return `${Math.trunc(days / 365)}y`;
}

export function coalescedTail(count: number): string | null {
  const others = count - 1;
  if (others <= 0) return null;
  return others === 1 ? 'and 1 other' : `and ${others} others`;
}

/** Rows the inbox can act on, newest first. Snoozed rows are absent until they wake. */
export function awakeNotificationIds(store: Store, now: number): UUID[] {
  return tabNotificationIds(store, now, 'inbox');
}

/**
 * The four answers the inbox can give, as tabs.
 *
 * They were two checkboxes in a popover — Show read, Show snoozed — and the pair could
 * express "everything" and "only unread" but not "only snoozed" or "only the ones I have
 * dealt with", which are the two questions an inbox is opened with once it has any volume
 * in it. Tabs also say which answer you are looking at without being opened, which is the
 * thing a checkbox in a popover can never do: "why is my inbox empty" is a question the old
 * control caused and could not answer.
 *
 * `inbox` is deliberately the union of `unread` and `done` rather than a fifth thing. The
 * default screen is the whole live inbox, in one run, newest first — an inbox that hid what
 * you had read would be a queue rather than a record, and the row you want to find again is
 * usually one you have already seen.
 */
export type InboxTab = 'inbox' | 'unread' | 'snoozed' | 'done';

export const INBOX_TABS: readonly InboxTab[] = ['inbox', 'unread', 'snoozed', 'done'];

export const DEFAULT_INBOX_TAB: InboxTab = 'inbox';

/** What each tab is called, in the row and in the empty state that explains it. */
export const INBOX_TAB_NAMES: Readonly<Record<InboxTab, string>> = {
  inbox: 'Inbox',
  unread: 'Unread',
  snoozed: 'Snoozed',
  done: 'Done',
};

/**
 * Whether one row belongs in one tab, at one instant.
 *
 * Every tab except `snoozed` asks `isAwake` first, so a row put aside until Monday is in
 * exactly one place all weekend and moves by itself when the clock passes it. That is the
 * whole reason this is a function of `now` rather than of the row alone.
 */
export function matchesTab(row: Notification, now: number, tab: InboxTab): boolean {
  const awake = isAwake(row, now);
  switch (tab) {
    case 'unread':
      return awake && row.readAt === undefined;
    case 'snoozed':
      return !awake;
    case 'done':
      return awake && row.readAt !== undefined;
    default:
      return awake;
  }
}

/** The rows of one tab, newest first. */
export function tabNotificationIds(store: Store, now: number, tab: InboxTab): UUID[] {
  const rows: Notification[] = [];
  for (const row of store.notifications.values()) {
    if (matchesTab(row, now, tab)) rows.push(row);
  }
  rows.sort(byNewest);
  return rows.map((row) => row.id);
}

export type InboxTabCounts = Readonly<Record<InboxTab, number>>;

/**
 * How many rows each tab holds, in one walk of the table.
 *
 * One walk rather than four, because the counts are drawn on every tab on every render and
 * the table holds every notification the replica has ever received. The counts and the list
 * ask `matchesTab` the same question with the same clock, so a tab can never say 3 and then
 * draw two rows.
 */
export function tabCounts(store: Store, now: number): InboxTabCounts {
  const counts = { inbox: 0, unread: 0, snoozed: 0, done: 0 };
  for (const row of store.notifications.values()) {
    for (const tab of INBOX_TABS) if (matchesTab(row, now, tab)) counts[tab]++;
  }
  return counts;
}

/**
 * The next tab along, wrapping.
 *
 * Exported so the two registered actions and their test agree on what "next" means without
 * the view owning the arithmetic.
 */
export function stepTab(tab: InboxTab, step: 1 | -1): InboxTab {
  const at = INBOX_TABS.indexOf(tab);
  const next = (at + step + INBOX_TABS.length) % INBOX_TABS.length;
  return INBOX_TABS[next] ?? tab;
}

/** A run of rows that happened on one day, in the order the list draws them. */
export interface DayGroup<T> {
  /** The day, as `2026-08-16`. Stable, so `ListGroup` can remember the fold against it. */
  readonly key: string;
  /** What the header says: Today, Yesterday, or the date. */
  readonly name: string;
  readonly rows: readonly T[];
}

/**
 * Cuts a newest-first list into day groups without reordering it.
 *
 * The rows arrive sorted, so this is one pass that starts a group whenever the day key
 * changes rather than a bucket-and-sort — which matters because a bucketing version would
 * have to decide an order for the buckets, and the only correct one is the order the rows
 * were already in.
 */
export function groupByDay<T extends { readonly createdAt: string }>(
  rows: readonly T[],
  timezone: string,
  now: number = Date.now(),
): DayGroup<T>[] {
  const groups: { key: string; name: string; rows: T[] }[] = [];
  for (const row of rows) {
    const key = dayKeyOf(row.createdAt, timezone);
    const last = groups[groups.length - 1];
    if (last !== undefined && last.key === key) last.rows.push(row);
    else groups.push({ key, name: dayGroupName(key, timezone, now), rows: [row] });
  }
  return groups;
}

/**
 * What a day group is called: Today, Yesterday, or the date itself.
 *
 * Named relative to the reader's own day for the two days they are living in, and by the
 * date for everything older — "3 days ago" is arithmetic the reader has to do backwards to
 * find out when something actually happened, and an inbox is read to find out when.
 */
export function dayGroupName(dayKey: string, timezone: string, now: number = Date.now()): string {
  if (dayKey === dayKeyOf(new Date(now).toISOString(), timezone)) return 'Today';
  if (dayKey === dayKeyOf(new Date(now - DAY_MS).toISOString(), timezone)) return 'Yesterday';
  const at = Date.parse(`${dayKey}T12:00:00.000Z`);
  if (Number.isNaN(at)) return dayKey;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(at);
}

const DAY_MS = 86_400_000;

/**
 * Whether a haystack matches the inbox's Cmd+F filter.
 *
 * Substring, case-insensitive, after trim. An empty query matches everything: clearing
 * the box is how you leave find, and a filter that hid the inbox because you typed a
 * space would feel like a bug.
 */
export function matchesInboxQuery(haystack: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return haystack.toLowerCase().includes(needle);
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
