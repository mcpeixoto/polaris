/**
 * The board: the same view as the list, turned on its side.
 *
 * It is the issue list's twin rather than a second screen, and every decision here is an
 * echo of one made there — because the two have to behave identically for the parts they
 * share, and the way that fails is by being written twice.
 *
 * **The parent never touches an issue.** `useView` hands over groups holding ids, and the
 * cards read their own issues out of the store. Over five thousand issues a board that
 * mapped ids to entities would rebuild the corpus every time anybody in another timezone
 * edited a title; only the cards actually on screen exist as components at all, because each
 * column is virtualised exactly as the list's rows are.
 *
 * **The keyboard belongs to the registry.** A board adds two gestures to the list's — move
 * across the columns, and move an issue across them — and they are registered actions like
 * everything else, so they appear in the help overlay and are checked for conflicts.
 * Vertical movement, selection and opening are deliberately *not* re-registered: they are
 * the list screen's `J`, `K`, `X` and `Enter` acting on the same flat order of ids, which
 * walks a column and then continues into the next one. Two definitions of "move down" is how
 * one of them ends up fixed and the other does not.
 *
 * **A drop is the status picker by another route.** Dragging a card into a column runs the
 * same `updateIssues` the list's `S` menu runs, with the same optimistic patch, and there is
 * no second write path for the board. What differs is which field it writes, and that
 * follows the grouping: statuses for a status board, the assignee for an assignee board, the
 * priority for a priority board. Under a grouping whose columns are not a settable field —
 * no grouping at all, labels, due dates, parents, teams, status categories — dragging is
 * turned off and the column says why, because the alternative is a card that snaps back and
 * a person who does not know whether the write failed or was never attempted.
 */

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import { useEngine } from '~/app/context';
import { useActions } from '~/app/keymap';
import { Avatar, Badge, EmptyState, PriorityIcon, StateIcon } from '~/components';
import { issueEstimateLabel } from '~/features/estimate';
import { report, updateIssues, type IssueFields } from '~/features/issue/mutations';
import { LabelList } from '~/features/labels/LabelList';
import { isOverdue, whenDay } from '~/features/time';
import type { DisplayGroupBy, DisplayOptions, DisplayProperty } from '~/filter';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewerId } from '~/hooks/useViewer';
import type { StateCategory, Store, UUID } from '~/store';

import type { ViewGroup } from './useView';
import styles from './Board.module.css';

export interface BoardProps {
  /**
   * The columns, in the order `useView` decided — statuses in workflow order, priorities by
   * display rank. Ids and not issues; see the type's own comment for why that bargain is
   * the whole reason a board this size renders at all.
   */
  readonly groups: readonly ViewGroup[];
  readonly display: Required<DisplayOptions>;
  /** The ids the toolbar's bulk actions would act on. Held by the screen, as in the list. */
  readonly selected: ReadonlySet<UUID>;
  /** Where the keyboard is. One card, and not the same thing as selected. */
  readonly cursorId: UUID | null;
  /** The board's accessible name — the view's heading. */
  readonly label: string;
  onOpen(identifier: string): void;
  onFocus(id: UUID): void;
  onToggle(id: UUID): void;
  onExtend(id: UUID): void;
  readonly className?: string | undefined;
}

/**
 * The drag payload's type, and it is deliberately not `text/plain`.
 *
 * A private type is what lets a column tell one of its own cards from a paragraph somebody
 * dragged in from another window — `text/plain` would make every selection in the browser
 * look like a droppable issue. The card writes the identifier as plain text *as well*, so
 * dragging a card into a comment box or another application leaves "ENG-14" rather than a
 * uuid nobody can read.
 */
const DRAG_TYPE = 'application/x-polaris-issue';

/**
 * The virtualiser's opening guess at a card's height, in pixels.
 *
 * A number rather than a token because a scroll offset is arithmetic, not styling — the same
 * trade the list makes for its rows. Every rendered card is measured, so being wrong costs
 * one frame of mis-sized scrollbar and nothing else.
 */
const ESTIMATED_CARD_PX = 76;

/** Cards kept mounted beyond the viewport, so a held-down `J` never outruns the renderer. */
const OVERSCAN = 8;

/** What the registered actions call. Named so the ref's type is a contract, not an inference. */
interface BoardCommands {
  focusColumn(delta: number): void;
  moveColumn(delta: number): void;
  canMove(): boolean;
}

/**
 * What a drop on this column would write, or null when a drop cannot say anything.
 *
 * These are the three groupings whose columns *are* a field on the issue, which is the only
 * honest test of whether a card can be dragged into one. Everything else is either derived
 * (a status category is several statuses), many-valued (an issue carries several labels), or
 * a change with consequences a drag does not convey (a team move renumbers the issue).
 */
function fieldsForColumn(group: ViewGroup, groupBy: DisplayGroupBy): IssueFields | null {
  switch (groupBy) {
    case 'state':
      return group.stateId === undefined ? null : { stateId: group.stateId };
    case 'assignee':
      // Null and not undefined: the "Unassigned" column is a real destination, and in
      // `IssueFields` undefined means "leave it alone" while null means nobody.
      return { assigneeId: group.userId ?? null };
    case 'priority':
      return group.priority === undefined ? null : { priority: group.priority };
    default:
      return null;
  }
}

/**
 * Why cards cannot be dragged under this grouping, or null when they can.
 *
 * A sentence rather than a boolean because it is rendered: "you cannot do this here" without
 * a reason is indistinguishable from a bug, and the reason is different in each case.
 */
export function dragBlockedReason(groupBy: DisplayGroupBy): string | null {
  switch (groupBy) {
    case 'state':
    case 'assignee':
    case 'priority':
      return null;
    case 'none':
      return 'Everything is in one column, so there is nowhere to drop a card.';
    case 'stateCategory':
      return 'A category covers several statuses, so a drop would have to choose one of them on your behalf. Group by status to move cards.';
    case 'label':
      return 'An issue can carry several labels at once, so dropping it on one would not say which of the others to take away.';
    case 'team':
      return 'Moving an issue to another team renumbers it and changes which statuses it can be in, which is more than a drop should decide.';
    case 'dueDate':
      return 'A column here is a calendar day, and a drop would quietly make that day the deadline.';
    case 'parent':
      return "Re-parenting moves an issue into another issue's checklist rather than setting a property on it.";
  }
}

export function Board({
  groups,
  display,
  selected,
  cursorId,
  label,
  onOpen,
  onFocus,
  onToggle,
  onExtend,
  className,
}: BoardProps) {
  const engine = useEngine();
  const viewerId = useViewerId();
  const baseId = useId();
  const noticeId = `${baseId}-notice`;

  /** The card under the pointer's grip, kept so a drop still works without a dataTransfer. */
  const [dragging, setDragging] = useState<UUID | null>(null);
  /** The column the pointer is over, so the target is visible before the button is released. */
  const [over, setOver] = useState<string | null>(null);

  const blocked = dragBlockedReason(display.groupBy);
  const canDrop = blocked === null;

  const properties = useMemo(
    () => new Set<DisplayProperty>(display.properties),
    [display.properties],
  );

  /**
   * How to scroll one card of one column into view, registered by the columns themselves.
   *
   * The keyboard moves the cursor across columns, and the column that receives it owns its
   * own virtualiser — so the alternative to this small registry is lifting nine virtualisers
   * into the parent, which is exactly the coupling that makes a column stop being a column.
   */
  const scrollers = useRef(new Map<string, (index: number) => void>());
  const registerScroller = useCallback(
    (key: string, scrollTo: ((index: number) => void) | null) => {
      if (scrollTo === null) scrollers.current.delete(key);
      else scrollers.current.set(key, scrollTo);
    },
    [],
  );

  /**
   * What a gesture on one card acts on: the whole selection when the card is part of it,
   * that card alone otherwise.
   *
   * The same rule the list's toolbar follows, and for the same reason — dragging one of six
   * selected cards means "move these", and moving one of them while leaving five behind is
   * the surprise that teaches people not to trust multi-select.
   */
  const targetsFor = useCallback(
    (id: UUID): UUID[] => {
      if (!selected.has(id)) return [id];
      const ordered: UUID[] = [];
      for (const group of groups) {
        for (const candidate of group.ids) if (selected.has(candidate)) ordered.push(candidate);
      }
      return ordered;
    },
    [groups, selected],
  );

  const moveTo = useCallback(
    (group: ViewGroup, ids: readonly UUID[]) => {
      const fields = fieldsForColumn(group, display.groupBy);
      // Nothing silent: this is only reachable when the grouping expresses a drop, and the
      // guard is here so that a future grouping added without a case does nothing rather
      // than writing the wrong field.
      if (fields === null || ids.length === 0) return;
      updateIssues(engine, ids, fields, viewerId).catch(report);
    },
    [engine, display.groupBy, viewerId],
  );

  const onDropCard = useCallback(
    (group: ViewGroup, id: UUID) => {
      setOver(null);
      setDragging(null);
      moveTo(group, targetsFor(id));
    },
    [moveTo, targetsFor],
  );

  const onDragStartCard = useCallback((id: UUID) => setDragging(id), []);
  const onDragEndCard = useCallback(() => {
    setDragging(null);
    setOver(null);
  }, []);

  /** Which column the cursor is in and where in it, resolved against the board as it stands. */
  const locate = (id: UUID | null): { column: number; index: number } | null => {
    if (id === null) return null;
    for (let column = 0; column < groups.length; column++) {
      const index = groups[column]?.ids.indexOf(id) ?? -1;
      if (index !== -1) return { column, index };
    }
    return null;
  };

  /**
   * Every command, rebuilt each render and reached through a ref.
   *
   * The registry captures an action's `run` once, at registration; re-registering the keymap
   * whenever the cursor moved would tear four bindings down and rebuild them sixty times a
   * second. See the issue list, which reaches its commands the same way.
   */
  const commands = useRef<BoardCommands>({
    focusColumn: () => {},
    moveColumn: () => {},
    canMove: () => false,
  });

  commands.current = {
    focusColumn: (delta) => {
      const at = locate(cursorId);
      if (at === null) return;
      // Empty columns are skipped rather than landed on. They are kept on the board because
      // "nothing is in review" is information, but a cursor sitting in one has nothing to
      // act on and the next press would have to guess which way the user meant to carry on.
      for (let column = at.column + delta; column >= 0 && column < groups.length; column += delta) {
        const ids = groups[column]?.ids ?? [];
        if (ids.length === 0) continue;
        const index = Math.min(at.index, ids.length - 1);
        const next = ids[index];
        if (next === undefined) return;
        onFocus(next);
        scrollers.current.get(groups[column]?.key ?? '')?.(index);
        return;
      }
    },
    moveColumn: (delta) => {
      const at = locate(cursorId);
      if (at === null || cursorId === null) return;
      const target = groups[at.column + delta];
      if (target === undefined) return;
      moveTo(target, targetsFor(cursorId));
    },
    canMove: () => canDrop && cursorId !== null,
  };

  useActions(
    [
      {
        id: 'board.focusPreviousColumn',
        title: 'Focus the previous column',
        // Arrows only, and `h`/`l` deliberately not among them.
        //
        // The board mounts *inside* the issue list, so its bindings land in the same `list`
        // context as the list's own — and `H` is snooze while `L` is add-label, both of them
        // documented issue actions that work on the card under the cursor here just as they
        // do on a row. Claiming those letters for column navigation is not a preference the
        // registry can express: it rejects an unguarded second binding at registration, so
        // mounting the board threw inside a passive effect and took the whole screen down to
        // a blank page that a reload could not recover, because the layout is in the URL.
        keys: ['ArrowLeft'],
        when: 'list',
        group: 'Board',
        run: () => commands.current.focusColumn(-1),
      },
      {
        id: 'board.focusNextColumn',
        title: 'Focus the next column',
        keys: ['ArrowRight'],
        when: 'list',
        group: 'Board',
        run: () => commands.current.focusColumn(1),
      },
      {
        id: 'board.moveToPreviousColumn',
        title: 'Move issue to the previous column',
        keys: ['shift+ArrowLeft'],
        when: 'list',
        group: 'Board',
        // The keyboard's half of the drop, and gated on the same fact the drag is: a
        // disabled action is treated as unbound, so under a grouping that cannot express
        // the write the keystroke falls through instead of doing nothing in silence.
        enabled: () => commands.current.canMove(),
        run: () => commands.current.moveColumn(-1),
      },
      {
        id: 'board.moveToNextColumn',
        title: 'Move issue to the next column',
        keys: ['shift+ArrowRight'],
        when: 'list',
        group: 'Board',
        enabled: () => commands.current.canMove(),
        run: () => commands.current.moveColumn(1),
      },
    ],
    [],
  );

  if (groups.length === 0) {
    return (
      <EmptyState
        className={[styles.empty, className].filter(Boolean).join(' ')}
        title="Nothing to show"
        description="No issue in this view matches the filter."
      />
    );
  }

  return (
    <div className={[styles.screen, className].filter(Boolean).join(' ')}>
      {blocked === null ? null : (
        // Rendered rather than only implied by cards that will not lift: a drag that does
        // nothing is indistinguishable from a broken one. Each column points at this with
        // `aria-describedby`, so the reason is available to a keyboard user landing on a
        // column as well as to a pointer that has just tried.
        <p className={styles.notice} id={noticeId} role="note">
          Cards cannot be moved between these columns. {blocked}
        </p>
      )}
      <div className={styles.board} role="group" aria-label={label}>
        {groups.map((group) => (
          <BoardColumn
            key={group.key}
            group={group}
            properties={properties}
            selected={selected}
            cursorId={cursorId}
            draggable={canDrop}
            dragging={dragging}
            over={over === group.key}
            describedBy={blocked === null ? undefined : noticeId}
            onOpen={onOpen}
            onFocus={onFocus}
            onToggle={onToggle}
            onExtend={onExtend}
            onDragStartCard={onDragStartCard}
            onDragEndCard={onDragEndCard}
            onDragOverColumn={setOver}
            onDropCard={onDropCard}
            registerScroller={registerScroller}
          />
        ))}
      </div>
    </div>
  );
}

interface BoardColumnProps {
  group: ViewGroup;
  properties: ReadonlySet<DisplayProperty>;
  selected: ReadonlySet<UUID>;
  cursorId: UUID | null;
  /** Whether this grouping's columns are a field a drop can write. */
  draggable: boolean;
  dragging: UUID | null;
  over: boolean;
  /** The notice saying why dragging is off, when it is. */
  describedBy: string | undefined;
  onOpen(identifier: string): void;
  onFocus(id: UUID): void;
  onToggle(id: UUID): void;
  onExtend(id: UUID): void;
  onDragStartCard(id: UUID): void;
  onDragEndCard(): void;
  onDragOverColumn(key: string): void;
  onDropCard(group: ViewGroup, id: UUID): void;
  registerScroller(key: string, scrollTo: ((index: number) => void) | null): void;
}

/**
 * One column: a heading that does not move, and a virtualised stack of cards under it.
 *
 * The heading sits outside the card scroller rather than being `position: sticky` inside it.
 * A sticky header within a virtualised scroller has to be taken out of the measured offsets
 * — TanStack calls that `scrollMargin` — and getting it wrong misplaces every card by the
 * header's height. A flex header the cards scroll under is the same thing on screen with
 * none of the arithmetic, and the scroller stays what the list's is: a viewport containing
 * exactly one absolutely positioned sizer.
 */
function BoardColumn({
  group,
  properties,
  selected,
  cursorId,
  draggable,
  dragging,
  over,
  describedBy,
  onOpen,
  onFocus,
  onToggle,
  onExtend,
  onDragStartCard,
  onDragEndCard,
  onDragOverColumn,
  onDropCard,
  registerScroller,
}: BoardColumnProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: group.ids.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_CARD_PX,
    getItemKey: (index) => group.ids[index] ?? index,
    overscan: OVERSCAN,
  });

  useEffect(() => {
    registerScroller(group.key, (index) => virtualizer.scrollToIndex(index, { align: 'auto' }));
    return () => registerScroller(group.key, null);
  }, [registerScroller, group.key, virtualizer]);

  // A group's label is empty for "no grouping", where the single column holds the whole
  // view. It still needs a name: a listbox announced as "" is one a screen-reader user
  // cannot tell from the page.
  const title = group.label === '' ? 'All issues' : group.label;
  const virtualCards = virtualizer.getVirtualItems();

  // `aria-activedescendant` has to name an element that is in the document, and a
  // virtualised column is mostly arithmetic. The cursor is scrolled into view whenever it
  // moves, so this is true in every case but a scroll that has left it behind — where a
  // dangling reference is reported as an error by some screen readers.
  const cursorRendered = virtualCards.some((item) => group.ids[item.index] === cursorId);

  const onDrop = (event: DragEvent<HTMLElement>) => {
    if (!draggable) return;
    event.preventDefault();
    // The private type first, the state second. The state is what makes the drop work in a
    // browser that protects `dataTransfer` outside a real drag; the payload is what makes it
    // work when the drag started somewhere this component cannot see.
    const carried = event.dataTransfer?.getData(DRAG_TYPE) ?? '';
    const id = carried === '' ? dragging : carried;
    if (id !== null) onDropCard(group, id);
  };

  return (
    <section
      className={[styles.column, over ? styles.over : null].filter(Boolean).join(' ')}
      aria-describedby={describedBy}
      onDragOver={(event) => {
        if (!draggable) return;
        // Without preventDefault the browser refuses the drop, which is the single most
        // common way an HTML5 drag ends in nothing happening at all.
        event.preventDefault();
        if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move';
        // dragover fires continuously while the pointer is held still; setting the state
        // only on arrival keeps that from being a re-render every hundred milliseconds.
        if (!over) onDragOverColumn(group.key);
      }}
      onDrop={onDrop}
    >
      <header className={styles.header}>
        <span className={styles.name}>{title}</span>
        {/* The count is a standing fact about the column rather than a control, which is
            what a Badge is for. It is the number of cards, and under a label grouping that
            is deliberately not the number of issues — see `groupIssues`. */}
        <Badge>{group.ids.length}</Badge>
      </header>

      <div
        ref={scrollRef}
        className={styles.scroller}
        role="listbox"
        aria-multiselectable="true"
        aria-label={title}
        aria-activedescendant={
          cursorId !== null && cursorRendered ? cardDomId(cursorId) : undefined
        }
        tabIndex={0}
      >
        {group.ids.length === 0 ? (
          // Kept on the board rather than dropped: an empty column is information — "nothing
          // is in review" — and a board whose columns come and go as work moves through it
          // is one nobody can build a habit around.
          <p className={styles.blank}>Nothing here</p>
        ) : (
          <div className={styles.sizer} style={{ height: virtualizer.getTotalSize() }}>
            {virtualCards.map((virtualCard) => {
              const id = group.ids[virtualCard.index];
              if (id === undefined) return null;
              return (
                <div
                  key={virtualCard.key}
                  data-index={virtualCard.index}
                  ref={virtualizer.measureElement}
                  className={styles.slot}
                  style={{ transform: `translateY(${virtualCard.start}px)` }}
                >
                  <BoardCard
                    id={id}
                    properties={properties}
                    selected={selected.has(id)}
                    active={id === cursorId}
                    draggable={draggable}
                    dragging={dragging === id}
                    onOpen={onOpen}
                    onFocus={onFocus}
                    onToggle={onToggle}
                    onExtend={onExtend}
                    onDragStart={onDragStartCard}
                    onDragEnd={onDragEndCard}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

interface BoardCardProps {
  id: UUID;
  properties: ReadonlySet<DisplayProperty>;
  selected: boolean;
  /** Under the keyboard cursor. One card at a time, and not the same thing as selected. */
  active: boolean;
  draggable: boolean;
  dragging: boolean;
  onOpen(identifier: string): void;
  onFocus(id: UUID): void;
  onToggle(id: UUID): void;
  onExtend(id: UUID): void;
  onDragStart(id: UUID): void;
  onDragEnd(): void;
}

/** What a card draws, resolved once so the card itself renders from plain data. */
interface CardData {
  readonly identifier: string;
  readonly title: string;
  readonly priority: number;
  readonly stateName: string;
  readonly stateCategory: StateCategory;
  readonly stateColor: string | undefined;
  readonly assigneeId: string | null;
  readonly assigneeName: string | null;
  readonly assigneeAvatar: string | null;
  /** Already in the team's scale — "3", "M" — or null when the team does not estimate. */
  readonly estimate: string | null;
  /** Already in the team's timezone, because a due date is the team's Friday. */
  readonly dueDate: string | null;
  readonly overdue: boolean;
}

/**
 * One issue, as a card.
 *
 * It reads its own issue out of the store rather than being handed one, which is what keeps
 * the board's render independent of the corpus: a title edited in another session re-renders
 * this card and nothing else. The subscription is compared structurally, so a delta touching
 * an issue this card does not care about costs a comparison and no render at all.
 */
const BoardCard = memo(function BoardCard({
  id,
  properties,
  selected,
  active,
  draggable,
  dragging,
  onOpen,
  onFocus,
  onToggle,
  onExtend,
  onDragStart,
  onDragEnd,
}: BoardCardProps) {
  const issue = useLiveQuery(
    (store) => cardOf(store, id),
    ['issue', 'team', 'user', 'workflowState'],
    [id],
  );

  // A card whose issue has just been archived or revoked. It disappears on the next query,
  // which is a frame away; rendering nothing is better than rendering a skeleton for it.
  if (issue === null) return null;

  const meta =
    (properties.has('labels') ? 1 : 0) +
    (properties.has('estimate') && issue.estimate !== null ? 1 : 0) +
    (properties.has('dueDate') && issue.dueDate !== null ? 1 : 0);

  return (
    <div
      id={cardDomId(id)}
      role="option"
      aria-selected={selected}
      className={[
        styles.card,
        selected ? styles.selected : null,
        active ? styles.active : null,
        dragging ? styles.dragging : null,
      ]
        .filter(Boolean)
        .join(' ')}
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(DRAG_TYPE, id);
        // Plain text as well, so a card dragged into a comment box or another application
        // leaves the issue's name rather than a uuid nobody can read.
        event.dataTransfer.setData('text/plain', issue.identifier);
        onDragStart(id);
      }}
      onDragEnd={onDragEnd}
      onClick={(event) => {
        onFocus(id);
        // The two selection gestures a pointer has, exactly as the list row reads them.
        // Everything else opens the issue, because that is what clicking one means
        // everywhere else in the product.
        if (event.shiftKey) onExtend(id);
        else if (event.metaKey || event.ctrlKey) onToggle(id);
        else onOpen(issue.identifier);
      }}
    >
      <div className={styles.top}>
        {properties.has('priority') ? <PriorityIcon priority={issue.priority} decorative /> : null}
        <span className={styles.identifier}>{issue.identifier}</span>
        {/* The status is on the card even on a status board, where the column already says
            it. It is not one of the optional properties: a card that dropped it would stop
            being readable the moment somebody grouped by assignee, and a card whose contents
            depend on the grouping is one people cannot learn to read. */}
        <StateIcon
          category={issue.stateCategory}
          color={issue.stateColor}
          label={issue.stateName}
        />
        <span className={styles.spacer} />
        {!properties.has('assignee') ? null : issue.assigneeName === null ? (
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

      <span className={styles.title}>{issue.title}</span>

      {meta === 0 ? null : (
        <div className={styles.meta}>
          {properties.has('labels') ? <LabelList issueId={id} /> : null}
          <span className={styles.spacer} />
          {properties.has('estimate') && issue.estimate !== null ? (
            <span className={styles.estimate}>{issue.estimate}</span>
          ) : null}
          {properties.has('dueDate') && issue.dueDate !== null ? (
            <span
              className={[styles.due, issue.overdue ? styles.overdue : null]
                .filter(Boolean)
                .join(' ')}
            >
              {issue.dueDate}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
});

/** Stable per issue, because `aria-activedescendant` has to name an element that exists. */
function cardDomId(id: UUID): string {
  return `board-card-${id}`;
}

/**
 * Everything one card draws, in one pass over the store.
 *
 * The estimate and the due date are resolved here rather than in the card because both need
 * the *team* — the scale a number is read in, and the zone a day is reckoned in — and a
 * component that looked those up itself would subscribe every card in the view to every
 * change to a team.
 */
function cardOf(store: Store, id: UUID): CardData | null {
  const found = store.issues.get(id);
  if (found === undefined) return null;

  const state = store.workflowStates.get(found.stateId);
  const assignee = found.assigneeId === undefined ? undefined : store.users.get(found.assigneeId);
  const team = store.get('team', found.teamId);
  const zone = team?.timezone;

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
    estimate: team === undefined ? null : issueEstimateLabel(found.estimate, team),
    dueDate: found.dueDate === undefined ? null : whenDay(found.dueDate, zone),
    overdue: found.dueDate !== undefined && isOverdue(found.dueDate, zone),
  };
}
