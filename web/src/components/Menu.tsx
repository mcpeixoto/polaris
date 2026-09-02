import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import { usePresence } from '~/hooks/usePresence';

import { horizontalShift, verticalShift } from './anchor';
import { Kbd } from './Kbd';
import { useOptionalKeyContext } from './keyContext';
import styles from './Menu.module.css';

/**
 * One choice. `onSelect` lives on the item rather than on the menu because every menu in
 * this product is a property picker whose entries already know their own value — a single
 * `onSelect(item)` on the parent only moves the switch statement outwards.
 */
export interface MenuItem {
  /** Present so the union below can be narrowed; an item never has to write it. */
  readonly kind?: 'item';
  /**
   * Unique within the menu — a uuid, a status id, a slug. It is both the identity the
   * active item is tracked by and part of the element id that `aria-activedescendant`
   * resolves, so it may not contain whitespace.
   */
  readonly id: string;
  readonly label: ReactNode;
  /**
   * What the filter and type-ahead match on. Defaults to `label` when that is a string,
   * so only an item whose label is markup has to supply it — one that does not is simply
   * unreachable by typing, which in a keyboard-first product is a bug.
   */
  readonly text?: string;
  /** Leading glyph — a StateIcon, a PriorityIcon, an Avatar. Decorative. */
  readonly icon?: ReactNode;
  /** A key spec drawn at the trailing edge. See Kbd. */
  readonly keys?: string;
  /** Trailing content, for a count or a secondary value. Ignored when `keys` is set. */
  readonly hint?: ReactNode;
  readonly disabled?: boolean;
  /** The property's current value: drawn with a tick and announced as the current choice. */
  readonly selected?: boolean;
  readonly danger?: boolean;
  readonly onSelect: () => void;
}

/**
 * A row that opens another menu beside it rather than choosing anything itself.
 *
 * The case it exists for is the one that turns a picker into a scroll: "Move to → team →
 * project" is three short lists, and the same choice flattened is one list of every project
 * in the workspace. A submenu is therefore a grouping device and not a place to hide
 * commands — anything a user might look for by typing should still be a plain item, because
 * type-ahead reaches the parent row and not what is inside it.
 */
export interface MenuSubmenu {
  readonly kind: 'submenu';
  readonly id: string;
  readonly label: ReactNode;
  /** As on an item: what typing matches. Defaults to `label` when that is a string. */
  readonly text?: string;
  readonly icon?: ReactNode;
  readonly disabled?: boolean;
  readonly items: readonly MenuNode[];
}

export interface MenuSeparator {
  readonly kind: 'separator';
}

export interface MenuHeading {
  readonly kind: 'heading';
  readonly label: string;
}

export type MenuNode = MenuItem | MenuSubmenu | MenuSeparator | MenuHeading;

/** A node that occupies a row and can hold the active mark: an item or a submenu. */
type MenuRow = MenuItem | MenuSubmenu;

export type MenuPlacement =
  'bottom-start' | 'bottom-end' | 'top-start' | 'top-end' | 'right-start' | 'left-start';

export interface MenuProps {
  open: boolean;
  /** Called for Escape, Tab, an outside click, and after an item is selected. */
  onClose: () => void;
  /**
   * The control the menu belongs to. It is both what the menu is positioned against and
   * where focus is returned to on close, because those are the same element in every
   * correct use — a menu that opens from one control and returns focus to another has
   * lost the user's place.
   */
  trigger: RefObject<HTMLElement | null>;
  items: readonly MenuNode[];
  /** The menu's accessible name, e.g. "Status". Announced when focus enters it. */
  label: string;
  placement?: MenuPlacement | undefined;
  /** Adds a filter box. Lists shorter than a screen do not need one and are worse for it. */
  filterable?: boolean | undefined;
  filterPlaceholder?: string | undefined;
  /**
   * Told what the filter box now holds. The menu still owns the text and still narrows its
   * own list by it — this is for a caller that has to run a *different* search off the same
   * keystrokes, such as the triage duplicate picker ranking issues across the replica.
   */
  onFilterChange?: ((value: string) => void) | undefined;
  /** Shown when the filter matches nothing. */
  emptyLabel?: string | undefined;
  /**
   * Set by the submenu renderer below, and by nothing else. It says "there is a menu to the
   * left of this one", which is the fact ArrowLeft needs: in a top-level menu the key means
   * nothing and must fall through to the page, and in a submenu it means "go back".
   */
  nested?: boolean | undefined;
  className?: string | undefined;
}

interface Point {
  readonly top: number;
  readonly left: number;
}

/** A heading and the rows under it, or a rule. What actually gets rendered. */
type MenuBlock =
  | { readonly kind: 'separator'; readonly key: string }
  | {
      readonly kind: 'group';
      readonly key: string;
      readonly heading: string | null;
      readonly items: readonly MenuRow[];
    };

/**
 * How long a type-ahead buffer survives. Long enough to type "in pro" with a moment's
 * hesitation, short enough that a letter typed after a pause starts a new search rather
 * than extending a string the user has forgotten they began.
 */
const TYPEAHEAD_RESET_MS = 700;

/**
 * How long the pointer has to rest on a submenu row before it opens.
 *
 * A pointer crossing the list on its way to something below passes over every row between,
 * and a submenu that opened on contact would fling a second panel across the screen for
 * each one. It is deliberately shorter than the tooltip's quarter second: the row it is
 * about is already under the pointer, so this is a pause rather than a wait.
 */
const SUBMENU_HOVER_MS = 180;

const FLIPPED: Readonly<Record<MenuPlacement, MenuPlacement>> = {
  'bottom-start': 'top-start',
  'bottom-end': 'top-end',
  'top-start': 'bottom-start',
  'top-end': 'bottom-end',
  'right-start': 'left-start',
  'left-start': 'right-start',
};

function isItem(node: MenuNode): node is MenuItem {
  return node.kind === undefined || node.kind === 'item';
}

function isSubmenu(node: MenuNode): node is MenuSubmenu {
  return node.kind === 'submenu';
}

/** Every node that draws a row. Headings and rules are the punctuation between them. */
function isRow(node: MenuNode): node is MenuRow {
  return isItem(node) || isSubmenu(node);
}

function isSeparator(node: MenuNode): node is MenuSeparator {
  return node.kind === 'separator';
}

function searchTextOf(row: MenuRow): string {
  return row.text ?? (typeof row.label === 'string' ? row.label : '');
}

function isBelow(placement: MenuPlacement): boolean {
  return placement === 'bottom-start' || placement === 'bottom-end';
}

/** A submenu opens beside its row rather than under it, and flips on the other axis. */
function isBeside(placement: MenuPlacement): boolean {
  return placement === 'right-start' || placement === 'left-start';
}

function anchorPointFor(rect: DOMRect, placement: MenuPlacement): Point {
  if (isBeside(placement)) {
    return { top: rect.top, left: placement === 'right-start' ? rect.right : rect.left };
  }
  return {
    top: isBelow(placement) ? rect.bottom : rect.top,
    left: placement.endsWith('start') ? rect.left : rect.right,
  };
}

/**
 * The flip is decided from the menu's *rendered* rect, after the gap and the translate in
 * the stylesheet have been applied — the same bargain Tooltip makes. Recomputing the
 * geometry here would mean this file knowing the offsets the CSS owns, and the two drifting
 * apart the first time someone adjusts the spacing.
 */
function flipIfClipped(rect: DOMRect, placement: MenuPlacement): MenuPlacement {
  if (isBeside(placement)) {
    if (placement === 'right-start') {
      return rect.right > window.innerWidth && rect.width < rect.left
        ? FLIPPED[placement]
        : placement;
    }
    return rect.left < 0 && rect.width < window.innerWidth - rect.right
      ? FLIPPED[placement]
      : placement;
  }
  if (isBelow(placement)) {
    return rect.bottom > window.innerHeight && rect.height < rect.top
      ? FLIPPED[placement]
      : placement;
  }
  return rect.top < 0 && rect.height < window.innerHeight - rect.bottom
    ? FLIPPED[placement]
    : placement;
}

/**
 * Drops the punctuation that filtering has left without anything to punctuate: a heading
 * whose items have all gone, a rule at the top or the bottom, two rules in a row.
 *
 * Filtering does this to a menu constantly — type three letters into a grouped assignee
 * list and most sections empty out — and a stray heading over nothing reads as a section
 * that failed to load.
 */
function tidy(nodes: readonly MenuNode[]): MenuNode[] {
  const out: MenuNode[] = [];
  for (const node of nodes) {
    const previous = out[out.length - 1];
    if (isSeparator(node)) {
      // A rule needs something above it to separate. That is a row and not a heading:
      // a rule between a heading and the items it names cuts the heading off from them.
      if (previous !== undefined && isRow(previous)) out.push(node);
      continue;
    }
    // A heading directly under another heading means the first one's items have all been
    // filtered away, so it is replaced rather than stacked on.
    if (!isRow(node) && previous !== undefined && !isRow(previous) && !isSeparator(previous)) {
      out.pop();
    }
    out.push(node);
  }
  while (out.length > 0) {
    const last = out[out.length - 1];
    if (last === undefined || isRow(last)) break;
    out.pop();
  }
  return out;
}

/** Groups the tidied list so a heading can name the rows beneath it via `aria-labelledby`. */
function blocksOf(nodes: readonly MenuNode[]): MenuBlock[] {
  const blocks: MenuBlock[] = [];
  let current: { heading: string | null; items: MenuRow[] } | null = null;

  // Keyed by position among the blocks rather than by heading text: the key becomes part
  // of an element id that `aria-labelledby` has to resolve, and a heading with a space in
  // it would make that reference name two elements, neither of which exists.
  const flush = () => {
    if (current === null) return;
    blocks.push({
      kind: 'group',
      key: `group-${blocks.length}`,
      heading: current.heading,
      items: current.items,
    });
    current = null;
  };

  nodes.forEach((node) => {
    if (isSeparator(node)) {
      flush();
      blocks.push({ kind: 'separator', key: `separator-${blocks.length}` });
      return;
    }
    if (!isRow(node)) {
      flush();
      current = { heading: node.label, items: [] };
      return;
    }
    if (current === null) current = { heading: null, items: [] };
    current.items.push(node);
  });
  flush();
  return blocks;
}

/**
 * How a menu learns that a click landed inside one of its own submenus.
 *
 * Each submenu is a `Menu` of its own, portalled to `document.body` beside its parent
 * rather than inside it, so the parent's outside-pointerdown guard cannot answer "is this
 * mine?" with `contains`. A child therefore registers a predicate with its parent, and the
 * predicate is recursive — a grandchild registers with the child — so one press anywhere in
 * a cascade is inside every menu in it.
 */
interface MenuNesting {
  readonly register: (contains: (node: Node) => boolean) => () => void;
}

const MenuNestingContext = createContext<MenuNesting | null>(null);

/**
 * Menu is the floating list behind every property picker in the product — status,
 * assignee, priority — and behind the context menus that offer the same commands to a
 * pointer.
 *
 * It renders through a portal into document.body. The list rows, the sidebar and the issue
 * header all clip their overflow, and a menu is by definition taller than the control that
 * opened it; a portal is the only fix that does not require every ancestor to know a menu
 * might one day appear inside it.
 *
 * Keyboard operation is the primary one, not an accommodation: arrows and Home/End move,
 * Enter chooses, Escape closes and hands focus back to the trigger, and typing jumps. Two
 * focus models are used, one per shape, rather than one compromise for both. Without a
 * filter, focus rides the active item (roving tabindex) — the item really is focused, so
 * the platform's own focus ring and every screen reader agree about where the user is.
 * With a filter, focus stays in the text box and `aria-activedescendant` names the active
 * item, because a filter you have to Tab out of to use is not a filter. Setting both on one
 * element is how a screen reader ends up announcing two different active items.
 *
 * Both shapes take one set of ARIA roles: a `menu` of `menuitem`s, with the current value
 * marked `aria-current` beside its tick. The combobox-over-a-listbox pattern is the better
 * announcement for the filterable shape — an input owning `aria-activedescendant` is read
 * more reliably when what it points at is an `option` — but the role is also the handle every
 * caller in this product identifies a row by, so changing it here is not a local decision.
 * If it is ever made, it is made once for every picker and its callers together.
 *
 * This component and Modal are the only two in the directory allowed their own key
 * handler; everywhere else the keymap in web/src/keys owns the keyboard. The exception is
 * deliberate and narrow: what an arrow key does inside an open menu is a property of the
 * menu, and a registry binding would have to be registered, gated on "is a menu open", and
 * unregistered again on every open and close. What the menu *does* tell the keymap is that
 * it exists — it pushes the `menu` context while open, so Escape closes this layer and not
 * the screen behind it as well.
 */
export function Menu({
  open,
  onClose,
  trigger,
  items,
  label,
  placement = 'bottom-start',
  filterable = false,
  filterPlaceholder = 'Filter…',
  onFilterChange,
  emptyLabel = 'No matches',
  nested = false,
  className,
}: MenuProps) {
  const baseId = useId();
  const listId = `${baseId}-list`;

  const [filter, setFilter] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null);
  const [point, setPoint] = useState<Point | null>(null);
  const [placementUsed, setPlacementUsed] = useState<MenuPlacement>(placement);

  // Measured, never animated. The flip and shift heuristics below read this element's rect
  // on the frame the entrance starts, and the panel inside it is scaling on that frame; a
  // transform changes nothing about the wrapper's layout box, which is what makes the
  // entrance in Menu.module.css possible at all.
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const filterRef = useRef<HTMLInputElement | null>(null);
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const submenuTriggerRef = useRef<HTMLElement | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const typedRef = useRef({ text: '', at: 0 });
  // Positioning settles once per opening, and flips at most once within that. A menu with
  // no room on either side would otherwise flip forever, and the side the caller asked for
  // is the one to lose the argument.
  const settledRef = useRef(false);
  const flippedRef = useRef(false);

  // Escape closes this menu and stops there. Without the push, an AppShell menu opened over
  // a surface the shell owns hands the same keystroke to `app.dismiss`, which closes the
  // menu and everything else `closeAll` reaches.
  useOptionalKeyContext('menu', open);

  const childContains = useRef(new Set<(node: Node) => boolean>());
  const parentNesting = useContext(MenuNestingContext);

  const containsDeep = useCallback((node: Node): boolean => {
    if (surfaceRef.current?.contains(node) === true) return true;
    for (const test of childContains.current) {
      if (test(node)) return true;
    }
    return false;
  }, []);

  useEffect(() => parentNesting?.register(containsDeep), [parentNesting, containsDeep]);

  const nesting = useMemo<MenuNesting>(
    () => ({
      register: (contains) => {
        childContains.current.add(contains);
        return () => {
          childContains.current.delete(contains);
        };
      },
    }),
    [],
  );

  // The surface outlives `open` by the length of its fade. Everything that positions or
  // focuses the menu still keys on `open` and so stops the instant it closes — which is what
  // frees the exit from the constraint the entrance is under: nothing measures this element
  // any more, and `settledRef` is still true, so the box the flip heuristic decided on is
  // the box that fades.
  const { present, exitProps } = usePresence(open, panelRef);

  const nodes = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle === '') return tidy(items);
    return tidy(
      items.filter((node) => !isRow(node) || searchTextOf(node).toLowerCase().includes(needle)),
    );
  }, [items, filter]);

  const blocks = useMemo(() => blocksOf(nodes), [nodes]);
  const navigable = useMemo(
    () => nodes.filter(isRow).filter((row) => row.disabled !== true),
    [nodes],
  );

  const domIdFor = (itemId: string) => `${baseId}-${itemId}`;

  const cancelHover = () => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  useEffect(() => cancelHover, []);

  // Keyed on `present` rather than on `open`, and the distinction is the whole reason this
  // effect is worth a second look. It clears the position the menu is drawn at, so running it
  // on close would drop a still-visible surface to the top-left corner of the window for the
  // length of the fade. Emptying the filter would likewise re-populate the list under the
  // user mid-exit. It wants to run when the menu is gone, and now there is a word for that.
  useEffect(() => {
    if (present) return;
    // Reset once the menu has left rather than on opening, so that its contents are never
    // rendered for a frame in the state the last opening left them in.
    setFilter('');
    setActiveId(null);
    setOpenSubmenuId(null);
    setPoint(null);
    settledRef.current = false;
    flippedRef.current = false;
  }, [present]);

  // The requested side is restored on every opening, so a flip forced by one position of
  // the trigger — a row near the bottom of a scrolled list — is not still in force the next
  // time the same menu opens somewhere else. `present`, not `open`: the placement class
  // carries the surface's offset, and restoring the requested side while the flipped menu is
  // still fading would move it across the screen on its way out.
  useEffect(() => {
    setPlacementUsed(placement);
  }, [placement, present]);

  // The active item follows the list: filtering away the active item has to move the
  // highlight, or Enter chooses something that is no longer on screen.
  useEffect(() => {
    if (!open) return;
    if (activeId !== null && navigable.some((row) => row.id === activeId)) return;
    const preferred = navigable.find((row) => isItem(row) && row.selected === true) ?? navigable[0];
    setActiveId(preferred?.id ?? null);
  }, [open, navigable, activeId]);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = trigger.current;
    if (anchor === null) return;
    setPoint(anchorPointFor(anchor.getBoundingClientRect(), placementUsed));
  }, [open, trigger, placementUsed]);

  useLayoutEffect(() => {
    if (!open || point === null || settledRef.current) return;
    const surface = surfaceRef.current;
    if (surface === null) return;
    const rect = surface.getBoundingClientRect();
    const flipped = flipIfClipped(rect, placementUsed);
    if (flipped !== placementUsed && !flippedRef.current) {
      flippedRef.current = true;
      setPlacementUsed(flipped);
      return;
    }
    settledRef.current = true;
    // The cross axis, whichever one that is: a menu under its trigger is pushed back on
    // screen sideways, and a submenu beside its row is pushed back up or down.
    if (isBeside(placementUsed)) {
      const shift = verticalShift(rect);
      if (shift !== 0) setPoint({ top: point.top + shift, left: point.left });
      return;
    }
    const shift = horizontalShift(rect);
    if (shift !== 0) setPoint({ top: point.top, left: point.left + shift });
  }, [open, point, placementUsed]);

  /**
   * Re-anchoring, because a menu is positioned in viewport coordinates and the viewport is
   * not still.
   *
   * Scroll is listened for in the capture phase: the thing that moves under an open picker
   * is almost never the document, it is the issue list's own scroller, and a scroll event on
   * an element does not bubble. Resize covers the window and, with it, every reflow a
   * changed width causes. Both re-run the anchor measurement and clear `settledRef` so the
   * shift is recomputed against the new position — the flip is not, because `flippedRef`
   * survives, and a menu that flipped sides every time the list scrolled past would be
   * worse than one drawn slightly off the ideal edge.
   */
  useEffect(() => {
    if (!open) return;
    const reanchor = () => {
      const anchor = trigger.current;
      if (anchor === null) return;
      settledRef.current = false;
      setPoint(anchorPointFor(anchor.getBoundingClientRect(), placementUsed));
    };
    window.addEventListener('scroll', reanchor, { capture: true, passive: true });
    window.addEventListener('resize', reanchor);
    return () => {
      window.removeEventListener('scroll', reanchor, { capture: true });
      window.removeEventListener('resize', reanchor);
    };
  }, [open, trigger, placementUsed]);

  useEffect(() => {
    if (!open || !filterable) return;
    filterRef.current?.focus();
  }, [open, filterable]);

  useLayoutEffect(() => {
    if (!open) return;
    const active = activeId === null ? undefined : itemRefs.current.get(activeId);
    if (active === undefined) {
      // Nothing to point at — an empty filter result. The list itself takes focus so that
      // Escape and further typing still reach this component.
      if (!filterable) listRef.current?.focus();
      return;
    }
    if (!filterable) active.focus();
    // jsdom has no scrollIntoView, and a menu that cannot be tested is a menu whose
    // keyboard model rots.
    if (typeof active.scrollIntoView === 'function') active.scrollIntoView({ block: 'nearest' });
  }, [open, filterable, activeId]);

  // Focus returns to the trigger, but only when closing is what lost it. Clicking straight
  // into another control closes this menu too, and dragging focus back out of the field the
  // user just clicked into would be worse than not restoring it at all.
  useEffect(() => {
    if (!open) return;
    // Captured while the menu is open. Reading trigger.current inside the cleanup would
    // read whatever the ref points at by then, which after an unmount is null — and the
    // focus restore this effect exists for would silently stop happening.
    const anchorAtOpen = trigger.current;
    return () => {
      const active = document.activeElement;
      if (active === null || active === document.body) anchorAtOpen?.focus();
    };
  }, [open, trigger]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (containsDeep(target)) return;
      if (trigger.current?.contains(target) === true) return;
      onClose();
    };
    // Capture, because a press that a row or a drag handle stops the propagation of never
    // reaches a bubble-phase document listener — and a menu that cannot be dismissed by
    // clicking away is a menu with no way out but the keyboard. The inside-the-surface guard
    // above is what makes capture safe: the menu's own presses are still ignored.
    document.addEventListener('pointerdown', onPointerDown, { capture: true });
    return () => document.removeEventListener('pointerdown', onPointerDown, { capture: true });
  }, [open, onClose, trigger, containsDeep]);

  const moveTo = (index: number) => {
    const row = navigable[index];
    if (row !== undefined) setActiveId(row.id);
  };

  const moveBy = (delta: number) => {
    if (navigable.length === 0) return;
    const at = navigable.findIndex((row) => row.id === activeId);
    if (at === -1) {
      moveTo(delta > 0 ? 0 : navigable.length - 1);
      return;
    }
    moveTo((at + delta + navigable.length) % navigable.length);
  };

  const openSubmenu = (row: MenuSubmenu) => {
    if (row.disabled === true) return;
    cancelHover();
    submenuTriggerRef.current = itemRefs.current.get(row.id) ?? null;
    setActiveId(row.id);
    setOpenSubmenuId(row.id);
  };

  const choose = (row: MenuRow) => {
    if (row.disabled === true) return;
    if (isSubmenu(row)) {
      openSubmenu(row);
      return;
    }
    row.onSelect();
    onClose();
  };

  const chooseActive = () => {
    const row = navigable.find((candidate) => candidate.id === activeId);
    if (row !== undefined) choose(row);
  };

  /**
   * Jumps to the row whose text starts with what has just been typed.
   *
   * The two cases are the platform convention and are worth the branch: repeating one
   * letter cycles through the items starting with it, while a longer string narrows.
   * Pressing "b" three times to reach the third person called B is the whole reason the
   * first behaviour exists, and it is why the buffer cannot simply be the typed string.
   */
  const typeAhead = (character: string) => {
    const now = Date.now();
    const previous = typedRef.current;
    const text = now - previous.at > TYPEAHEAD_RESET_MS ? character : previous.text + character;
    typedRef.current = { text, at: now };

    const head = text[0] ?? '';
    const cycling = text.length > 1 && [...text].every((c) => c === head);
    const needle = (cycling ? head : text).toLowerCase();
    const at = navigable.findIndex((row) => row.id === activeId);
    // Only a repeat moves off the current item. Searching from the one after it would mean
    // that typing "a" in a freshly opened menu skips the first thing starting with "a" —
    // which is the item the user was looking straight at.
    const from = cycling ? at + 1 : Math.max(at, 0);

    for (let step = 0; step < navigable.length; step++) {
      const row = navigable[(from + step) % navigable.length];
      if (row !== undefined && searchTextOf(row).toLowerCase().startsWith(needle)) {
        setActiveId(row.id);
        return;
      }
    }
  };

  /**
   * A key the menu has acted on is a key nothing else may act on. `preventDefault` stops
   * the browser scrolling on an arrow; `stopPropagation` stops the application's single
   * window-level key listener treating the same press as a shortcut for the list behind
   * the menu.
   */
  const consume = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'Escape':
      // Tab closes rather than moving through the items. A menu is a decision, and the
      // next thing after it is whatever follows the trigger — which is where focus lands.
      case 'Tab':
        consume(event);
        onClose();
        return;
      case 'ArrowDown':
        consume(event);
        moveBy(1);
        return;
      case 'ArrowUp':
        consume(event);
        moveBy(-1);
        return;
      case 'ArrowRight': {
        const row = navigable.find((candidate) => candidate.id === activeId);
        if (row === undefined || !isSubmenu(row)) return;
        consume(event);
        openSubmenu(row);
        return;
      }
      case 'ArrowLeft':
        // Only in a submenu. At the top level the key belongs to whatever is behind the
        // menu — a caret in the field the picker was opened from, usually.
        if (!nested) return;
        consume(event);
        onClose();
        return;
      case 'Home':
        consume(event);
        moveTo(0);
        return;
      case 'End':
        consume(event);
        moveTo(navigable.length - 1);
        return;
      case 'Enter':
        consume(event);
        chooseActive();
        return;
      default:
        break;
    }

    // With a filter box on screen, every printable key belongs to it. Type-ahead is what
    // stands in for a filter when there is none, not a second way to search.
    if (filterable || event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === ' ') {
      consume(event);
      const typing =
        typedRef.current.text !== '' && Date.now() - typedRef.current.at <= TYPEAHEAD_RESET_MS;
      // Space separates words once a search is under way, and activates otherwise.
      if (typing) typeAhead(' ');
      else chooseActive();
      return;
    }
    if (event.key.length === 1) {
      consume(event);
      typeAhead(event.key);
    }
  };

  if (!present) return null;

  const style: CSSProperties = point === null ? {} : { top: point.top, left: point.left };
  const activeDomId = activeId === null ? undefined : domIdFor(activeId);

  /**
   * The pointer landing on a row.
   *
   * Movement, not entry: the pointer resting where the list scrolled underneath it must not
   * take the active item back from the arrow keys. A row that is not a submenu also closes
   * whichever submenu is open, because a cascade the pointer has left is a panel covering
   * the list the user is now reading.
   */
  const onRowMouseMove = (row: MenuRow) => {
    if (row.disabled === true) return;
    setActiveId(row.id);
    cancelHover();
    if (isSubmenu(row)) {
      if (openSubmenuId === row.id) return;
      hoverTimerRef.current = window.setTimeout(() => openSubmenu(row), SUBMENU_HOVER_MS);
      return;
    }
    if (openSubmenuId !== null) setOpenSubmenuId(null);
  };

  const renderRow = (row: MenuRow) => {
    const active = row.id === activeId;
    const disabled = row.disabled === true;
    const submenu = isSubmenu(row);
    const selected = isItem(row) && row.selected === true;
    const classes = [
      styles.item,
      active ? styles.active : null,
      !submenu && row.danger === true ? styles.danger : null,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div
        key={row.id}
        ref={(node) => {
          if (node === null) itemRefs.current.delete(row.id);
          else itemRefs.current.set(row.id, node);
        }}
        id={domIdFor(row.id)}
        role="menuitem"
        // Not aria-checked, and not a promotion to menuitemradio. ARIA does not allow
        // aria-checked on a menuitem, so announcing selection as "checked" means changing
        // the role — and the role is what every caller in the product, and the tests that
        // hold them, identify a row by. The tick plus aria-current is what selection has,
        // in both shapes; see the note on `filterable` in the component docstring.
        aria-current={selected ? true : undefined}
        aria-haspopup={submenu ? 'menu' : undefined}
        aria-expanded={submenu ? openSubmenuId === row.id : undefined}
        className={classes}
        // Roving tabindex, and only where it is the focus model: with a filter box the
        // items are never focused, so none of them may be in the tab order either.
        tabIndex={filterable || !active ? -1 : 0}
        aria-disabled={disabled ? true : undefined}
        onClick={() => choose(row)}
        onMouseMove={() => onRowMouseMove(row)}
      >
        <span className={styles.tick} aria-hidden="true">
          {selected ? (
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
              <path
                d="M3.5 8.25 6.5 11l6-6.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : null}
        </span>
        {row.icon === undefined ? null : (
          <span className={styles.icon} aria-hidden="true">
            {row.icon}
          </span>
        )}
        <span className={styles.label}>{row.label}</span>
        {submenu ? (
          <span className={styles.chevron} aria-hidden="true">
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
              <path
                d="m6.5 4 4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        ) : row.keys === undefined ? (
          row.hint === undefined ? null : (
            <span className={styles.hint}>{row.hint}</span>
          )
        ) : (
          <Kbd keys={row.keys} className={styles.hint} />
        )}
      </div>
    );
  };

  const openSubmenuNode = nodes.find(
    (node): node is MenuSubmenu => isSubmenu(node) && node.id === openSubmenuId,
  );

  return createPortal(
    <MenuNestingContext.Provider value={nesting}>
      <div
        ref={surfaceRef}
        className={[styles.surface, styles[placementUsed]].filter(Boolean).join(' ')}
        style={style}
        onKeyDown={onKeyDown}
      >
        <div
          ref={panelRef}
          className={[styles.panel, styles[`origin-${placementUsed}`], className]
            .filter(Boolean)
            .join(' ')}
          {...exitProps}
        >
          {filterable ? (
            <div className={styles.filter}>
              <input
                ref={filterRef}
                type="text"
                className={styles.filterInput}
                value={filter}
                placeholder={filterPlaceholder}
                aria-label={label}
                aria-controls={listId}
                aria-activedescendant={activeDomId}
                // The browser's own suggestion list would open on top of the menu and swallow
                // the arrow keys the menu is listening for.
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setFilter(event.target.value);
                  onFilterChange?.(event.target.value);
                }}
              />
            </div>
          ) : null}
          <div
            ref={listRef}
            id={listId}
            role="menu"
            aria-label={label}
            className={styles.list}
            tabIndex={-1}
          >
            {blocks.map((block) => {
              if (block.kind === 'separator') {
                return <div key={block.key} role="separator" className={styles.separator} />;
              }
              if (block.heading === null) {
                return (
                  <div key={block.key} role="presentation" className={styles.group}>
                    {block.items.map(renderRow)}
                  </div>
                );
              }
              const headingId = `${baseId}-${block.key}`;
              return (
                <div
                  key={block.key}
                  role="group"
                  aria-labelledby={headingId}
                  className={styles.group}
                >
                  <div id={headingId} role="presentation" className={styles.heading}>
                    {block.heading}
                  </div>
                  {block.items.map(renderRow)}
                </div>
              );
            })}
            {/* Inside the list and not beside it, so that a filter narrowed to nothing leaves
             * the container the input's `aria-controls` names holding an explanation rather
             * than holding nothing. `role="status"` is what makes it arrive: without it the
             * only announcement is "0 items", which a screen reader may not make at all. */}
            {nodes.length === 0 ? (
              <p className={styles.empty} role="status">
                {emptyLabel}
              </p>
            ) : null}
          </div>
        </div>
      </div>
      {openSubmenuNode === undefined ? null : (
        <Menu
          open
          onClose={() => {
            setOpenSubmenuId(null);
          }}
          trigger={submenuTriggerRef}
          items={openSubmenuNode.items}
          label={searchTextOf(openSubmenuNode)}
          placement="right-start"
          nested
        />
      )}
    </MenuNestingContext.Provider>,
    document.body,
  );
}
