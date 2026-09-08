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
 *
 * **It is four lists.** Inbox, Unread, Snoozed and Done are tabs rather than a pair of
 * checkboxes in a popover, because the two questions the checkboxes could not ask — what is
 * still asleep, what have I already dealt with — are the two an inbox with any volume in it
 * is opened with. Within a tab the rows are cut into day groups, and a kind filter narrows
 * them by why they arrived. All four are one arithmetic module away in `features/inbox`.
 *
 * **It is two panes.** The list on the left, 425px of it, and the issue the cursor row is
 * about on the right. Clicking a row still opens the issue for real — that is how most rows
 * get read, and the end-to-end walk holds it to that — so the pane is what the keyboard
 * sees: `J` and `K` move the cursor and the pane follows, the way Peek follows the cursor in
 * a list. Until the cursor has moved, the pane says how much is unread instead.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import {
  Avatar,
  Button,
  EmptyState,
  IconButton,
  Input,
  ListGroup,
  Menu,
  priorityLabel,
  StateIcon,
  Tabs,
  type MenuNode,
  type TabItem,
} from '~/components';
import { AssigneePicker, PriorityPicker, StatusPicker } from '~/features/issue/pickers';
import { updateIssues, type IssueFields } from '~/features/issue/mutations';
import { issueRowMenuItems, type IssuePropertyKind } from '~/features/issue/rowMenu';
import { useContextMenuHandoff } from '~/hooks/useContextMenuHandoff';
import { LabelPicker } from '~/features/labels/LabelPicker';
import { applyLabel, removeLabel } from '~/features/labels/mutations';
import { ProjectPicker } from '~/features/projects/ProjectPicker';
import { browserTimezone } from '~/features/locale';
import { exact } from '~/features/time';
import { notificationGlyph } from '~/features/inbox/glyphs';
import { InboxDetail } from '~/features/inbox/InboxDetail';
import {
  age,
  coalescedTail,
  DEFAULT_INBOX_TAB,
  describeEvent,
  groupByDay,
  INBOX_TABS,
  INBOX_TAB_NAMES,
  matchesInboxQuery,
  matchesTab,
  notificationHref,
  payloadId,
  stepTab,
  tabCounts,
  useWakingQuery,
  type InboxTab,
  type InboxTabCounts,
} from '~/features/inbox/inbox';
import {
  INBOX_KIND_GLYPH_TYPES,
  INBOX_KIND_NAMES,
  INBOX_KINDS,
  matchesKinds,
  type InboxKind,
} from '~/features/inbox/kinds';
import {
  dismissNotificationSoon,
  dismissReadNotifications,
  flushDismissals,
  hydrateInbox,
  markAllNotificationsRead,
  markNotificationRead,
  report,
  snoozeNotification,
} from '~/features/inbox/mutations';
import { offerUndo } from '~/features/undo/UndoToast';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useSelection } from '~/hooks/useSelection';
import { useViewerId } from '~/hooks/useViewer';
import type { NotificationType, StateCategory, Store, UUID } from '~/store';
import styles from './Inbox.module.css';

interface Row {
  readonly id: UUID;
  readonly type: NotificationType;
  readonly actor: string;
  readonly event: string;
  readonly tail: string | null;
  readonly createdAt: string;
  readonly unread: boolean;
  readonly snoozedUntil: string | undefined;
  readonly issueIdentifier: string | undefined;
  readonly issueTitle: string | undefined;
  /** The issue's workflow state, for the glyph at the row's right edge. */
  readonly state: { category: StateCategory; color: string | undefined } | null;
  readonly href: string | undefined;
  readonly avatarName: string;
  readonly avatarUrl: string | null;
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
  readonly projectId: UUID | null;
}

interface InboxAnswer {
  readonly rows: readonly Row[];
  readonly unread: number;
  readonly wakeAt: number | null;
  /**
   * How many rows each tab holds, before the find box and the kind filter narrow them.
   *
   * The tabs draw these, and the empty state reads them to say which kind of empty this is.
   * An inbox with forty rows in Done and nothing unread is not the same screen as an inbox
   * with nothing in it, and it used to say the same sentence on both — a first-run
   * explanation of what the inbox is for, to somebody who had just cleared theirs.
   */
  readonly counts: InboxTabCounts;
}

export function Inbox() {
  const engine = useEngine();
  const navigate = useNavigate();

  const [cursor, setCursor] = useState(0);
  /**
   * Whether the cursor has been placed on purpose.
   *
   * It starts on the newest row so that `U` and Backspace have something to act on, but a
   * cursor nobody has moved is not a selection, and the right-hand pane showing the newest
   * issue before anybody asked would make the inbox open on whatever happened last rather
   * than on the count. Set by the keyboard and by the contextual menu; a click navigates.
   */
  const [placed, setPlaced] = useState(false);
  const findRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
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
  const [picker, setPicker] = useState<IssuePropertyKind | null>(null);
  const [tab, setTab] = useState<InboxTab>(DEFAULT_INBOX_TAB);
  const [kinds, setKinds] = useState<ReadonlySet<InboxKind>>(() => new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLButtonElement>(null);
  const bulkSnoozeRef = useRef<HTMLButtonElement>(null);
  const [bulkSnoozeOpen, setBulkSnoozeOpen] = useState(false);
  const [query, setQuery] = useState('');
  const viewerId = useViewerId();
  const timezone = browserTimezone();

  // The backfill. Everything after this arrives as a delta, so this runs once and is not a
  // refresh the user can trigger — a button that refetches a stream that is already live
  // teaches people to distrust the stream.
  useEffect(() => {
    hydrateInbox(engine).catch(report);
  }, [engine]);

  // A dismissal waits out the undo window before it is sent (see `dismissNotificationSoon`),
  // and leaving the screen is the user having stopped deciding. Anything still held goes now
  // rather than dying with the timer that was holding it.
  useEffect(() => flushDismissals, []);

  const { rows, unread, counts } = useWakingQuery<InboxAnswer>(
    useCallback(
      (store: Store, now: number) => {
        const built: Row[] = [];
        const counted = tabCounts(store, now);
        let wake: number | null = null;

        for (const notification of store.notifications.values()) {
          if (notification.snoozedUntil !== undefined) {
            const until = Date.parse(notification.snoozedUntil);
            if (!Number.isNaN(until) && until > now && (wake === null || until < wake)) {
              wake = until;
            }
          }
          // The tab and the kind filter first, because both are one field comparison and
          // everything below them is a walk through five other tables.
          if (!matchesTab(notification, now, tab)) continue;
          if (!matchesKinds(notification.type, kinds)) continue;

          const id = notification.id;
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
          const state = issue === undefined ? undefined : store.workflowStates.get(issue.stateId);
          const builtRow: Row = {
            id,
            type: notification.type,
            actor: actorName,
            avatarName: actor?.displayName ?? 'Polaris',
            avatarUrl: actor?.avatarUrl ?? null,
            event,
            tail: coalescedTail(notification.count),
            createdAt: notification.createdAt,
            unread: notification.readAt === undefined,
            snoozedUntil: notification.snoozedUntil,
            issueIdentifier: identifier,
            issueTitle: issue?.title,
            state: state === undefined ? null : { category: state.category, color: state.color },
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
                    projectId: issue.projectId ?? null,
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

        // Newest first, with the id breaking a tie — a bulk edit delivers a run of rows
        // written in the same millisecond, and without the tie-break their order is whatever
        // the map happened to iterate.
        built.sort((a, b) => {
          const delta = Date.parse(b.createdAt) - Date.parse(a.createdAt);
          if (delta !== 0 && !Number.isNaN(delta)) return delta;
          return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
        });

        return { rows: built, unread: counted.unread, wakeAt: wake, counts: counted };
      },
      [tab, kinds, query],
    ),
    ['notification', 'issue', 'user', 'team', 'project', 'initiative', 'customer', 'workflowState'],
    [tab, kinds, query],
  );

  /** The rows in the order the list draws them — what a selection and a range resolve over. */
  const ids = useMemo(() => rows.map((row) => row.id), [rows]);
  const selection = useSelection(ids);
  const groups = useMemo(() => groupByDay(rows, timezone), [rows, timezone]);

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

  /** Moves the cursor on purpose, which is what puts its row in the pane. */
  const place = useCallback((next: (cursor: number) => number) => {
    setPlaced(true);
    setCursor(next);
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
  const contextHandoff = useContextMenuHandoff();

  const closePicker = useCallback(() => {
    setPicker(null);
    setContextFor(null);
    returnToList();
  }, [returnToList]);

  /*
   * What the row's label picker ticks, read live rather than carried on the row.
   *
   * The rows' own query does not subscribe to `issueLabel`, and adding it there would rebuild
   * every row in the inbox each time anybody anywhere applied a label. This asks the one
   * question the open menu needs, about the one issue it is about.
   */
  const contextLabelIds = useLiveQuery(
    (store) => {
      const issueId = contextFor?.issue?.id;
      return issueId === undefined ? [] : [...store.labelIdsFor(issueId)];
    },
    ['issueLabel'],
    [contextFor?.issue?.id ?? ''],
  );

  const updateIssue = (fields: IssueFields) => {
    const issueId = contextFor?.issue?.id;
    setPicker(null);
    setContextFor(null);
    if (issueId !== undefined) updateIssues(engine, [issueId], fields, viewerId).catch(report);
  };

  /**
   * What a command acts on: the selection when there is one, the cursor row otherwise.
   *
   * The same rule the issue list uses, and for the same reason — every shortcut on this
   * screen worked on one row before there was a selection, and a version where `U` meant one
   * thing with the bar up and another with it down would be two keyboards.
   */
  const targets = useCallback(
    (): readonly UUID[] =>
      selection.size > 0 ? selection.ordered : current === undefined ? [] : [current.id],
    [selection, current],
  );

  /**
   * Marks rows read, and offers the way back.
   *
   * One write per row rather than `markAllNotificationsRead`: that mutation clears the whole
   * inbox, which is a different command and is still bound to `alt+u`. A bulk mark-read over
   * eleven selected rows must touch eleven rows and no twelfth.
   *
   * The undo is a genuine inverse — `readAt` going away is a mutation the server has — and it
   * names only the rows that actually changed, so undoing does not un-read something that was
   * already read before the bar was used.
   */
  const markRead = useCallback(
    (ids: readonly UUID[]) => {
      const changed = ids.filter(
        (id) => engine.store.get('notification', id)?.readAt === undefined,
      );
      if (changed.length === 0) return;
      for (const id of changed) markNotificationRead(engine, id, true).catch(report);
      selection.clear();
      offerUndo({
        label: `Marked ${notificationCount(changed.length)} read`,
        undo: async () => {
          await Promise.all(changed.map((id) => markNotificationRead(engine, id, false)));
        },
      });
    },
    [engine, selection],
  );

  /**
   * Dismisses rows, and offers the way back for as long as the toast is up.
   *
   * The undo here is the request not having been sent yet rather than a second write — see
   * `dismissNotificationSoon`, which explains why this screen is the one place in the product
   * where that is the only honest arrangement.
   */
  const dismiss = useCallback(
    (ids: readonly UUID[]) => {
      if (ids.length === 0) return;
      const restore = ids.map((id) => dismissNotificationSoon(engine, id));
      selection.clear();
      offerUndo({
        label: `Dismissed ${notificationCount(ids.length)}`,
        undo: async () => {
          for (const put of restore) put();
        },
      });
    },
    [engine, selection],
  );

  /** Snoozes rows to the same moment. Snoozing is reversible by itself, so no undo is offered. */
  const snooze = useCallback(
    (ids: readonly UUID[], until: Date | null) => {
      for (const id of ids) snoozeNotification(engine, id, until).catch(report);
      selection.clear();
    },
    [engine, selection],
  );

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
        run: () => place((c) => Math.min(c + 1, Math.max(rows.length - 1, 0))),
      },
      {
        id: 'inbox.previous',
        title: 'Previous notification',
        keys: ['k', 'ArrowUp'],
        when: 'list',
        group: 'Inbox',
        run: () => place((c) => Math.max(c - 1, 0)),
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
          // A toggle on one row stays a toggle and offers no undo: pressing `U` again is the
          // undo, and a toast for it would be up more often than not.
          if (selection.size === 0) {
            if (current === undefined) return;
            markNotificationRead(engine, current.id, current.unread).catch(report);
            return;
          }
          markRead(selection.ordered);
        },
      },
      {
        id: 'inbox.snooze',
        title: 'Snooze notification',
        keys: ['h'],
        when: 'list',
        group: 'Inbox',
        run: () => {
          if (selection.size > 0) {
            bulkSnoozeRef.current?.focus();
            setBulkSnoozeOpen(true);
            return;
          }
          openOn(current, (row) => setSnoozeFor(row.id));
        },
      },
      {
        id: 'inbox.dismiss',
        title: 'Dismiss notification',
        keys: ['Backspace'],
        when: 'list',
        group: 'Inbox',
        run: () => dismiss(targets()),
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
        id: 'inbox.tab.next',
        title: 'Next inbox tab',
        keys: [']'],
        when: 'list',
        group: 'Inbox',
        run: () => setTab((current) => stepTab(current, 1)),
      },
      {
        id: 'inbox.tab.previous',
        title: 'Previous inbox tab',
        keys: ['['],
        when: 'list',
        group: 'Inbox',
        run: () => setTab((current) => stepTab(current, -1)),
      },
      {
        id: 'inbox.select.toggle',
        title: 'Select notification',
        keys: ['x'],
        when: 'list',
        group: 'Selection',
        run: () => {
          if (current !== undefined) selection.toggle(current.id);
        },
      },
      {
        id: 'inbox.select.extendDown',
        title: 'Extend selection down',
        keys: ['shift+ArrowDown'],
        when: 'list',
        group: 'Selection',
        run: () => {
          const next = rows[Math.min(active + 1, rows.length - 1)];
          if (next === undefined) return;
          selection.extendTo(next.id, current?.id ?? null);
          place((c) => Math.min(c + 1, Math.max(rows.length - 1, 0)));
        },
      },
      {
        id: 'inbox.select.extendUp',
        title: 'Extend selection up',
        keys: ['shift+ArrowUp'],
        when: 'list',
        group: 'Selection',
        run: () => {
          const next = rows[Math.max(active - 1, 0)];
          if (next === undefined) return;
          selection.extendTo(next.id, current?.id ?? null);
          place((c) => Math.max(c - 1, 0));
        },
      },
      {
        id: 'inbox.select.all',
        title: 'Select every notification',
        keys: ['mod+a'],
        when: 'list',
        group: 'Selection',
        run: () => selection.selectAll(),
      },
      {
        id: 'inbox.select.clear',
        title: 'Clear selection',
        keys: ['Escape'],
        when: 'list',
        group: 'Selection',
        hidden: true,
        // Guarded, so Escape with nothing selected falls through to the find box's own
        // Escape below and, when that is empty too, to the shell's dismiss.
        enabled: () => selection.size > 0,
        run: () => selection.clear(),
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
    [
      rows,
      active,
      current,
      engine,
      open,
      openOn,
      place,
      query,
      selection,
      markRead,
      dismiss,
      targets,
    ],
  );

  /**
   * Which kind of empty this is, and the way out of it.
   *
   * Five of them, and they were one. A find that matched nothing, a kind filter that matched
   * nothing, a tab that is empty while another tab is not, and an inbox that has genuinely
   * never had anything in it are different situations with different answers — and the
   * sentence that fits the last, an explanation of what subscribes you to an issue, is
   * faintly insulting to somebody who has just finished clearing the first four.
   *
   * Each carries the control that undoes the state it describes, which is the same control
   * that caused it: Escape and the find box, the filter menu, the tab row. Nothing here is a
   * new command.
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
    if (kinds.size > 0) {
      return {
        title: 'No matches',
        description: 'Nothing in this tab arrived for the reasons the filter is set to.',
        action: (
          <Button size="sm" onClick={() => setKinds(new Set())}>
            Clear filter
          </Button>
        ),
      };
    }
    const elsewhere = INBOX_TABS.find((other) => other !== tab && counts[other] > 0);
    if (elsewhere !== undefined) {
      return {
        title: `Nothing in ${INBOX_TAB_NAMES[tab].toLowerCase()}`,
        description: `${counts[elsewhere]} ${counts[elsewhere] === 1 ? 'notification is' : 'notifications are'} in ${INBOX_TAB_NAMES[elsewhere]}.`,
        action: (
          <Button size="sm" onClick={() => setTab(elsewhere)}>
            {`Show ${INBOX_TAB_NAMES[elsewhere]}`}
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

  const tabItems: readonly TabItem[] = INBOX_TABS.map((id) => ({
    id,
    label: INBOX_TAB_NAMES[id],
    // A count and not a badge: it is the one fact the tab's name does not carry, and it is
    // read across the row to decide which tab to be in.
    detail: counts[id] === 0 ? undefined : counts[id],
  }));

  /** One row, drawn the same whichever day group it fell into. */
  const renderRow = (row: Row) => (
    <li key={row.id} role="none">
      <button
        type="button"
        id={`notification-${row.id}`}
        role="option"
        // The selection, which is what `aria-selected` means in a listbox. The cursor is
        // `aria-activedescendant` on the list, which is what that means.
        aria-selected={selection.ids.has(row.id)}
        className={[
          styles.row,
          row.unread ? styles.unread : null,
          row.id === current?.id ? styles.active : null,
          selection.ids.has(row.id) ? styles.picked : null,
        ]
          .filter(Boolean)
          .join(' ')}
        // The two selection gestures a pointer has, and then the ordinary one. Modifier
        // first: a cmd-click that navigated would take the row off the screen it was being
        // added to a selection on.
        onClick={(event) => {
          const at = rows.indexOf(row);
          if (event.metaKey || event.ctrlKey) {
            place(() => at);
            selection.toggle(row.id);
            return;
          }
          if (event.shiftKey) {
            place(() => at);
            selection.extendTo(row.id, current?.id ?? null);
            return;
          }
          setCursor(at);
          open(row);
        }}
        // The contextual menu the spec asks for, on the row the pointer is over
        // rather than on the cursor's row: right-clicking a notification is a
        // statement about that one, so the cursor moves to it first and the menu
        // then acts on the cursor like every other command here.
        onContextMenu={(event) => {
          event.preventDefault();
          place(() => rows.indexOf(row));
          openOn(row, setContextFor);
        }}
      >
        {/* The dot is a picture, so it says nothing to a screen reader, and
            weight says nothing either: read and unread were the same row
            announced the same way. One hidden word is the whole fix, and it
            leads the option so it is heard before the sentence it qualifies. */}
        {row.unread ? <span className={styles.unreadName}>Unread</span> : null}
        <span className={styles.avatar} aria-hidden="true">
          <Avatar
            name={row.avatarName}
            src={row.avatarUrl}
            size="md"
            decorative
            className={styles.avatarImage}
          />
          <span className={styles.badge}>{notificationGlyph(row.type)}</span>
        </span>
        <span className={styles.text}>
          <span className={styles.headline}>
            <span className={styles.dot} aria-hidden="true" />
            {row.issueIdentifier === undefined ? (
              <>
                <span className={styles.actor}>{row.actor}</span>{' '}
                <span className={styles.event}>{row.event}</span>
              </>
            ) : (
              <>
                <span className={styles.identifier}>{row.issueIdentifier}</span>
                <span className={styles.issueTitle}>{row.issueTitle}</span>
              </>
            )}
          </span>
          {row.issueIdentifier === undefined ? null : (
            <span className={styles.action}>
              <span className={styles.actor}>{row.actor}</span>{' '}
              <span className={styles.event}>{row.event}</span>
              {row.tail === null ? null : <span className={styles.tail}>{row.tail}</span>}
              {row.snoozedUntil === undefined ? null : (
                <span className={styles.snoozed}>Snoozed</span>
              )}
            </span>
          )}
        </span>
        <span className={styles.meta}>
          <time className={styles.when} dateTime={row.createdAt} title={exact(row.createdAt)}>
            {age(row.createdAt)}
          </time>
          {row.state === null ? null : (
            <StateIcon
              category={row.state.category}
              color={row.state.color}
              decorative
              className={styles.state}
            />
          )}
        </span>
      </button>
    </li>
  );

  return (
    <div className={styles.screen}>
      <div className={styles.listPane}>
        <header className={styles.header}>
          <h1 className={styles.title}>Inbox</h1>
          {/* A live region, because the count is the answer to "did that work?" after
              marking a row read — and the row itself is one line in a list nobody is
              watching. */}
          <span className={styles.count} role="status" aria-live="polite">
            {unread === 0 ? 'All read' : `${unread} unread`}
          </span>
          <IconButton
            ref={moreRef}
            aria-label="More"
            size="md"
            variant="ghost"
            onClick={() => setMoreOpen(true)}
            icon={
              <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <circle cx="3.5" cy="8" r="1.25" />
                <circle cx="8" cy="8" r="1.25" />
                <circle cx="12.5" cy="8" r="1.25" />
              </svg>
            }
          />
          <div className={styles.spacer} />
          <IconButton
            aria-label="Mark all read"
            keys="alt+u"
            size="md"
            variant="ghost"
            disabled={unread === 0}
            onClick={() => markAllNotificationsRead(engine).catch(report)}
            icon={
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m2 8.5 3 3 5.5-6M8 11.5l6-6.5" />
              </svg>
            }
          />
        </header>

        {/* Tabs rather than the two checkboxes that used to live in this space. A checkbox in
            a popover is a filter nobody can see is on, and "why is my inbox empty" was the
            question it caused; a tab row says which of the four lists you are looking at
            without being opened, and carries the count of the three you are not. */}
        <Tabs
          className={styles.tabs}
          aria-label="Inbox tabs"
          items={tabItems}
          value={tab}
          onSelect={(id) => setTab(id as InboxTab)}
        />

        <div className={styles.toolbar}>
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
          {/* The filter's state is on its own label rather than only inside the menu, for
              the same reason the tabs exist: a narrowing nobody can see is a bug report. */}
          <Button
            ref={filterRef}
            size="sm"
            variant={kinds.size > 0 ? 'secondary' : 'ghost'}
            onClick={() => setFilterOpen(true)}
          >
            {kinds.size === 0
              ? 'Filter'
              : kinds.size === 1
                ? (INBOX_KIND_NAMES[[...kinds][0] as InboxKind] ?? 'Filter')
                : `${kinds.size} kinds`}
          </Button>
        </div>

        {rows.length === 0 ? (
          <div className={styles.empty}>
            <EmptyState
              title={emptyState.title}
              description={emptyState.description}
              action={emptyState.action}
            />
          </div>
        ) : (
          <div
            ref={listRef}
            className={styles.list}
            // A listbox rather than a plain list: the cursor is managed here rather than by
            // the browser's focus, so the active row has to be announced as such.
            role="listbox"
            aria-label="Notifications"
            aria-multiselectable={true}
            // Focusable so a menu opened from a row has somewhere to hand the keyboard back
            // to when that row has been snoozed out from under it. Not in the tab order: the
            // rows are buttons and are already reachable.
            tabIndex={-1}
            aria-activedescendant={current === undefined ? undefined : `notification-${current.id}`}
          >
            {/* Day groups. A hundred notifications in one undifferentiated run is a list you
                scroll rather than read; the day is the only division an inbox has that the
                reader already holds in their head. */}
            {groups.map((group) => (
              <ListGroup
                key={group.key}
                groupKey={group.key}
                preferenceKey="inbox"
                name={group.name}
                count={group.rows.length}
              >
                <ul role="presentation" className={styles.groupList}>
                  {group.rows.map(renderRow)}
                </ul>
              </ListGroup>
            ))}
          </div>
        )}

        {/* The bulk bar, drawn only while there is a selection — the pointer's route to the
            three commands the keyboard already has on `U`, `H` and Backspace. A group and not
            a toolbar: a toolbar promises arrow-key roving, which would mean a local key
            handler, and the keyboard here belongs to the registry. */}
        {selection.size === 0 ? null : (
          <div className={styles.selectionBar} role="group" aria-label="Notification actions">
            <span className={styles.selectionCount} aria-live="polite">
              {`${selection.size} selected`}
            </span>
            <Button size="sm" variant="ghost" onClick={() => markRead(selection.ordered)}>
              Mark read
            </Button>
            <Button
              ref={bulkSnoozeRef}
              size="sm"
              variant="ghost"
              onClick={() => setBulkSnoozeOpen(true)}
            >
              Snooze
            </Button>
            <Button size="sm" variant="ghost" onClick={() => dismiss(selection.ordered)}>
              Dismiss
            </Button>
          </div>
        )}
      </div>

      <div className={styles.detailPane}>
        <InboxDetail
          issueId={placed && current?.issue !== undefined ? (current.issue?.id ?? null) : null}
          unread={unread}
        />
      </div>

      <Menu
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        trigger={moreRef}
        label="Inbox"
        items={[
          {
            id: 'dismissRead',
            label: 'Dismiss all read',
            keys: 'shift+Backspace',
            onSelect: () => {
              dismissReadNotifications(engine).catch(report);
            },
          },
        ]}
      />
      {/* Why a row arrived, not what kind of object it is about. `features/inbox/kinds`
          folds the twenty notification types into the six reasons somebody would ask for,
          and the glyphs are the rows' own. */}
      <Menu
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        trigger={filterRef}
        label="Filter by kind"
        items={[
          ...INBOX_KINDS.map((kind) => ({
            id: kind,
            label: INBOX_KIND_NAMES[kind],
            icon: notificationGlyph(INBOX_KIND_GLYPH_TYPES[kind]),
            selected: kinds.has(kind),
            onSelect: () =>
              setKinds((current) => {
                const next = new Set(current);
                if (!next.delete(kind)) next.add(kind);
                return next;
              }),
          })),
          ...(kinds.size === 0
            ? []
            : ([
                { kind: 'separator' },
                { id: 'clear', label: 'Clear filter', onSelect: () => setKinds(new Set()) },
              ] as MenuNode[])),
        ]}
      />
      <Menu
        open={bulkSnoozeOpen}
        onClose={() => {
          setBulkSnoozeOpen(false);
          returnToList();
        }}
        trigger={bulkSnoozeRef}
        label="Snooze until"
        items={snoozeOptions((until) => {
          snooze(selection.ordered, until);
          setBulkSnoozeOpen(false);
        })}
      />
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
          if (contextHandoff.consume()) return;
          setContextFor(null);
          returnToList();
        }}
        trigger={anchor}
        label="Notification"
        keysPresentation="kbd"
        density="compact"
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
            if (contextFor !== null) dismiss([contextFor.id]);
          },
          pick: (kind) => {
            contextHandoff.begin();
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
      <ProjectPicker
        open={picker === 'project' && contextFor?.issue != null}
        onClose={closePicker}
        trigger={anchor}
        teamIds={contextFor?.issue === null ? [] : [contextFor?.issue?.teamId ?? '']}
        value={contextFor?.issue?.projectId}
        onSelect={(projectId) => updateIssue({ projectId })}
      />
      {/* The only one of the five that is not a single `updateIssues`: a label is its own
          row, so the menu stays open and each choice is a write of its own. It therefore
          cannot go through `updateIssue` above, which closes the menu as it writes. */}
      <LabelPicker
        open={picker === 'labels' && contextFor?.issue != null}
        onClose={closePicker}
        trigger={anchor}
        teamId={contextFor?.issue?.teamId ?? null}
        value={contextLabelIds}
        onApply={(labelId, displaced) => {
          const issueId = contextFor?.issue?.id;
          if (issueId !== undefined) applyLabel(engine, issueId, labelId, displaced).catch(report);
        }}
        onRemove={(labelId) => {
          const issueId = contextFor?.issue?.id;
          if (issueId !== undefined) removeLabel(engine, issueId, labelId).catch(report);
        }}
      />
    </div>
  );
}

/**
 * How many rows an undo toast is about, in words.
 *
 * One row is named by its count too — "Dismissed 1 notification" rather than an identifier —
 * because unlike an issue a notification has no name a person would recognise out of context.
 */
function notificationCount(n: number): string {
  return n === 1 ? '1 notification' : `${n} notifications`;
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
 *
 * Property wording comes from `issueRowMenuItems` so the inbox does not fork "Change status"
 * against every other surface's "Status…".
 */
function contextItems(
  row: Row | null,
  commands: {
    open: () => void;
    toggleRead: () => void;
    snooze: () => void;
    dismiss: () => void;
    pick: (kind: IssuePropertyKind) => void;
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
    ...issueRowMenuItems(
      {
        count: 1,
        editable: true,
        canSetStatus: true,
        identifier: row.issueIdentifier ?? undefined,
        // Inbox mounts the five property pickers; omit the rest.
        estimates: false,
        cycles: false,
      },
      { pick: commands.pick },
      {
        status: 's',
        assignee: 'a',
        priority: 'p',
        project: 'shift+p',
        labels: 'l',
      },
    ),
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
