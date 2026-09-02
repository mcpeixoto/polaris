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

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import {
  Avatar,
  Button,
  Checkbox,
  EmptyState,
  Input,
  Menu,
  priorityLabel,
  type MenuNode,
} from '~/components';
import { browserTimezone } from '~/features/locale';
import { AssigneePicker, PriorityPicker, StatusPicker } from '~/features/issue/pickers';
import { updateIssues, type IssueFields } from '~/features/issue/mutations';
import { exact, when } from '~/features/time';
import {
  coalescedTail,
  dayKeyOf,
  DEFAULT_INBOX_DISPLAY,
  describeEvent,
  isAwake,
  matchesInboxQuery,
  notificationHref,
  payloadId,
  useWakingQuery,
  visibleNotificationIds,
  type InboxDisplay,
} from '~/features/inbox/inbox';
import {
  dismissNotification,
  dismissReadNotifications,
  hydrateInbox,
  markAllNotificationsRead,
  markNotificationRead,
  report,
  snoozeNotification,
} from '~/features/inbox/mutations';
import { useViewerId } from '~/hooks/useViewer';
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
  readonly href: string | undefined;
  readonly avatarName: string;
  readonly haystack: string;
  /**
   * The issue the row is about, when there is one.
   *
   * Carried on the row rather than looked up when the contextual menu opens, because the
   * menu offers property updates and every one of them needs the current value to draw its
   * tick — and a lookup at open time would be a second read of a store this screen has
   * already walked.
   */
  readonly issue: RowIssue | null;
}

interface RowIssue {
  readonly id: UUID;
  readonly teamId: UUID;
  readonly stateId: UUID;
  readonly assigneeId: UUID | null;
  readonly priority: number;
}

interface InboxAnswer {
  readonly rows: readonly Row[];
  readonly unread: number;
  readonly wakeAt: number | null;
  /**
   * How many rows the two display toggles are holding back, split by which toggle is doing
   * it.
   *
   * Only the empty state reads these, and only to say which kind of empty this is. An inbox
   * with forty read notifications and Show read off is not the same screen as an inbox with
   * nothing in it, and it used to say the same sentence on both — a first-run explanation of
   * what the inbox is for, to somebody who had just cleared theirs.
   */
  readonly hiddenRead: number;
  readonly hiddenSnoozed: number;
}

export function Inbox() {
  const engine = useEngine();
  const navigate = useNavigate();
  const timezone = browserTimezone();

  const [cursor, setCursor] = useState(0);
  const findRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  /**
   * What a menu opened from this screen hangs off: the row it is about.
   *
   * It used to be a hidden button parked at the bottom of the screen. `Menu` positions
   * itself against its trigger and hands focus back to it on close, and neither works on an
   * element with `hidden` — the menu opened at the top-left corner of the window, and
   * closing it dropped focus to `<body>`, which took the keyboard out of the inbox
   * altogether the moment somebody snoozed a row. A real element from the list is both the
   * right place to draw a menu and a place focus can go.
   */
  const anchor = useRef<HTMLElement | null>(null);
  const [snoozeFor, setSnoozeFor] = useState<UUID | null>(null);
  const [contextFor, setContextFor] = useState<Row | null>(null);
  const [picker, setPicker] = useState<'status' | 'assignee' | 'priority' | null>(null);
  const [display, setDisplay] = useState<InboxDisplay>(DEFAULT_INBOX_DISPLAY);
  const [query, setQuery] = useState('');
  const viewerId = useViewerId();

  // The backfill. Everything after this arrives as a delta, so this runs once and is not a
  // refresh the user can trigger — a button that refetches a stream that is already live
  // teaches people to distrust the stream.
  useEffect(() => {
    hydrateInbox(engine).catch(report);
  }, [engine]);

  const { rows, unread, hiddenRead, hiddenSnoozed } = useWakingQuery<InboxAnswer>(
    useCallback(
      (store: Store, now: number) => {
        const ids = visibleNotificationIds(store, now, display);
        const built: Row[] = [];
        let unreadCount = 0;
        let hiddenReadCount = 0;
        let hiddenSnoozedCount = 0;
        let wake: number | null = null;

        for (const row of store.notifications.values()) {
          if (row.readAt === undefined && isAwake(row, now)) unreadCount++;
          // The same two questions `visibleNotificationIds` asks, in the same order, so the
          // count of what is held back cannot disagree with what is drawn. Read wins the tie:
          // a row that is both read and asleep is one row, and counting it twice would put
          // "read or snoozed" on screen for a single hidden notification.
          if (row.readAt !== undefined && !display.showRead) hiddenReadCount++;
          else if (!isAwake(row, now) && !display.showSnoozed) hiddenSnoozedCount++;
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
            notification.issueId === undefined
              ? undefined
              : store.get('issue', notification.issueId);
          const actor =
            notification.actor.id === undefined
              ? undefined
              : store.get('user', notification.actor.id);
          const team = issue === undefined ? undefined : store.get('team', issue.teamId);
          const project =
            issue?.projectId === undefined ? undefined : store.get('project', issue.projectId);
          const assignee =
            issue?.assigneeId === undefined ? undefined : store.get('user', issue.assigneeId);

          const identifier = issue?.identifier;
          const event = describeEvent(
            notification.type,
            identifier ?? 'an issue',
            notification.payload,
          );
          // "Somebody" rather than a blank: the actor may be a user this client has not
          // replicated, or the system, and a row with no subject reads as a bug.
          const actorName =
            actor?.displayName ?? (notification.type === 'pulse_digest' ? 'Polaris' : 'Somebody');
          const watchedProjectId = payloadId(notification.payload, 'projectId');
          const watchedInitiativeId = payloadId(notification.payload, 'initiativeId');
          const watchedCustomerId = payloadId(notification.payload, 'customerId');
          const watchedProject =
            watchedProjectId === undefined ? undefined : store.get('project', watchedProjectId);
          const watchedInitiative =
            watchedInitiativeId === undefined
              ? undefined
              : store.get('initiative', watchedInitiativeId);
          const watchedCustomer =
            watchedCustomerId === undefined ? undefined : store.get('customer', watchedCustomerId);
          const builtRow: Row = {
            id,
            actor: actorName,
            avatarName: actor?.displayName ?? 'Polaris',
            event,
            tail: coalescedTail(notification.count),
            createdAt: notification.createdAt,
            unread: notification.readAt === undefined,
            snoozedUntil: notification.snoozedUntil,
            issueIdentifier: identifier,
            href: notificationHref(notification.type, notification.payload, notification.issueId),
            issue:
              issue === undefined
                ? null
                : {
                    id: issue.id,
                    teamId: issue.teamId,
                    stateId: issue.stateId,
                    assigneeId: issue.assigneeId ?? null,
                    priority: issue.priority,
                  },
            haystack: [
              actorName,
              event,
              identifier,
              issue?.title,
              notification.type.replaceAll('_', ' '),
              team?.key,
              team?.name,
              project?.name,
              watchedProject?.name,
              watchedInitiative?.name,
              watchedCustomer?.name,
              assignee === undefined ? undefined : assignee.displayName,
              issue === undefined ? undefined : priorityLabel(issue.priority),
            ]
              .filter((part): part is string => part !== undefined && part !== '')
              .join(' '),
          };
          if (!matchesInboxQuery(builtRow.haystack, query)) continue;
          built.push(builtRow);
        }

        return {
          rows: built,
          unread: unreadCount,
          wakeAt: wake,
          hiddenRead: hiddenReadCount,
          hiddenSnoozed: hiddenSnoozedCount,
        };
      },
      [display, query],
    ),
    ['notification', 'issue', 'user', 'team', 'project', 'initiative', 'customer'],
    [display.showRead, display.showSnoozed, query],
  );

  // Clamped rather than reset: marking the last row read shortens the list, and a cursor
  // that jumped back to the top every time would make working down an inbox impossible.
  const active = Math.min(cursor, Math.max(rows.length - 1, 0));
  const current = rows[active];

  const open = useCallback(
    (row: Row | undefined) => {
      if (row === undefined) return;
      if (row.unread) markNotificationRead(engine, row.id, true).catch(report);
      if (row.href !== undefined) {
        void navigate(row.href);
        return;
      }
      if (row.issueIdentifier !== undefined) void navigate(`/issue/${row.issueIdentifier}`);
    },
    [engine, navigate],
  );

  /*
   * The cursor is followed by the scroller as well as by the list's ARIA.
   *
   * This screen manages its cursor with `aria-activedescendant` rather than by moving focus,
   * which is the right model for a listbox and takes the browser's own scroll-on-focus away
   * with it. Without this, `J` down a full inbox moved an invisible cursor and Enter opened a
   * notification the reader had never seen. The same three lines as Search and Menu, for the
   * same reason.
   */
  useEffect(() => {
    if (current === undefined) return;
    const node = rowNode(current.id);
    // Guarded because this is decoration, not behaviour: jsdom lays nothing out and does not
    // implement scrollIntoView, and a cursor that cannot scroll is still a cursor.
    if (node !== null && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest' });
    }
  }, [current]);

  /** Opens a menu about `row`, hung off the row itself. */
  const openOn = useCallback((row: Row | undefined, show: (row: Row) => void) => {
    if (row === undefined) return;
    anchor.current = rowNode(row.id);
    show(row);
  }, []);

  /**
   * Where focus goes when a menu closes.
   *
   * Not back to the trigger, which is the row the menu was about and which a snooze has just
   * taken off the screen. The list owns the cursor, so the list is where the keyboard belongs
   * — and it can hold focus because it carries `aria-activedescendant`, which is the whole
   * point of that attribute.
   */
  const returnToList = useCallback(() => listRef.current?.focus(), []);

  /**
   * Whether the contextual menu is closing because it is handing over to a picker.
   *
   * `Menu` closes itself after an item is chosen, and three of its items exist only to open
   * another menu about the same row. Without this the handover would clear the row the
   * picker was about in the same tick it was chosen, and the picker would open on nothing.
   */
  const handingOver = useRef(false);

  const closePicker = useCallback(() => {
    setPicker(null);
    setContextFor(null);
    returnToList();
  }, [returnToList]);

  const updateIssue = (fields: IssueFields) => {
    const issueId = contextFor?.issue?.id;
    setPicker(null);
    setContextFor(null);
    if (issueId !== undefined) updateIssues(engine, [issueId], fields, viewerId).catch(report);
  };

  // The inbox is a list screen, and its shortcuts belong to the list context rather than to
  // the whole application.
  //
  // Not a tidiness point. `inbox.find.clear` is bound to Escape, `app.dismiss` in the shell
  // is bound to Escape with no guard, and the registry refuses two bindings on one key in
  // one context when either of them is unguarded — so registering these in `global` threw
  // during the effect that mounts them, took `AppShell` down with it, and left /inbox a
  // blank page for everybody. Scoping them to `list` is what every other list screen in the
  // product already does, and it is also what makes Escape fall through to the shell's
  // dismiss when the find box is empty instead of racing it.
  useKeyContext('list');
  useActions(
    [
      {
        id: 'inbox.next',
        title: 'Next notification',
        keys: ['j', 'ArrowDown'],
        when: 'list',
        group: 'Inbox',
        run: () => setCursor((c) => Math.min(c + 1, Math.max(rows.length - 1, 0))),
      },
      {
        id: 'inbox.previous',
        title: 'Previous notification',
        keys: ['k', 'ArrowUp'],
        when: 'list',
        group: 'Inbox',
        run: () => setCursor((c) => Math.max(c - 1, 0)),
      },
      {
        id: 'inbox.open',
        title: 'Open notification',
        keys: ['Enter'],
        when: 'list',
        group: 'Inbox',
        run: () => open(current),
      },
      {
        id: 'inbox.toggleRead',
        title: 'Mark read or unread',
        keys: ['u', 'e'],
        when: 'list',
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
        when: 'list',
        group: 'Inbox',
        run: () => openOn(current, (row) => setSnoozeFor(row.id)),
      },
      {
        id: 'inbox.dismiss',
        title: 'Dismiss notification',
        keys: ['Backspace'],
        when: 'list',
        group: 'Inbox',
        run: () => {
          if (current !== undefined) dismissNotification(engine, current.id).catch(report);
        },
      },
      {
        id: 'inbox.dismissRead',
        title: 'Dismiss all read',
        keys: ['shift+Backspace'],
        when: 'list',
        group: 'Inbox',
        run: () => dismissReadNotifications(engine).catch(report),
      },
      {
        id: 'inbox.markAllRead',
        title: 'Mark everything read',
        keys: ['alt+u', 'shift+e'],
        when: 'list',
        group: 'Inbox',
        run: () => markAllNotificationsRead(engine).catch(report),
      },
      {
        id: 'inbox.find',
        title: 'Find in inbox',
        keys: ['mod+f'],
        when: 'list',
        group: 'Inbox',
        run: () => findRef.current?.focus(),
      },
      {
        id: 'inbox.find.clear',
        title: 'Clear inbox find',
        keys: ['Escape'],
        when: 'list',
        group: 'Inbox',
        hidden: true,
        enabled: () => query.trim() !== '',
        run: () => {
          setQuery('');
          findRef.current?.blur();
        },
      },
    ],
    [rows.length, current, engine, open, openOn, query],
  );

  const days = groupByDay(rows, timezone);

  /**
   * Which kind of empty this is, and the way out of it.
   *
   * Three of them, and they were one. A find that matched nothing, an inbox whose contents
   * are all read or all snoozed, and an inbox that has genuinely never had anything in it are
   * different situations with different answers, and the sentence that fits the third — an
   * explanation of what subscribes you to an issue — is faintly insulting to somebody who has
   * just finished clearing the first two.
   *
   * Each carries the action that undoes the state it describes, which is the same thing the
   * control above it does: Escape and the find box, the two display checkboxes. Nothing here
   * is a new command.
   */
  const emptyState = ((): { title: string; description: string; action?: ReactNode } => {
    if (query.trim() !== '') {
      return {
        title: 'No matches',
        description: 'Nothing in the inbox matches that find. Escape clears it.',
        action: (
          <Button
            size="sm"
            onClick={() => {
              setQuery('');
              findRef.current?.focus();
            }}
          >
            Clear find
          </Button>
        ),
      };
    }
    if (hiddenRead > 0 || hiddenSnoozed > 0) {
      const kinds = [hiddenRead > 0 ? 'read' : null, hiddenSnoozed > 0 ? 'snoozed' : null]
        .filter((kind): kind is string => kind !== null)
        .join(' or ');
      return {
        title: 'Nothing unread',
        description: `The rest of this inbox is ${kinds}, and hidden by the boxes above.`,
        action: (
          <Button
            size="sm"
            onClick={() =>
              setDisplay((prev) => ({
                showRead: prev.showRead || hiddenRead > 0,
                showSnoozed: prev.showSnoozed || hiddenSnoozed > 0,
              }))
            }
          >
            {`Show ${kinds.replace(' or ', ' and ')}`}
          </Button>
        ),
      };
    }
    return {
      title: 'Nothing here',
      description:
        'You are subscribed to the issues you create, are assigned, comment on or are mentioned in. Anything that happens to them lands here.',
    };
  })();

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Inbox</h1>
        {/* A live region, because the count is the answer to "did that work?" after marking
            a row read — and the row itself is one line in a list nobody is watching. */}
        <span className={styles.count} role="status" aria-live="polite">
          {unread === 0 ? 'All read' : `${unread} unread`}
        </span>
        <div className={styles.find}>
          <Input
            ref={findRef}
            label="Find in inbox"
            hideLabel
            placeholder="Find"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Checkbox
          checked={display.showRead}
          onChange={(event) => setDisplay((prev) => ({ ...prev, showRead: event.target.checked }))}
          label="Show read"
        />
        <Checkbox
          checked={display.showSnoozed}
          onChange={(event) =>
            setDisplay((prev) => ({ ...prev, showSnoozed: event.target.checked }))
          }
          label="Show snoozed"
        />
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
            title={emptyState.title}
            description={emptyState.description}
            action={emptyState.action}
          />
        </div>
      ) : (
        <ul
          ref={listRef}
          className={styles.list}
          // A listbox rather than a plain list: the cursor is managed here rather than by
          // the browser's focus, so the active row has to be announced as such.
          role="listbox"
          aria-label="Notifications"
          // Focusable so a menu opened from a row has somewhere to hand the keyboard back to
          // when that row has been snoozed out from under it. Not in the tab order: the rows
          // are buttons and are already reachable.
          tabIndex={-1}
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
                      // The contextual menu the spec asks for, on the row the pointer is
                      // over rather than on the cursor's row: right-clicking a notification
                      // is a statement about that one, so the cursor moves to it first and
                      // the menu then acts on the cursor like every other command here.
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setCursor(rows.indexOf(row));
                        openOn(row, setContextFor);
                      }}
                    >
                      <span className={styles.dot} aria-hidden="true" />
                      {/* The dot is a picture, so it says nothing to a screen reader, and
                          weight says nothing either: read and unread were the same row
                          announced the same way. One hidden word is the whole fix, and it
                          leads the option so it is heard before the sentence it qualifies. */}
                      {row.unread ? <span className={styles.unreadName}>Unread</span> : null}
                      <span className={styles.text}>
                        <Avatar name={row.avatarName} size="xs" />
                        <span className={styles.actor}>{row.actor}</span>
                        <span className={styles.event}>{row.event}</span>
                        {row.tail === null ? null : <span className={styles.tail}>{row.tail}</span>}
                      </span>
                      <time
                        className={styles.when}
                        dateTime={row.createdAt}
                        title={exact(row.createdAt)}
                      >
                        {when(row.createdAt)}
                      </time>
                      {row.snoozedUntil === undefined ? null : (
                        <span className={styles.snoozed}>Snoozed</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <Menu
        open={snoozeFor !== null}
        onClose={() => {
          setSnoozeFor(null);
          returnToList();
        }}
        trigger={anchor}
        label="Snooze until"
        items={snoozeOptions((until) => {
          if (snoozeFor !== null) snoozeNotification(engine, snoozeFor, until).catch(report);
          setSnoozeFor(null);
        })}
      />
      <Menu
        open={contextFor !== null && picker === null}
        onClose={() => {
          if (handingOver.current) {
            handingOver.current = false;
            return;
          }
          setContextFor(null);
          returnToList();
        }}
        trigger={anchor}
        label="Notification"
        items={contextItems(contextFor, {
          open: () => open(contextFor ?? undefined),
          toggleRead: () => {
            if (contextFor !== null) {
              markNotificationRead(engine, contextFor.id, contextFor.unread).catch(report);
            }
          },
          snooze: () => {
            if (contextFor !== null) setSnoozeFor(contextFor.id);
          },
          dismiss: () => {
            if (contextFor !== null) dismissNotification(engine, contextFor.id).catch(report);
          },
          pick: (kind) => {
            handingOver.current = true;
            setPicker(kind);
          },
        })}
      />
      {/* The issue behind the notification, edited from the inbox — the half of the
          contextual menu the spec names explicitly. The pickers hang off the same row the
          menu did, and closing one puts the keyboard back in the list rather than on a row
          that may have been read, snoozed or dismissed in the meantime. */}
      <StatusPicker
        open={picker === 'status' && contextFor?.issue != null}
        onClose={closePicker}
        trigger={anchor}
        teamId={contextFor?.issue?.teamId ?? ''}
        value={contextFor?.issue?.stateId}
        onSelect={(stateId) => updateIssue({ stateId })}
      />
      <AssigneePicker
        open={picker === 'assignee' && contextFor?.issue != null}
        onClose={closePicker}
        trigger={anchor}
        value={contextFor?.issue?.assigneeId}
        onSelect={(assigneeId) => updateIssue({ assigneeId })}
      />
      <PriorityPicker
        open={picker === 'priority' && contextFor?.issue != null}
        onClose={closePicker}
        trigger={anchor}
        value={contextFor?.issue?.priority}
        onSelect={(priority) => updateIssue({ priority })}
      />
    </div>
  );
}

/** The row's element. Stable per row, because `aria-activedescendant` has to name one. */
function rowNode(id: UUID): HTMLElement | null {
  return document.getElementById(`notification-${id}`);
}

/**
 * The contextual menu for one notification.
 *
 * Every entry is a command that already exists on this screen, with the key it is bound to
 * beside it — a right-click is a way of discovering the keyboard rather than a second,
 * pointer-only set of behaviours. The issue properties are the half the spec names
 * explicitly ("including issue property updates") and are offered only for a notification
 * that is about an issue: a Pulse digest or a project update has no status to change.
 */
function contextItems(
  row: Row | null,
  commands: {
    open: () => void;
    toggleRead: () => void;
    snooze: () => void;
    dismiss: () => void;
    pick: (kind: 'status' | 'assignee' | 'priority') => void;
  },
): MenuNode[] {
  if (row === null) return [];
  const items: MenuNode[] = [
    { id: 'open', label: 'Open notification', keys: 'Enter', onSelect: commands.open },
    {
      id: 'read',
      label: row.unread ? 'Mark read' : 'Mark unread',
      keys: 'u',
      onSelect: commands.toggleRead,
    },
    { id: 'snooze', label: 'Snooze', keys: 'h', onSelect: commands.snooze },
    { id: 'dismiss', label: 'Dismiss', keys: 'Backspace', onSelect: commands.dismiss },
  ];
  if (row.issue === null) return items;
  return [
    ...items,
    { kind: 'separator' },
    { kind: 'heading', label: row.issueIdentifier ?? 'Issue' },
    { id: 'status', label: 'Change status', onSelect: () => commands.pick('status') },
    { id: 'assignee', label: 'Assign to', onSelect: () => commands.pick('assignee') },
    { id: 'priority', label: 'Set priority', onSelect: () => commands.pick('priority') },
  ];
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
