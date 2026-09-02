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
  useSyncExternalStore,
  type DragEvent,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import { useEngine } from '~/app/context';
import { useActions } from '~/app/keymap';
import { Avatar, Badge, EmptyState, IconButton, Menu, PriorityIcon, StateIcon } from '~/components';
import { issueEstimateLabel } from '~/features/estimate';
import { buildCreateURL } from '~/features/issue/create-url';
import { reorderIssue, report, updateIssues, type IssueFields } from '~/features/issue/mutations';
import { LabelList } from '~/features/labels/LabelList';
import { getPrefs, personName, subscribePrefs } from '~/features/prefs/prefs';
import { isOverdue, whenDay } from '~/features/time';
import type { DisplayGroupBy, DisplayOptions, DisplayProperty } from '~/filter';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
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
  /** Columns the reader has folded away, by group key. Held by the screen, as the list's are. */
  readonly collapsed?: ReadonlySet<string> | undefined;
  onOpen(identifier: string): void;
  onFocus(id: UUID): void;
  onToggle(id: UUID): void;
  onExtend(id: UUID): void;
  onToggleGroup?: ((key: string) => void) | undefined;
  onContextMenu?: ((id: UUID, rowIndex: number, x: number, y: number) => void) | undefined;
  /**
   * Opens the composer seeded for one column — what the column `+` runs.
   *
   * Handed down rather than reached for here, because the board is mounted by tests and by
   * previews that have no router around them, and a `useNavigate` in a column would make
   * every one of them a routing error. The screen has a navigator; the board has a column.
   */
  onCreateInColumn?: ((url: string) => void) | undefined;
  /**
   * Hands the screen a way to scroll one card into view, for as long as the board is mounted.
   *
   * `J` and `K` are the list's bindings acting on the same flat order of ids, and the list's
   * virtualiser cannot scroll for them here: its scroll element is the list's scroller, which
   * is not rendered under this layout. Each column owns its own virtualiser — that is what
   * makes a column a column — so the board keeps the registry and exposes one function over
   * it. Without this the cursor moved down a column and the column did not follow.
   */
  onRegisterScrollTo?: ((scrollTo: ((id: UUID) => void) | null) => void) | undefined;
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

/** A module constant, so the default for `collapsed` is not a new set on every render. */
const NOTHING_FOLDED: ReadonlySet<string> = new Set();

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
  moveWithin(delta: number): void;
  canMove(): boolean;
  canOrder(): boolean;
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
  collapsed = NOTHING_FOLDED,
  onOpen,
  onCreateInColumn,
  onFocus,
  onToggle,
  onExtend,
  onToggleGroup,
  onContextMenu,
  onRegisterScrollTo,
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
   * The one function the screen needs out of that registry: put this card on screen.
   *
   * `groups` is read out of a ref rather than closed over, so the registration is made once
   * and survives every delta — handing the screen a new function on each render would have it
   * re-registering sixty times a second during a scroll.
   */
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  useEffect(() => {
    if (onRegisterScrollTo === undefined) return;
    onRegisterScrollTo((id) => {
      for (const group of groupsRef.current) {
        const index = group.ids.indexOf(id);
        if (index !== -1) {
          scrollers.current.get(group.key)?.(index);
          return;
        }
      }
    });
    return () => onRegisterScrollTo(null);
  }, [onRegisterScrollTo]);

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

  /**
   * Writes the column's field, and — when the caller says where — the place within it.
   *
   * `at` is the index the cards land *before*, or the column's length for the end.
   * `09-views-filters-layouts.md` draws the line this follows: "Keyboard/command moves go to
   * the top; mouse drops land where you drop." So the keyboard passes 0 and the drop passes
   * whichever gap the pointer was over.
   *
   * The two writes are separate on purpose. The field is a bulk update the whole selection
   * shares; the order is one `reorderIssue` per card, because a fractional key is minted
   * between two named neighbours and six cards landing in one gap are six different gaps by
   * the time the last of them lands.
   */
  const moveTo = useCallback(
    (group: ViewGroup, ids: readonly UUID[], at?: number) => {
      const fields = fieldsForColumn(group, display.groupBy);
      // Nothing silent: this is only reachable when the grouping expresses a drop, and the
      // guard is here so that a future grouping added without a case does nothing rather
      // than writing the wrong field.
      if (fields === null || ids.length === 0) return;
      updateIssues(engine, ids, fields, viewerId).catch(report);
      if (at === undefined || display.orderBy !== 'manual') return;

      const moving = new Set(ids);
      const settled = group.ids.filter((id) => !moving.has(id));
      // Nothing to order against. A card dropped into an empty column, or one holding only
      // the cards being dragged, has no neighbour a fractional key could be minted between —
      // and writing one anyway would be a second mutation saying nothing.
      if (settled.length === 0) return;
      // Clamped against the column with the dragged cards taken out of it, which is the
      // column the drop is actually landing in.
      const gap = Math.min(Math.max(at, 0), settled.length);
      let afterId = settled[gap - 1] ?? null;
      for (const id of ids) {
        reorderIssue(engine, id, { afterId, beforeId: settled[gap] ?? null }).catch(report);
        afterId = id;
      }
    },
    [engine, display.groupBy, display.orderBy, viewerId],
  );

  const onDropCard = useCallback(
    (group: ViewGroup, id: UUID, at: number | undefined) => {
      setOver(null);
      setDragging(null);
      moveTo(group, targetsFor(id), at);
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
    moveWithin: () => {},
    canMove: () => false,
    canOrder: () => false,
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
      // The top of the column, which is what the spec says a keyboard move means: a drag has
      // a pointer that names a gap and a keystroke does not, and guessing one would put the
      // card somewhere the reader would then have to go and find.
      moveTo(target, targetsFor(cursorId), 0);
    },
    moveWithin: (delta) => {
      const at = locate(cursorId);
      if (at === null || cursorId === null) return;
      const group = groups[at.column];
      if (group === undefined) return;
      moveTo(group, [cursorId], delta < 0 ? 0 : group.ids.length);
    },
    canMove: () => canDrop && cursorId !== null,
    canOrder: () => display.orderBy === 'manual' && cursorId !== null,
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
      /*
       * Top and bottom of the column, which `09-views-filters-layouts.md:53` names as
       * `Option/Alt+Shift+↑/↓`. `available` and not `enabled`, so on a board ordered by
       * anything but Manual the sheet does not teach a chord that could not move a card if it
       * fired: the order is computed there, and a `sortOrder` write would not be visible.
       */
      {
        id: 'board.moveToTopOfColumn',
        title: 'Move issue to the top of the column',
        keys: ['alt+shift+ArrowUp'],
        when: 'list',
        group: 'Board',
        available: () => commands.current.canOrder(),
        enabled: () => commands.current.canOrder(),
        run: () => commands.current.moveWithin(-1),
      },
      {
        id: 'board.moveToBottomOfColumn',
        title: 'Move issue to the bottom of the column',
        keys: ['alt+shift+ArrowDown'],
        when: 'list',
        group: 'Board',
        available: () => commands.current.canOrder(),
        enabled: () => commands.current.canOrder(),
        run: () => commands.current.moveWithin(1),
      },
    ],
    [],
  );

  /**
   * The columns in the order they are drawn: folded ones last.
   *
   * `09-views-filters-layouts.md:52` — "hidden columns collect at the far right and still
   * accept drops". They still accept them here because a folded column is a real column with
   * its header and its drop target, drawn narrow; it is not removed from the board, which is
   * what would make a status unreachable by drag.
   */
  const ordered = useMemo(
    () => [...groups].sort((a, b) => Number(collapsed.has(a.key)) - Number(collapsed.has(b.key))),
    [groups, collapsed],
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
        {ordered.map((group) => (
          <BoardColumn
            key={group.key}
            group={group}
            groupBy={display.groupBy}
            properties={properties}
            selected={selected}
            cursorId={cursorId}
            draggable={canDrop}
            dragging={dragging}
            over={over === group.key}
            collapsed={collapsed.has(group.key)}
            onCreateInColumn={onCreateInColumn}
            describedBy={blocked === null ? undefined : noticeId}
            onOpen={onOpen}
            onFocus={onFocus}
            onToggle={onToggle}
            onExtend={onExtend}
            onToggleGroup={onToggleGroup}
            onContextMenu={onContextMenu}
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
  /** What the columns are of, so `+` can prefill the field a card landing here would carry. */
  groupBy: DisplayGroupBy;
  properties: ReadonlySet<DisplayProperty>;
  selected: ReadonlySet<UUID>;
  cursorId: UUID | null;
  /** Whether this grouping's columns are a field a drop can write. */
  draggable: boolean;
  dragging: UUID | null;
  over: boolean;
  /** Folded away: header only, drawn narrow, still a drop target. */
  collapsed: boolean;
  /** The notice saying why dragging is off, when it is. */
  describedBy: string | undefined;
  onOpen(identifier: string): void;
  onFocus(id: UUID): void;
  onToggle(id: UUID): void;
  onExtend(id: UUID): void;
  onDragStartCard(id: UUID): void;
  onDragEndCard(): void;
  onToggleGroup: ((key: string) => void) | undefined;
  onContextMenu: ((id: UUID, rowIndex: number, x: number, y: number) => void) | undefined;
  onCreateInColumn: ((url: string) => void) | undefined;
  onDragOverColumn(key: string): void;
  onDropCard(group: ViewGroup, id: UUID, at: number | undefined): void;
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
  groupBy,
  properties,
  selected,
  cursorId,
  draggable,
  dragging,
  over,
  collapsed,
  describedBy,
  onOpen,
  onFocus,
  onToggle,
  onExtend,
  onToggleGroup,
  onContextMenu,
  onCreateInColumn,
  onDragStartCard,
  onDragEndCard,
  onDragOverColumn,
  onDropCard,
  registerScroller,
}: BoardColumnProps) {
  const menu = useMenuTrigger();
  /**
   * Which gap a drop would land in, or null while nothing is over this column.
   *
   * Drawn as a rule in that gap rather than left to the column's own wash. The wash says
   * "this column"; the rule says "here", which is the question a manual order makes the
   * pointer ask — and `Board.module.css` used to document lighting the whole column as a
   * decision rather than as a gap in one.
   */
  const [insertAt, setInsertAt] = useState<number | null>(null);
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

  /** The gap under the pointer: the card it is over, or after the last one. */
  const gapAt = (event: DragEvent<HTMLElement>): number => {
    const box = scrollRef.current?.getBoundingClientRect();
    if (box === undefined) return group.ids.length;
    const y = event.clientY - box.top + (scrollRef.current?.scrollTop ?? 0);
    for (const item of virtualCards) {
      if (y < item.start + item.size / 2) return item.index;
    }
    return group.ids.length;
  };

  // `aria-activedescendant` has to name an element that is in the document, and a
  // virtualised column is mostly arithmetic. The cursor is scrolled into view whenever it
  // moves, so this is true in every case but a scroll that has left it behind — where a
  // dangling reference is reported as an error by some screen readers.
  const cursorRendered = virtualCards.some((item) => group.ids[item.index] === cursorId);

  const onDrop = (event: DragEvent<HTMLElement>) => {
    if (!draggable) return;
    event.preventDefault();
    // The gap the pointer was last over, and nothing inferred when it was never over one.
    // A real HTML5 drop is always preceded by `dragover`, so `null` here means the drag never
    // told this column where it was — and a position guessed from a bare drop event would be
    // a `sortOrder` write nobody asked for.
    const at = insertAt;
    setInsertAt(null);
    // The private type first, the state second. The state is what makes the drop work in a
    // browser that protects `dataTransfer` outside a real drag; the payload is what makes it
    // work when the drag started somewhere this component cannot see.
    const carried = event.dataTransfer?.getData(DRAG_TYPE) ?? '';
    const id = carried === '' ? dragging : carried;
    if (id !== null) onDropCard(group, id, at ?? undefined);
  };

  return (
    <section
      className={[styles.column, over ? styles.over : null, collapsed ? styles.folded : null]
        .filter(Boolean)
        .join(' ')}
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
        const gap = gapAt(event);
        if (gap !== insertAt) setInsertAt(gap);
      }}
      onDragLeave={() => setInsertAt(null)}
      onDrop={onDrop}
    >
      <header className={styles.header}>
        {onToggleGroup === undefined ? (
          <span className={styles.name}>{title}</span>
        ) : (
          <button
            type="button"
            className={styles.fold}
            aria-expanded={!collapsed}
            onClick={() => onToggleGroup(group.key)}
          >
            <span className={styles.name}>{title}</span>
          </button>
        )}
        {/* The count is a standing fact about the column rather than a control, which is
            what a Badge is for. It is the number of cards, and under a label grouping that
            is deliberately not the number of issues — see `groupIssues`. */}
        <Badge>{group.ids.length}</Badge>
        {/* Icon-only and named, per the accessibility floor. The `+` prefills the column's
            own field, so filing into "In Progress" files something in progress rather than
            something the reader then has to move. */}
        {/*
         * Through the creation URL rather than through `issue.create` with a payload, because
         * `ActionContext` carries dispatch facts and nothing else — deliberately, so the
         * keymap does not come to depend on every feature it dispatches into. The composer
         * already resolves a seed from exactly these parameters, so the column `+` and a
         * pasted `/new?status=In%20Progress` are one code path.
         */}
        {onCreateInColumn === undefined ? null : (
          <IconButton
            size="sm"
            variant="ghost"
            aria-label={`Create issue in ${title}`}
            onClick={() => onCreateInColumn(createUrlForColumn(group, groupBy))}
            icon={<PlusGlyph />}
          />
        )}
        <IconButton
          {...menu.props}
          size="sm"
          variant="ghost"
          aria-label={`Options for ${title}`}
          icon={<MoreGlyph />}
        />
        <Menu
          open={menu.open}
          onClose={menu.hide}
          trigger={menu.ref}
          label={`${title} column`}
          items={[
            {
              id: 'hide',
              label: collapsed ? 'Show column' : 'Hide column',
              disabled: onToggleGroup === undefined,
              onSelect: () => {
                menu.hide();
                onToggleGroup?.(group.key);
              },
            },
          ]}
        />
      </header>

      {/* A folded column keeps its header and its drop target and loses its cards. Not
          `display: none` on the scroller: the virtualiser measures what it is handed, so a
          hidden card is still a card's worth of scroll range. */}
      {collapsed ? null : (
        <div
          ref={scrollRef}
          className={styles.scroller}
          role="listbox"
          aria-multiselectable="true"
          aria-label={title}
          aria-activedescendant={
            cursorId !== null && cursorRendered ? cardDomId(group.key, cursorId) : undefined
          }
          tabIndex={0}
        >
          {group.ids.length === 0 ? (
            // Kept on the board rather than dropped: an empty column is information — "nothing
            // is in review" — and a board whose columns come and go as work moves through it
            // is one nobody can build a habit around.
            <p className={styles.blank}>Nothing here</p>
          ) : (
            <div
              className={styles.sizer}
              role="presentation"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {insertAt === null || !draggable ? null : (
                // The gap the drop would land in, drawn where it would land. Purely visual, so
                // it is out of the accessibility tree — the keyboard's move-to-column actions
                // announce themselves through the registry instead.
                <div
                  className={styles.insertion}
                  aria-hidden="true"
                  style={{
                    transform: `translateY(${
                      virtualCards.find((item) => item.index === insertAt)?.start ??
                      virtualizer.getTotalSize()
                    }px)`,
                  }}
                />
              )}
              {virtualCards.map((virtualCard) => {
                const id = group.ids[virtualCard.index];
                if (id === undefined) return null;
                return (
                  <div
                    key={virtualCard.key}
                    data-index={virtualCard.index}
                    ref={virtualizer.measureElement}
                    className={styles.slot}
                    role="presentation"
                    style={{ transform: `translateY(${virtualCard.start}px)` }}
                  >
                    <BoardCard
                      id={id}
                      index={virtualCard.index}
                      groupKey={group.key}
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
                      onContextMenu={onContextMenu}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * The creation URL that files an issue into this column.
 *
 * Only the three groupings a drop can express, and for the same reason: those are the ones
 * whose column *is* a field on the issue. Under any other grouping the `+` files into the
 * view's team and leaves the column's dimension alone, which is honest — a card created under
 * "Bug" would have to guess what to do about the other labels the issue might carry.
 */
function createUrlForColumn(group: ViewGroup, groupBy: DisplayGroupBy): string {
  if (groupBy === 'state') return buildCreateURL({ statusName: group.label });
  if (groupBy === 'priority' && group.priority !== undefined) {
    return buildCreateURL({ priority: group.priority });
  }
  if (groupBy === 'assignee' && group.userId !== undefined) {
    return buildCreateURL({ assignee: group.userId });
  }
  return buildCreateURL({});
}

function PlusGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function MoreGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.25" />
      <circle cx="8" cy="8" r="1.25" />
      <circle cx="12.5" cy="8" r="1.25" />
    </svg>
  );
}

interface BoardCardProps {
  id: UUID;
  /** Where the card is in its column, so a right-click can put the cursor on it. */
  index: number;
  /** The column it is in — half of a card's identity when one issue is in several columns. */
  groupKey: string;
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
  onContextMenu: ((id: UUID, index: number, x: number, y: number) => void) | undefined;
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
  index,
  groupKey,
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
  onContextMenu,
}: BoardCardProps) {
  // The name-format preference, subscribed to exactly as the list's row does. The board read
  // `displayName` directly, so toggling "full names" changed the list and left the board and
  // its assignee column headings alone — one preference with two answers on one screen.
  const fullNames = useSyncExternalStore(
    subscribePrefs,
    () => getPrefs().fullNames,
    () => true,
  );
  const issue = useLiveQuery(
    (store) => cardOf(store, id),
    ['issue', 'team', 'user', 'workflowState'],
    [id, fullNames],
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
      id={cardDomId(groupKey, id)}
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
      onContextMenu={(event) => {
        if (onContextMenu === undefined) return;
        event.preventDefault();
        onContextMenu(id, index, event.clientX, event.clientY);
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
              {/* The tone alone never carries it — the text says "Yesterday", which does not
                  mean overdue. The list row draws exactly this. */}
              {issue.overdue ? <span className={styles.srOnly}> overdue</span> : null}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
});

/**
 * Stable per card, because `aria-activedescendant` has to name exactly one element.
 *
 * Qualified by the column and not only by the issue: a label board puts one issue in a column
 * per label it carries, and three elements sharing an id is a reference that resolves to
 * whichever the document happens to hold first. The key is reduced to characters an id may
 * safely carry — group keys include a due date and a leading-space sentinel for "no value".
 */
function cardDomId(groupKey: string, id: UUID): string {
  return `board-card-${groupKey.replaceAll(/[^A-Za-z0-9_-]/g, '_')}-${id}`;
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
    // Through `personName`, so the "full names" preference reaches the board. The column
    // headings go the same way — see `describe` in `group.ts`.
    assigneeName: assignee === undefined ? null : personName(assignee),
    assigneeAvatar: assignee?.avatarUrl ?? null,
    estimate: team === undefined ? null : issueEstimateLabel(found.estimate, team),
    dueDate: found.dueDate === undefined ? null : whenDay(found.dueDate, zone),
    overdue: found.dueDate !== undefined && isOverdue(found.dueDate, zone),
  };
}
