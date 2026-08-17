/**
 * The inbox.
 *
 * Every row here derives from a change-log row, which is why it can say what happened
 * rather than that something did. A row that folded several events carries the count, so a
 * bulk edit of two hundred issues reads as one line saying so instead of two hundred lines
 * saying nothing.
 *
 * Two things about this screen are unlike the rest of the client.
 *
 * **It expires.** A snoozed row wakes when its time passes, and nothing is written when it
 * does — the predicate is a comparison against the clock. So the answer this screen shows
 * is only true until a known instant, and `useWakingQuery` arms a timer for exactly that
 * instant rather than polling. Polling would either be too slow to be honest or fast enough
 * to re-render an idle window forever.
 *
 * **It reads from the replica, not from a query.** The inbox is delta-driven like
 * everything else: a notification arriving over the socket appears without a refetch. The
 * one query is the backfill on mount, for rows written while this client was away.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions } from '~/app/keymap';
import { Avatar, Button, EmptyState, Menu, type MenuNode } from '~/components';
import { browserTimezone } from '~/features/locale';
import { when } from '~/features/time';
import {
  awakeNotificationIds,
  coalescedTail,
  dayKeyOf,
  describeEvent,
  useWakingQuery,
} from '~/features/inbox/inbox';
import {
  dismissNotification,
  hydrateInbox,
  markAllNotificationsRead,
  markNotificationRead,
  report,
  snoozeNotification,
} from '~/features/inbox/mutations';
import type { Store, UUID } from '~/store';
import styles from './Inbox.module.css';

interface Row {
  readonly id: UUID;
  readonly actor: string;
  readonly event: string;
  readonly tail: string | null;
  readonly createdAt: string;
  readonly unread: boolean;
  readonly snoozedUntil: string | undefined;
  readonly issueIdentifier: string | undefined;
  readonly avatarName: string;
}

interface InboxAnswer {
  readonly rows: readonly Row[];
  readonly unread: number;
  readonly wakeAt: number | null;
}

export function Inbox() {
  const engine = useEngine();
  const navigate = useNavigate();
  const timezone = browserTimezone();

  const [cursor, setCursor] = useState(0);
  const snoozeTrigger = useRef<HTMLButtonElement>(null);
  const [snoozeFor, setSnoozeFor] = useState<UUID | null>(null);

  // The backfill. Everything after this arrives as a delta, so this runs once and is not a
  // refresh the user can trigger — a button that refetches a stream that is already live
  // teaches people to distrust the stream.
  useEffect(() => {
    hydrateInbox(engine).catch(report);
  }, [engine]);

  const { rows, unread } = useWakingQuery<InboxAnswer>(
    useCallback((store: Store, now: number) => {
      const ids = awakeNotificationIds(store, now);
      const built: Row[] = [];
      let unreadCount = 0;
      let wake: number | null = null;

      for (const row of store.notifications.values()) {
        if (row.snoozedUntil === undefined) continue;
        const until = Date.parse(row.snoozedUntil);
        if (!Number.isNaN(until) && until > now && (wake === null || until < wake)) {
          wake = until;
        }
      }

      for (const id of ids) {
        const notification = store.notifications.get(id);
        if (notification === undefined) continue;

        const issue =
          notification.issueId === undefined ? undefined : store.get('issue', notification.issueId);
        const actor =
          notification.actor.id === undefined
            ? undefined
            : store.get('user', notification.actor.id);

        if (notification.readAt === undefined) unreadCount++;

        built.push({
          id,
          // "Somebody" rather than a blank: the actor may be a user this client has not
          // replicated, or the system, and a row with no subject reads as a bug.
          actor: actor?.displayName ?? 'Somebody',
          avatarName: actor?.displayName ?? 'Polaris',
          event: describeEvent(notification.type, issue?.identifier ?? 'an issue'),
          tail: coalescedTail(notification.count),
          createdAt: notification.createdAt,
          unread: notification.readAt === undefined,
          snoozedUntil: notification.snoozedUntil,
          issueIdentifier: issue?.identifier,
        });
      }

      return { rows: built, unread: unreadCount, wakeAt: wake };
    }, []),
    ['notification', 'issue', 'user'],
  );

  // Clamped rather than reset: marking the last row read shortens the list, and a cursor
  // that jumped back to the top every time would make working down an inbox impossible.
  const active = Math.min(cursor, Math.max(rows.length - 1, 0));
  const current = rows[active];

  const open = useCallback(
    (row: Row | undefined) => {
      if (row === undefined) return;
      if (row.unread) markNotificationRead(engine, row.id, true).catch(report);
      if (row.issueIdentifier !== undefined) void navigate(`/issue/${row.issueIdentifier}`);
    },
    [engine, navigate],
  );

  useActions(
    [
      {
        id: 'inbox.next',
        title: 'Next notification',
        keys: ['j', 'ArrowDown'],
        group: 'Inbox',
        run: () => setCursor((c) => Math.min(c + 1, Math.max(rows.length - 1, 0))),
      },
      {
        id: 'inbox.previous',
        title: 'Previous notification',
        keys: ['k', 'ArrowUp'],
        group: 'Inbox',
        run: () => setCursor((c) => Math.max(c - 1, 0)),
      },
      {
        id: 'inbox.open',
        title: 'Open notification',
        keys: ['Enter'],
        group: 'Inbox',
        run: () => open(current),
      },
      {
        id: 'inbox.toggleRead',
        title: 'Mark read or unread',
        keys: ['e'],
        group: 'Inbox',
        run: () => {
          if (current === undefined) return;
          markNotificationRead(engine, current.id, current.unread).catch(report);
        },
      },
      {
        id: 'inbox.snooze',
        title: 'Snooze notification',
        keys: ['h'],
        group: 'Inbox',
        run: () => {
          if (current !== undefined) setSnoozeFor(current.id);
        },
      },
      {
        id: 'inbox.dismiss',
        title: 'Dismiss notification',
        keys: ['Backspace'],
        group: 'Inbox',
        run: () => {
          if (current !== undefined) dismissNotification(engine, current.id).catch(report);
        },
      },
      {
        id: 'inbox.markAllRead',
        title: 'Mark everything read',
        keys: ['shift+e'],
        group: 'Inbox',
        run: () => markAllNotificationsRead(engine).catch(report),
      },
    ],
    [rows.length, current, engine, open],
  );

  const days = groupByDay(rows, timezone);

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Inbox</h1>
        {/* A live region, because the count is the answer to "did that work?" after marking
            a row read — and the row itself is one line in a list nobody is watching. */}
        <span className={styles.count} role="status" aria-live="polite">
          {unread === 0 ? 'All read' : `${unread} unread`}
        </span>
        <div className={styles.spacer} />
        <Button
          size="sm"
          disabled={unread === 0}
          onClick={() => markAllNotificationsRead(engine).catch(report)}
        >
          Mark all read
        </Button>
      </header>

      {rows.length === 0 ? (
        <div className={styles.empty}>
          <EmptyState
            title="Nothing here"
            description="You are subscribed to the issues you create, are assigned, comment on or are mentioned in. Anything that happens to them lands here."
          />
        </div>
      ) : (
        <ul
          className={styles.list}
          // A listbox rather than a plain list: the cursor is managed here rather than by
          // the browser's focus, so the active row has to be announced as such.
          role="listbox"
          aria-label="Notifications"
          aria-activedescendant={current === undefined ? undefined : `notification-${current.id}`}
        >
          {days.map(([day, dayRows]) => (
            <li key={day}>
              <div className={styles.day}>{dayLabel(day, timezone)}</div>
              <ul role="none">
                {dayRows.map((row) => (
                  <li key={row.id} role="none">
                    <button
                      type="button"
                      id={`notification-${row.id}`}
                      role="option"
                      aria-selected={row.id === current?.id}
                      className={[
                        styles.row,
                        row.unread ? styles.unread : null,
                        row.id === current?.id ? styles.active : null,
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => {
                        setCursor(rows.indexOf(row));
                        open(row);
                      }}
                    >
                      <span className={styles.dot} aria-hidden="true" />
                      <span className={styles.text}>
                        <Avatar name={row.avatarName} size="xs" />
                        <span className={styles.actor}>{row.actor}</span>
                        <span className={styles.event}>{row.event}</span>
                        {row.tail === null ? null : <span className={styles.tail}>{row.tail}</span>}
                      </span>
                      <span className={styles.when} title={row.createdAt}>
                        {when(row.createdAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <button type="button" ref={snoozeTrigger} hidden aria-hidden="true" tabIndex={-1} />
      <Menu
        open={snoozeFor !== null}
        onClose={() => setSnoozeFor(null)}
        trigger={snoozeTrigger}
        label="Snooze until"
        items={snoozeOptions((until) => {
          if (snoozeFor !== null) snoozeNotification(engine, snoozeFor, until).catch(report);
          setSnoozeFor(null);
        })}
      />
    </div>
  );
}

/**
 * The snooze choices.
 *
 * Relative rather than absolute, and deliberately few. "Tomorrow" is a decision somebody
 * can make in a second; "next Tuesday at 09:00" is a calendar they have to open, and an
 * inbox that asks for a calendar is one people stop snoozing from.
 */
function snoozeOptions(onPick: (until: Date | null) => void): MenuNode[] {
  const at = (hours: number) => {
    const d = new Date();
    d.setHours(d.getHours() + hours, 0, 0, 0);
    return d;
  };
  const tomorrowMorning = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  };
  const nextWeek = () => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    d.setHours(9, 0, 0, 0);
    return d;
  };

  return [
    { id: 'hour', label: 'In an hour', onSelect: () => onPick(at(1)) },
    { id: 'tomorrow', label: 'Tomorrow morning', onSelect: () => onPick(tomorrowMorning()) },
    { id: 'week', label: 'Next week', onSelect: () => onPick(nextWeek()) },
    { kind: 'separator' },
    { id: 'clear', label: 'Do not snooze', onSelect: () => onPick(null) },
  ];
}

/** Rows in day order, newest day first, preserving the order within each day. */
function groupByDay(rows: readonly Row[], timezone: string): [string, Row[]][] {
  const days = new Map<string, Row[]>();
  for (const row of rows) {
    const key = dayKeyOf(row.createdAt, timezone);
    const bucket = days.get(key);
    if (bucket === undefined) days.set(key, [row]);
    else bucket.push(row);
  }
  // The rows arrive newest-first, so insertion order is already day order and sorting would
  // only be a chance to disagree with it.
  return [...days.entries()];
}

/** "Today", "Yesterday", or the date. The same three-name rule the rest of the product uses. */
function dayLabel(day: string, timezone: string): string {
  const today = dayKeyOf(new Date().toISOString(), timezone);
  if (day === today) return 'Today';

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === dayKeyOf(yesterday.toISOString(), timezone)) return 'Yesterday';

  return day;
}
