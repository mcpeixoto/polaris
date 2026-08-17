/**
 * The issue list — the screen the product is judged on.
 *
 * Three constraints shape everything here, and they pull against each other:
 *
 * **It has to stay fluid over five thousand issues.** So the parent never touches an issue.
 * It asks the store for ids, grouped and sorted, and flattens them into rows; each row
 * subscribes to its own issue and renders itself. A parent that mapped over entities would
 * rebuild five thousand objects every time somebody in another timezone changed a title, and
 * the frame budget would be gone before React started diffing. Only the thirty-odd rows on
 * screen exist as components at all — the virtualiser owns the rest as arithmetic.
 *
 * **It has to be operable entirely from the keyboard.** Every command is a registered action
 * in the `list` context, so `J`, `K`, `X`, `S`, `A`, `P` and `E` appear in the help overlay
 * and the command menu without anybody maintaining a second list. No component here owns a
 * shortcut; see web/src/keys for why that is architecture rather than tidiness.
 *
 * **Selection has to survive the list changing underneath it.** Deltas arrive while the user
 * is holding shift: rows appear, move between groups and vanish. The selection is held by id
 * and reconciled against the current order on every render — see hooks/useSelection, where
 * that is the whole subject.
 *
 * On accessibility: the scroller is a multi-selectable listbox and each row is an option
 * naming its own status, so a screen-reader user hears "ENG-14, Fix the flake, In Progress,
 * Ada Lovelace" without needing to have landed on a group header. The status headers are
 * therefore hidden from assistive technology rather than announced twice — they are a visual
 * grouping over rows that already say where they are, and a listbox flattened for
 * virtualisation cannot express real `role="group"` nesting without giving up the flat
 * absolute positioning that makes it fast.
 */

import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useVirtualizer } from '@tanstack/react-virtual';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext, useKeymap } from '~/app/keymap';
import { Avatar, Badge, Button, EmptyState, PriorityIcon, StateIcon, Tooltip } from '~/components';
import { archiveIssues, report, updateIssues } from '~/features/issue/mutations';
import { AssigneePicker, PriorityPicker, StatusPicker } from '~/features/issue/pickers';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useSelection } from '~/hooks/useSelection';
import type { StateCategory, Store, UUID } from '~/store';
import styles from './IssueList.module.css';

/** A status heading. Carries its own summary so the row needs nothing from the store. */
interface HeaderRow {
  readonly kind: 'header';
  readonly key: string;
  readonly name: string;
  readonly category: StateCategory;
  readonly color: string | undefined;
  readonly count: number;
}

/** One issue, by id and nothing else. Everything drawn in it is read by the row itself. */
interface IssueRowRef {
  readonly kind: 'issue';
  readonly key: string;
  readonly id: UUID;
}

type ListRow = HeaderRow | IssueRowRef;

/**
 * What the list is of.
 *
 * The screen is parameterised rather than copied because "My Issues" is the same list with
 * a different source: the same virtualiser, the same selection model, the same eleven
 * registered actions, the same bulk pickers. A second copy of all of that would be the
 * place where a shortcut gets fixed in one list and not the other, and nobody would notice
 * for a month.
 */
export type IssueListSource =
  | { readonly kind: 'team' }
  | {
      readonly kind: 'assignee';
      readonly userId: UUID;
      /** Completed work is off by default: "my issues" means the ones still asking for something. */
      readonly includeCompleted?: boolean | undefined;
    };

export interface IssueListProps {
  /** Defaults to the team named in the route. */
  readonly source?: IssueListSource | undefined;
  /** The heading, for a source that is not a team and so has no name of its own. */
  readonly heading?: string | undefined;
}

interface ListView {
  /**
   * The heading, or null when the source does not exist.
   *
   * Null is specifically "there is nothing to show this for" — a team key that matches no
   * team — and not "this view is empty". An empty team still has a name and still renders
   * its statuses, which is the difference between a list with nothing in it and a broken
   * link.
   */
  readonly heading: string | null;
  /** Set only for a team's list, which is the only one with team settings to link to. */
  readonly team: { readonly id: UUID; readonly key: string; readonly name: string } | null;
  readonly rows: readonly ListRow[];
}

/** The default, and a module constant so an inline object does not defeat the query cache. */
const TEAM_SOURCE: IssueListSource = { kind: 'team' };

const NO_VIEW: ListView = { heading: null, team: null, rows: [] };

/**
 * The virtualiser's opening guess at a row's height, in pixels.
 *
 * A number rather than `var(--row-height)` because a scroll offset is arithmetic, not
 * styling — and it is only a guess: every rendered row is measured, so being wrong costs one
 * frame of slightly mis-sized scrollbar and nothing else.
 */
const ESTIMATED_ROW_PX = 32;
const ESTIMATED_HEADER_PX = 36;

/** Rows kept mounted beyond the viewport, so a held-down `J` never outruns the renderer. */
const OVERSCAN = 12;

/** What the registered actions call. Named so the ref's type is a contract, not an inference. */
interface ListCommands {
  move(delta: number): void;
  extend(delta: number): void;
  toggle(): void;
  selectAll(): void;
  clearSelection(): void;
  hasSelection(): boolean;
  open(): void;
  archive(): void;
  pickStatus(): void;
  pickAssignee(): void;
  pickPriority(): void;
}

export function IssueList({ source = TEAM_SOURCE, heading }: IssueListProps = {}) {
  const { teamKey = '' } = useParams<{ teamKey: string }>();
  const navigate = useNavigate();
  const engine = useEngine();
  const { registry, context } = useKeymap();

  // The source is part of the query's identity, so a change of assignee re-runs the
  // selector. Serialised rather than passed by reference because a caller writing the
  // object inline creates a new one every render, and the query would never be reused.
  const sourceKey = source.kind === 'team' ? `team:${teamKey}` : `assignee:${source.userId}`;

  const view = useLiveQuery(
    (store) => buildView(store, source, teamKey, heading),
    ['issue', 'team', 'workflowState'],
    [sourceKey, heading, source.kind === 'assignee' ? source.includeCompleted : false],
  );

  const rows = view.rows;

  // Derived outside the selector on purpose: the store compares a subscription's result
  // structurally, and a Map has no enumerable own properties — two different maps would
  // compare equal and the list would stop updating.
  const ids = useMemo(
    () => rows.filter((row): row is IssueRowRef => row.kind === 'issue').map((row) => row.id),
    [rows],
  );
  const rowIndexOf = useMemo(() => {
    const index = new Map<UUID, number>();
    rows.forEach((row, at) => {
      if (row.kind === 'issue') index.set(row.id, at);
    });
    return index;
  }, [rows]);

  const selection = useSelection(ids);
  const [cursor, setCursor] = useState<UUID | null>(null);

  /**
   * Where the keyboard is, resolved against the list as it stands.
   *
   * Held as an id and re-resolved rather than stored as a position, for the same reason the
   * selection's anchor is: the issue the user is looking at should stay under the cursor when
   * a delta reorders the rows around it, and fall back to the top only when it has actually
   * gone.
   */
  const { cursorId, cursorIndex } = useMemo(() => {
    if (cursor !== null) {
      const at = ids.indexOf(cursor);
      if (at !== -1) return { cursorId: cursor, cursorIndex: at };
    }
    const first = ids[0] ?? null;
    return { cursorId: first, cursorIndex: first === null ? -1 : 0 };
  }, [cursor, ids]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      rows[index]?.kind === 'header' ? ESTIMATED_HEADER_PX : ESTIMATED_ROW_PX,
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: OVERSCAN,
  });

  const status = useMenuTrigger();
  const assignee = useMenuTrigger();
  const priority = useMenuTrigger();

  /**
   * What a command acts on: the selection when there is one, the cursor row otherwise.
   *
   * The fallback is what makes the shortcuts usable without ever pressing `X`. Someone
   * arrowing down a list and pressing `S` means "this one", and requiring them to select it
   * first would make the fast path two keystrokes longer than the slow one.
   */
  const targets = useMemo(
    () => (selection.size > 0 ? selection.ordered : cursorId === null ? [] : [cursorId]),
    [selection.size, selection.ordered, cursorId],
  );

  const scrollToRow = useCallback(
    (id: UUID) => {
      const at = rowIndexOf.get(id);
      if (at !== undefined) virtualizer.scrollToIndex(at, { align: 'auto' });
    },
    [rowIndexOf, virtualizer],
  );

  /**
   * Every command, rebuilt each render and reached through a ref.
   *
   * The registry captures an action's `run` once, at registration. Re-registering the whole
   * keymap on every cursor move would tear down and rebuild a dozen bindings sixty times a
   * second; reading through a ref keeps the registration stable and the behaviour current.
   */
  const commands = useRef<ListCommands>({
    move: () => {},
    extend: () => {},
    toggle: () => {},
    selectAll: () => {},
    clearSelection: () => {},
    hasSelection: () => false,
    open: () => {},
    archive: () => {},
    pickStatus: () => {},
    pickAssignee: () => {},
    pickPriority: () => {},
  });

  const step = (delta: number): UUID | null => {
    if (ids.length === 0) return null;
    const at = Math.min(Math.max(cursorIndex + delta, 0), ids.length - 1);
    return ids[at] ?? null;
  };

  commands.current = {
    move: (delta) => {
      const next = step(delta);
      if (next === null) return;
      setCursor(next);
      scrollToRow(next);
    },
    extend: (delta) => {
      const next = step(delta);
      if (next === null) return;
      // The cursor is the fallback anchor, so the first shift-arrow of a gesture takes the
      // row the user is on as well as the one they are moving to.
      selection.extendTo(next, cursorId);
      setCursor(next);
      scrollToRow(next);
    },
    toggle: () => {
      if (cursorId !== null) selection.toggle(cursorId);
    },
    selectAll: () => selection.selectAll(),
    clearSelection: () => selection.clear(),
    hasSelection: () => selection.size > 0,
    open: () => {
      if (cursorId === null) return;
      const issue = engine.store.get('issue', cursorId);
      if (issue !== undefined) void navigate(`/issue/${engine.store.identifierOf(issue)}`);
    },
    archive: () => {
      if (targets.length === 0) return;
      archiveIssues(engine, targets).catch(report);
    },
    // Guarded here rather than only on the button, because the button and the `S` shortcut
    // are two doors into the same room: disabling one and not the other is how a keyboard
    // user reaches a state the interface says is unavailable.
    pickStatus: () => {
      if (sameTeam(engine.store, targets)) status.show();
    },
    pickAssignee: assignee.show,
    pickPriority: priority.show,
  };

  useKeyContext('list');

  useActions(
    [
      {
        id: 'issueList.moveDown',
        title: 'Move down',
        keys: ['j', 'ArrowDown'],
        when: 'list',
        group: 'Navigation',
        // Hidden from the command menu: "Move down" is not something anybody searches for,
        // and it still appears in the help overlay, which is where it belongs.
        hidden: true,
        run: () => commands.current.move(1),
      },
      {
        id: 'issueList.moveUp',
        title: 'Move up',
        keys: ['k', 'ArrowUp'],
        when: 'list',
        group: 'Navigation',
        hidden: true,
        run: () => commands.current.move(-1),
      },
      {
        id: 'issueList.extendDown',
        title: 'Extend selection down',
        keys: ['shift+ArrowDown'],
        when: 'list',
        group: 'Selection',
        run: () => commands.current.extend(1),
      },
      {
        id: 'issueList.extendUp',
        title: 'Extend selection up',
        keys: ['shift+ArrowUp'],
        when: 'list',
        group: 'Selection',
        run: () => commands.current.extend(-1),
      },
      {
        id: 'issueList.toggleSelected',
        title: 'Select issue',
        keys: ['x'],
        when: 'list',
        group: 'Selection',
        run: () => commands.current.toggle(),
      },
      {
        id: 'issueList.selectAll',
        title: 'Select all issues',
        keys: ['mod+a'],
        when: 'list',
        group: 'Selection',
        run: () => commands.current.selectAll(),
      },
      {
        id: 'issueList.clearSelection',
        title: 'Clear selection',
        keys: ['Escape'],
        when: 'list',
        group: 'Selection',
        hidden: true,
        // Disabled is treated as unbound, so with nothing selected Escape falls through to
        // the shell's dismiss instead of being swallowed by a command with nothing to do.
        enabled: () => commands.current.hasSelection(),
        run: () => commands.current.clearSelection(),
      },
      {
        id: 'issueList.open',
        title: 'Open issue',
        keys: ['Enter'],
        when: 'list',
        group: 'Issues',
        run: () => commands.current.open(),
      },
      {
        id: 'issueList.status',
        title: 'Change status',
        keys: ['s'],
        when: 'list',
        group: 'Issues',
        run: () => commands.current.pickStatus(),
      },
      {
        id: 'issueList.assign',
        title: 'Assign to…',
        keys: ['a'],
        when: 'list',
        group: 'Issues',
        run: () => commands.current.pickAssignee(),
      },
      {
        id: 'issueList.priority',
        title: 'Set priority',
        keys: ['p'],
        when: 'list',
        group: 'Issues',
        run: () => commands.current.pickPriority(),
      },
      {
        id: 'issueList.archive',
        title: 'Archive issue',
        keys: ['e'],
        when: 'list',
        group: 'Issues',
        run: () => commands.current.archive(),
      },
    ],
    [],
  );

  const onOpenRow = useCallback(
    (identifier: string) => navigate(`/issue/${identifier}`),
    [navigate],
  );
  const onFocusRow = useCallback((id: UUID) => setCursor(id), []);
  const onToggleRow = useCallback((id: UUID) => selection.toggle(id), [selection]);
  const onExtendRow = useCallback(
    (id: UUID) => selection.extendTo(id, cursorId),
    [selection, cursorId],
  );

  if (view.heading === null) {
    return (
      <div className={styles.screen}>
        <EmptyState
          title="No such team"
          description={`Nothing in this workspace has the key ${teamKey}.`}
        />
      </div>
    );
  }

  const team = view.team;
  const picking = status.open || assignee.open || priority.open;
  const shared = picking ? sharedProperties(engine.store, targets) : NOTHING_SHARED;
  const canAct = targets.length > 0;
  // Statuses belong to a team, so a selection spanning two of them has no correct set to
  // offer. Disabled with a reason rather than showing one team's statuses for another
  // team's issues, which would silently move an issue to a status its team does not have.
  //
  // Read from the store rather than from `shared`, which is only computed while a picker is
  // open — the first version of this line used it and the button was therefore disabled
  // whenever no menu was showing, which is exactly when somebody would want to press it.
  const canSetStatus = canAct && sameTeam(engine.store, targets);
  const virtualRows = virtualizer.getVirtualItems();

  // `aria-activedescendant` has to name an element that is actually in the document, and a
  // virtualised list is mostly arithmetic. The cursor is scrolled into view whenever it
  // moves, so this is true in every case but a scroll that has left it behind — where a
  // dangling reference would be reported as an error by some screen readers.
  const cursorRendered = virtualRows.some((item) => {
    const row = rows[item.index];
    return row !== undefined && row.kind === 'issue' && row.id === cursorId;
  });

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>{view.heading}</h1>
        <Badge>{ids.length === 1 ? '1 issue' : `${ids.length} issues`}</Badge>
        <div className={styles.spacer} />
        {/* Only a team has settings to link to. A person's list spans every team they can
            reach, so there is no single one this could point at — and guessing would send
            them to a team they happened to have an issue in. */}
        {team === null ? null : (
          // A link and not a button: it goes somewhere, so it should be announced as a link,
          // open in a new tab on a middle click, and be copyable from a context menu.
          <Link className={styles.link} to={`/team/${team.key}/settings`}>
            Team settings
          </Link>
        )}
      </header>

      {/* A group and not `role="toolbar"`. A toolbar promises arrow-key navigation between
          its controls, which would mean a roving tabindex and a local key handler — and the
          keyboard in this product belongs to the registry. Every button here is in the tab
          order and has a shortcut; claiming a pattern we do not implement would only mislead
          the people who rely on it. */}
      <div className={styles.toolbar} role="group" aria-label="Issue actions">
        {/* Announced rather than merely drawn: a bulk action's whole risk is acting on more
            rows than you meant to, and the count is the only thing that says how many. */}
        <span className={styles.selectionCount} aria-live="polite">
          {selection.size > 0
            ? `${selection.size} selected`
            : cursorId === null
              ? 'Nothing to act on'
              : 'Acting on the row under the cursor'}
        </span>
        <Tooltip
          label={
            canAct && !canSetStatus
              ? 'Those issues are in different teams, and statuses belong to a team'
              : 'Change status'
          }
          keys="s"
        >
          <Button {...status.props} disabled={!canSetStatus}>
            Status
          </Button>
        </Tooltip>
        <Tooltip label="Assign to…" keys="a">
          <Button {...assignee.props} disabled={!canAct}>
            Assignee
          </Button>
        </Tooltip>
        <Tooltip label="Set priority" keys="p">
          <Button {...priority.props} disabled={!canAct}>
            Priority
          </Button>
        </Tooltip>
        <Tooltip label="Archive" keys="e">
          <Button
            variant="ghost"
            disabled={!canAct}
            onClick={() => commands.current.archive()}
            icon={<ArchiveGlyph />}
          >
            Archive
          </Button>
        </Tooltip>
      </div>

      <StatusPicker
        open={status.open}
        onClose={status.hide}
        trigger={status.ref}
        teamId={shared.teamId ?? ''}
        value={shared.stateId}
        onSelect={(stateId) => updateIssues(engine, targets, { stateId }).catch(report)}
      />
      <AssigneePicker
        open={assignee.open}
        onClose={assignee.hide}
        trigger={assignee.ref}
        value={shared.assigneeId}
        onSelect={(assigneeId) => updateIssues(engine, targets, { assigneeId }).catch(report)}
      />
      <PriorityPicker
        open={priority.open}
        onClose={priority.hide}
        trigger={priority.ref}
        value={shared.priority}
        onSelect={(level) => updateIssues(engine, targets, { priority: level }).catch(report)}
      />

      {rows.length === 0 ? (
        <EmptyState
          className={styles.empty}
          title="No issues in this team yet"
          description="Everything the team is working on will live here."
          action={
            <Button
              variant="primary"
              onClick={() => registry.invoke('issue.create', { source: 'menu', context })}
            >
              Create an issue
            </Button>
          }
        />
      ) : (
        <div
          ref={scrollRef}
          className={styles.scroller}
          role="listbox"
          aria-multiselectable="true"
          aria-label={`${view.heading} issues`}
          aria-activedescendant={
            cursorId !== null && cursorRendered ? rowDomId(cursorId) : undefined
          }
          tabIndex={0}
        >
          <div className={styles.sizer} style={{ height: virtualizer.getTotalSize() }}>
            {virtualRows.map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (row === undefined) return null;
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  className={styles.slot}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  {row.kind === 'header' ? (
                    <GroupHeader row={row} />
                  ) : (
                    <IssueRow
                      id={row.id}
                      selected={selection.ids.has(row.id)}
                      active={row.id === cursorId}
                      onOpen={onOpenRow}
                      onFocus={onFocusRow}
                      onToggle={onToggleRow}
                      onExtend={onExtendRow}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A status heading.
 *
 * Hidden from assistive technology: every row underneath names its own status, so announcing
 * the heading as well would read the status twice for the first issue in each group and once
 * for the rest — a pattern that reads as a stutter rather than as structure.
 */
function GroupHeader({ row }: { row: HeaderRow }) {
  return (
    <div className={styles.group} aria-hidden="true">
      <StateIcon category={row.category} color={row.color} decorative />
      <span className={styles.groupName}>{row.name}</span>
      <span className={styles.groupCount}>{row.count}</span>
    </div>
  );
}

interface IssueRowProps {
  id: UUID;
  selected: boolean;
  /** Under the keyboard cursor. One row at a time, and not the same thing as selected. */
  active: boolean;
  onOpen: (identifier: string) => void;
  onFocus: (id: UUID) => void;
  onToggle: (id: UUID) => void;
  onExtend: (id: UUID) => void;
}

/**
 * One issue.
 *
 * It reads its own issue out of the store rather than being handed one, which is what keeps
 * the parent's re-render independent of the corpus: a title edited in another session
 * re-renders this row and nothing else, and the list's own render never allocates five
 * thousand objects to find out. The subscription is compared structurally, so a delta that
 * moves an issue this row does not care about costs a comparison and no render at all.
 */
const IssueRow = memo(function IssueRow({
  id,
  selected,
  active,
  onOpen,
  onFocus,
  onToggle,
  onExtend,
}: IssueRowProps) {
  const issue = useLiveQuery(
    (store) => {
      const found = store.issues.get(id);
      if (found === undefined) return null;
      const state = store.workflowStates.get(found.stateId);
      const assignee =
        found.assigneeId === undefined ? undefined : store.users.get(found.assigneeId);
      return {
        identifier: store.identifierOf(found),
        title: found.title,
        priority: found.priority,
        stateName: state?.name ?? 'No status',
        stateCategory: state?.category ?? ('backlog' as StateCategory),
        stateColor: state?.color,
        assigneeId: assignee?.id ?? null,
        assigneeName: assignee?.displayName ?? null,
        assigneeAvatar: assignee?.avatarUrl ?? null,
      };
    },
    ['issue', 'team', 'user', 'workflowState'],
    [id],
  );

  // A row whose issue has just been archived or revoked. It disappears on the next query,
  // which is a frame away; rendering nothing is better than rendering a skeleton for it.
  if (issue === null) return null;

  return (
    <div
      id={rowDomId(id)}
      role="option"
      aria-selected={selected}
      className={[styles.row, selected ? styles.selected : null, active ? styles.active : null]
        .filter(Boolean)
        .join(' ')}
      onClick={(event) => {
        onFocus(id);
        // The two selection gestures a pointer has. Everything else opens the issue, because
        // opening is what clicking a row means everywhere else in the product.
        if (event.shiftKey) onExtend(id);
        else if (event.metaKey || event.ctrlKey) onToggle(id);
        else onOpen(issue.identifier);
      }}
    >
      <PriorityIcon priority={issue.priority} decorative />
      <span className={styles.identifier}>{issue.identifier}</span>
      <StateIcon category={issue.stateCategory} color={issue.stateColor} label={issue.stateName} />
      <span className={styles.rowTitle}>{issue.title}</span>
      {issue.assigneeName === null ? (
        <span className={styles.unassigned} aria-label="Unassigned" role="img" />
      ) : (
        <Avatar
          name={issue.assigneeName}
          src={issue.assigneeAvatar}
          size="xs"
          colorKey={issue.assigneeId ?? issue.assigneeName}
        />
      )}
    </div>
  );
});

/** Stable per issue, because `aria-activedescendant` has to name an element that exists. */
function rowDomId(id: UUID): string {
  return `issue-row-${id}`;
}

/**
 * Flattens the store's grouped answer into the rows the virtualiser counts.
 *
 * Group headings keep the product's own order — workflow order for statuses — regardless of
 * how the issues inside them are sorted; that decision lives in the store's query and is
 * only rendered here.
 */
function buildView(
  store: Store,
  source: IssueListSource,
  teamKey: string,
  heading: string | undefined,
): ListView {
  // Assignee first, because it is the case with no team: an issue assigned to somebody can
  // be in any team they can reach, which is exactly why the settings link and the team name
  // are absent from this list rather than guessed at.
  if (source.kind === 'assignee') {
    const { groups } = store.query({
      filter: { assigneeIds: [source.userId] },
      groupBy: 'state',
      sortBy: 'sortOrder',
    });
    return {
      heading: heading ?? 'My Issues',
      team: null,
      rows: rowsOf(store, groups, source.includeCompleted !== true),
    };
  }

  const team = [...store.teams.values()].find((candidate) => candidate.key === teamKey);
  if (team === undefined) return NO_VIEW;

  const { groups } = store.query({
    filter: { teamIds: [team.id] },
    groupBy: 'state',
    sortBy: 'sortOrder',
  });

  return {
    heading: team.name,
    team: { id: team.id, key: team.key, name: team.name },
    rows: rowsOf(store, groups, false),
  };
}

/**
 * Flattens grouped ids into the header-and-issue rows the virtualiser walks.
 *
 * Flat rather than nested because a virtualiser measures and positions one list: real
 * `role="group"` nesting would mean either giving up virtualisation or lying to the
 * accessibility tree about a structure that is not in the DOM.
 */
function rowsOf(
  store: Store,
  groups: ReturnType<Store['query']>['groups'],
  hideCompleted: boolean,
): ListRow[] {
  const rows: ListRow[] = [];
  for (const group of groups) {
    const state = typeof group.key === 'string' ? store.get('workflowState', group.key) : undefined;

    // Dropped entirely rather than shown empty, and only for this source. A team's board
    // keeps its empty columns because their absence is information — "nothing is in
    // review". A person's list is not a board, and a "Done" heading over nothing is a row
    // of chrome between them and their actual work.
    if (hideCompleted && (state?.category === 'completed' || state?.category === 'canceled')) {
      continue;
    }

    rows.push({
      kind: 'header',
      key: `header-${String(group.key)}`,
      name: state?.name ?? 'No status',
      category: state?.category ?? 'backlog',
      color: state?.color,
      count: group.ids.length,
    });
    for (const id of group.ids) rows.push({ kind: 'issue', key: id, id });
  }
  return rows;
}

interface SharedProperties {
  readonly stateId: UUID | undefined;
  readonly assigneeId: UUID | null | undefined;
  readonly priority: number | undefined;
  /**
   * The team the selection is in, when it is all in one.
   *
   * Undefined for a selection that spans teams, which cannot happen in a team's list and
   * happens constantly in a person's. It matters because statuses belong to a team: there
   * is no set of statuses that is correct for two teams at once, so the status picker is
   * disabled rather than offering one team's statuses for another team's issues.
   */
  readonly teamId: UUID | undefined;
}

/** Nothing in common — which is also the right answer for an empty target set. */
const NOTHING_SHARED: SharedProperties = {
  teamId: undefined,
  stateId: undefined,
  assigneeId: undefined,
  priority: undefined,
};

/**
 * What the targeted issues agree on, so a picker can tick the current value.
 *
 * `undefined` means they disagree, and it is deliberately not `null`: null is a real answer
 * for an assignee — nobody — and a picker that conflated the two would tick "No assignee"
 * over forty issues that have four different people on them.
 *
 * Computed only while a picker is open. Over a full selection it is one map lookup per
 * issue, which is nothing once, and would be a waste on every keystroke.
 */
function sharedProperties(store: Store, targets: readonly UUID[]): SharedProperties {
  let stateId: UUID | undefined;
  let assigneeId: UUID | null | undefined;
  let priority: number | undefined;
  let teamId: UUID | undefined;
  let first = true;

  for (const id of targets) {
    const issue = store.issues.get(id);
    if (issue === undefined) continue;
    if (first) {
      stateId = issue.stateId;
      assigneeId = issue.assigneeId ?? null;
      priority = issue.priority;
      teamId = issue.teamId;
      first = false;
      continue;
    }
    if (stateId !== issue.stateId) stateId = undefined;
    if (assigneeId !== (issue.assigneeId ?? null)) assigneeId = undefined;
    if (priority !== issue.priority) priority = undefined;
    if (teamId !== issue.teamId) teamId = undefined;
  }
  return { stateId, assigneeId, priority, teamId };
}

function ArchiveGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
      <path
        d="M2 4.5h12M3.5 4.5v8a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-8M6 7h4M4 2.5h8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Whether every issue given is in one team.
 *
 * Read from the store rather than from `sharedProperties`, because the commands object is
 * built before that runs and closing over it would capture a stale answer from the render
 * in which the shortcut was registered.
 */
function sameTeam(store: Store, targets: readonly UUID[]): boolean {
  let teamId: UUID | undefined;
  for (const id of targets) {
    const issue = store.issues.get(id);
    if (issue === undefined) continue;
    if (teamId === undefined) teamId = issue.teamId;
    else if (teamId !== issue.teamId) return false;
  }
  return teamId !== undefined;
}
