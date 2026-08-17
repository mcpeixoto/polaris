import {
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

import { Kbd } from './Kbd';
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
  /** The property's current value: drawn with a tick and announced as the current item. */
  readonly selected?: boolean;
  readonly danger?: boolean;
  readonly onSelect: () => void;
}

export interface MenuSeparator {
  readonly kind: 'separator';
}

export interface MenuHeading {
  readonly kind: 'heading';
  readonly label: string;
}

export type MenuNode = MenuItem | MenuSeparator | MenuHeading;

export type MenuPlacement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';

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
  /** Shown when the filter matches nothing. */
  emptyLabel?: string | undefined;
  className?: string | undefined;
}

interface Point {
  readonly top: number;
  readonly left: number;
}

/** A heading and the items under it, or a rule. What actually gets rendered. */
type MenuBlock =
  | { readonly kind: 'separator'; readonly key: string }
  | {
      readonly kind: 'group';
      readonly key: string;
      readonly heading: string | null;
      readonly items: readonly MenuItem[];
    };

/**
 * How long a type-ahead buffer survives. Long enough to type "in pro" with a moment's
 * hesitation, short enough that a letter typed after a pause starts a new search rather
 * than extending a string the user has forgotten they began.
 */
const TYPEAHEAD_RESET_MS = 700;

/** Kept off the viewport edge by this much when a menu has to be shifted to fit. */
const VIEWPORT_MARGIN_PX = 8;

const FLIPPED: Readonly<Record<MenuPlacement, MenuPlacement>> = {
  'bottom-start': 'top-start',
  'bottom-end': 'top-end',
  'top-start': 'bottom-start',
  'top-end': 'bottom-end',
};

function isItem(node: MenuNode): node is MenuItem {
  return node.kind === undefined || node.kind === 'item';
}

function isSeparator(node: MenuNode): node is MenuSeparator {
  return node.kind === 'separator';
}

function searchTextOf(item: MenuItem): string {
  return item.text ?? (typeof item.label === 'string' ? item.label : '');
}

function isBelow(placement: MenuPlacement): boolean {
  return placement === 'bottom-start' || placement === 'bottom-end';
}

function anchorPointFor(rect: DOMRect, placement: MenuPlacement): Point {
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
  if (isBelow(placement)) {
    return rect.bottom > window.innerHeight && rect.height < rect.top
      ? FLIPPED[placement]
      : placement;
  }
  return rect.top < 0 && rect.height < window.innerHeight - rect.bottom
    ? FLIPPED[placement]
    : placement;
}

/** How far the menu must move horizontally to stay on screen. Zero when it already fits. */
function horizontalShift(rect: DOMRect): number {
  if (rect.right > window.innerWidth - VIEWPORT_MARGIN_PX) {
    return Math.max(
      window.innerWidth - VIEWPORT_MARGIN_PX - rect.right,
      VIEWPORT_MARGIN_PX - rect.left,
    );
  }
  if (rect.left < VIEWPORT_MARGIN_PX) return VIEWPORT_MARGIN_PX - rect.left;
  return 0;
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
      // A rule needs something above it to separate. That is an item and not a heading:
      // a rule between a heading and the items it names cuts the heading off from them.
      if (previous !== undefined && isItem(previous)) out.push(node);
      continue;
    }
    // A heading directly under another heading means the first one's items have all been
    // filtered away, so it is replaced rather than stacked on.
    if (!isItem(node) && previous !== undefined && !isItem(previous) && !isSeparator(previous)) {
      out.pop();
    }
    out.push(node);
  }
  while (out.length > 0) {
    const last = out[out.length - 1];
    if (last === undefined || isItem(last)) break;
    out.pop();
  }
  return out;
}

/** Groups the tidied list so a heading can name the items beneath it via `aria-labelledby`. */
function blocksOf(nodes: readonly MenuNode[]): MenuBlock[] {
  const blocks: MenuBlock[] = [];
  let current: { heading: string | null; items: MenuItem[] } | null = null;

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
    if (!isItem(node)) {
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
 * This component and Modal are the only two in the directory allowed their own key
 * handler; everywhere else the keymap in web/src/keys owns the keyboard. The exception is
 * deliberate and narrow: what an arrow key does inside an open menu is a property of the
 * menu, and a registry binding would have to be registered, gated on "is a menu open", and
 * unregistered again on every open and close.
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
  emptyLabel = 'No matches',
  className,
}: MenuProps) {
  const baseId = useId();
  const listId = `${baseId}-list`;

  const [filter, setFilter] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [point, setPoint] = useState<Point | null>(null);
  const [placementUsed, setPlacementUsed] = useState<MenuPlacement>(placement);

  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const filterRef = useRef<HTMLInputElement | null>(null);
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const typedRef = useRef({ text: '', at: 0 });
  // Positioning settles once per opening, and flips at most once within that. A menu with
  // no room on either side would otherwise flip forever, and the side the caller asked for
  // is the one to lose the argument.
  const settledRef = useRef(false);
  const flippedRef = useRef(false);

  const nodes = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle === '') return tidy(items);
    return tidy(
      items.filter((node) => !isItem(node) || searchTextOf(node).toLowerCase().includes(needle)),
    );
  }, [items, filter]);

  const blocks = useMemo(() => blocksOf(nodes), [nodes]);
  const navigable = useMemo(
    () => nodes.filter(isItem).filter((item) => item.disabled !== true),
    [nodes],
  );

  const domIdFor = (itemId: string) => `${baseId}-${itemId}`;

  useEffect(() => {
    if (open) return;
    // Reset on close rather than on open, so that the menu's contents are never rendered
    // for a frame in the state the last opening left them in.
    setFilter('');
    setActiveId(null);
    setPoint(null);
    settledRef.current = false;
    flippedRef.current = false;
  }, [open]);

  // The requested side is restored on every opening, so a flip forced by one position of
  // the trigger — a row near the bottom of a scrolled list — is not still in force the next
  // time the same menu opens somewhere else.
  useEffect(() => {
    setPlacementUsed(placement);
  }, [placement, open]);

  // The active item follows the list: filtering away the active item has to move the
  // highlight, or Enter chooses something that is no longer on screen.
  useEffect(() => {
    if (!open) return;
    if (activeId !== null && navigable.some((item) => item.id === activeId)) return;
    const preferred = navigable.find((item) => item.selected === true) ?? navigable[0];
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
    const shift = horizontalShift(rect);
    if (shift !== 0) setPoint({ top: point.top, left: point.left + shift });
  }, [open, point, placementUsed]);

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
      if (surfaceRef.current?.contains(target) === true) return;
      if (trigger.current?.contains(target) === true) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, onClose, trigger]);

  const moveTo = (index: number) => {
    const item = navigable[index];
    if (item !== undefined) setActiveId(item.id);
  };

  const moveBy = (delta: number) => {
    if (navigable.length === 0) return;
    const at = navigable.findIndex((item) => item.id === activeId);
    if (at === -1) {
      moveTo(delta > 0 ? 0 : navigable.length - 1);
      return;
    }
    moveTo((at + delta + navigable.length) % navigable.length);
  };

  const choose = (item: MenuItem) => {
    if (item.disabled === true) return;
    item.onSelect();
    onClose();
  };

  const chooseActive = () => {
    const item = navigable.find((candidate) => candidate.id === activeId);
    if (item !== undefined) choose(item);
  };

  /**
   * Jumps to the item whose text starts with what has just been typed.
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
    const at = navigable.findIndex((item) => item.id === activeId);
    // Only a repeat moves off the current item. Searching from the one after it would mean
    // that typing "a" in a freshly opened menu skips the first thing starting with "a" —
    // which is the item the user was looking straight at.
    const from = cycling ? at + 1 : Math.max(at, 0);

    for (let step = 0; step < navigable.length; step++) {
      const item = navigable[(from + step) % navigable.length];
      if (item !== undefined && searchTextOf(item).toLowerCase().startsWith(needle)) {
        setActiveId(item.id);
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

  if (!open) return null;

  const style: CSSProperties = point === null ? {} : { top: point.top, left: point.left };
  const activeDomId = activeId === null ? undefined : domIdFor(activeId);

  const renderItem = (item: MenuItem) => {
    const active = item.id === activeId;
    const disabled = item.disabled === true;
    return (
      <div
        key={item.id}
        ref={(node) => {
          if (node === null) itemRefs.current.delete(item.id);
          else itemRefs.current.set(item.id, node);
        }}
        id={domIdFor(item.id)}
        role="menuitem"
        className={[
          styles.item,
          active ? styles.active : null,
          item.danger === true ? styles.danger : null,
        ]
          .filter(Boolean)
          .join(' ')}
        // Roving tabindex, and only where it is the focus model: with a filter box the
        // items are never focused, so none of them may be in the tab order either.
        tabIndex={filterable || !active ? -1 : 0}
        aria-disabled={disabled ? true : undefined}
        // Not aria-checked: ARIA does not allow it on a menuitem, and promoting the item to
        // a menuitemradio would make the same list announce differently depending on
        // whether the caller happened to pass `selected`.
        aria-current={item.selected === true ? true : undefined}
        onClick={() => choose(item)}
        // Movement, not entry: the pointer resting where the list scrolled underneath it
        // must not take the active item back from the arrow keys.
        onMouseMove={() => {
          if (!disabled) setActiveId(item.id);
        }}
      >
        <span className={styles.tick} aria-hidden="true">
          {item.selected === true ? (
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
        {item.icon === undefined ? null : (
          <span className={styles.icon} aria-hidden="true">
            {item.icon}
          </span>
        )}
        <span className={styles.label}>{item.label}</span>
        {item.keys === undefined ? (
          item.hint === undefined ? null : (
            <span className={styles.hint}>{item.hint}</span>
          )
        ) : (
          <Kbd keys={item.keys} className={styles.hint} />
        )}
      </div>
    );
  };

  return createPortal(
    <div
      ref={surfaceRef}
      className={[styles.surface, styles[placementUsed], className].filter(Boolean).join(' ')}
      style={style}
      onKeyDown={onKeyDown}
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
            onChange={(event) => setFilter(event.target.value)}
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
                {block.items.map(renderItem)}
              </div>
            );
          }
          const headingId = `${baseId}-${block.key}`;
          return (
            <div key={block.key} role="group" aria-labelledby={headingId} className={styles.group}>
              <div id={headingId} role="presentation" className={styles.heading}>
                {block.heading}
              </div>
              {block.items.map(renderItem)}
            </div>
          );
        })}
      </div>
      {nodes.length === 0 ? <p className={styles.empty}>{emptyLabel}</p> : null}
    </div>,
    document.body,
  );
}
