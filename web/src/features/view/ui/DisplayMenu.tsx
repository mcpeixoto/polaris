/**
 * The display menu: every decision a view makes about how it draws itself, in one popover.
 *
 * Three rules shape it, and they are all about trust.
 *
 * **Every control writes immediately.** There is no Apply button and there must not be one:
 * the view underneath is the preview, it re-renders inside the frame, and a dialog that
 * batches changes would put a modal step between somebody and a decision they are taking by
 * looking. `setDisplay` writes the URL with `replace`, so ticking four properties is one
 * history entry rather than four — see `useView`, which is where that bargain lives. The same
 * call remembers the choice for the person who made it, on the server rather than in this
 * browser, so there is no Save button here and there should not be one: a preference somebody
 * has to confirm is a preference half of them will lose.
 *
 * **"Set as default" is about other people, and only appears when it can be.** Personal
 * stickiness is already automatic, so the only thing left for a button to mean is "make this
 * what everybody opening the page sees" — which needs a shared row to write, and today only a
 * saved view has one. Drawing it everywhere and quietly having it write a personal preference
 * on the screens that do not would be worse than not drawing it: the person who pressed it
 * would go on believing the team had been moved.
 *
 * **A value that is not the default says so.** Display options are sticky in a way filters
 * are not: they arrive in a shared link, they survive a reload, and "why is this list
 * missing half its issues" is almost always `showCompleted` turned off three weeks ago by
 * somebody who has forgotten. Each row that differs names the default it replaced, and the
 * header carries the count and the way back.
 *
 * **An option that cannot mean anything here says so rather than being ignored.** Manual
 * order is one workspace-wide arrangement people make in status columns; asked for under a
 * grouping that does not follow it, it is not wrong so much as inert, and silently
 * substituting something else would make the menu lie about what the list is sorted by.
 *
 * It is a panel of real controls rather than a `Menu`, which is the one deviation here worth
 * arguing for. Menu is a decision: it closes when an item is chosen, because a property
 * picker is opened to answer one question. This is a settings surface — seven options, five
 * of them checkboxes — and a popover that closed after each tick would cost five round trips
 * to set the properties on a row. So the primitives inside it are the library's (Select,
 * Checkbox, Button) and only the popover shell is local, positioned against the trigger the
 * same way Menu positions itself.
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import { useActions, useKeyContext } from '~/app/keymap';
import { Button, Checkbox, Select } from '~/components';
import {
  DEFAULT_DISPLAY,
  type DisplayDirection,
  type DisplayGroupBy,
  type DisplayOptions,
  type DisplayOrderBy,
  type DisplayProperty,
  type ViewLayout,
} from '~/filter';

import styles from './DisplayMenu.module.css';

export interface DisplayMenuProps {
  /**
   * Every option resolved — what `useView` hands out. Resolved rather than partial because
   * a control has to draw a value, and `undefined` is not one: a menu that rendered absence
   * as "unset" would show a different state from the list it is describing.
   */
  readonly display: Required<DisplayOptions>;
  /**
   * What this screen looks like fresh, which is not always the product's defaults.
   *
   * A saved view carries its own display, and on that screen it is what "Reset to default"
   * returns to and what each row's "Default: …" line has to name. Defaults to
   * `DEFAULT_DISPLAY` so a screen with no saved default says nothing new.
   */
  readonly defaults?: Required<DisplayOptions> | undefined;
  /**
   * One control's change, written straight through. A patch and not a whole options object,
   * so the call site can merge it over whatever the URL currently says rather than over the
   * copy this component was rendered with — see `useView.setDisplay`.
   */
  onChange(patch: Partial<DisplayOptions>): void;
  readonly open: boolean;
  onClose(): void;
  /**
   * The control the panel hangs off. Both what it is positioned against and where focus
   * returns on close, for the reason Menu gives: those are the same element in every correct
   * use, and a popover that returns focus somewhere else has lost the user's place.
   */
  readonly trigger: RefObject<HTMLElement | null>;
  readonly className?: string | undefined;
  /** The triage inbox: snoozed rows have a display toggle Linear documents as view options. */
  readonly triage?: boolean | undefined;
  /**
   * Saves what is on screen as the page's default for everybody who opens it.
   *
   * Offered only where a shared default has somewhere to live — a saved view, whose `display`
   * is the starting point every reader gets. On a screen that has no such row the prop is
   * absent and the button is not drawn, because a control that silently only changed *your*
   * copy would be the most expensive kind of wrong: the person who pressed it would go on
   * believing the team was looking at what they set up.
   *
   * Personal stickiness is not this button's job and never was — every control here already
   * remembers itself for the person using it. See `useView`'s `preferenceKey`.
   */
  onSetDefault?: (() => void) | undefined;
  /** False when the screen already matches the saved default, so there is nothing to save. */
  readonly canSetDefault?: boolean | undefined;
}

/**
 * The product's word for each value, as a total map rather than a list of pairs.
 *
 * A `Record` over the union is the point: adding a grouping to `DisplayGroupBy` and
 * forgetting to name it here is a type error at the moment the option is added, rather than
 * a menu row reading "stateCategory" that somebody notices in a screenshot a month later.
 */
const LAYOUT_LABELS: Readonly<Record<ViewLayout, string>> = {
  list: 'List',
  board: 'Board',
};

const GROUP_LABELS: Readonly<Record<DisplayGroupBy, string>> = {
  none: 'No grouping',
  state: 'Status',
  stateCategory: 'Status category',
  assignee: 'Assignee',
  priority: 'Priority',
  label: 'Label',
  team: 'Team',
  dueDate: 'Due date',
  parent: 'Parent',
};

const ORDER_LABELS: Readonly<Record<DisplayOrderBy, string>> = {
  manual: 'Manual',
  priority: 'Priority',
  dueDate: 'Due date',
  estimate: 'Estimate',
  createdAt: 'Created',
  updatedAt: 'Updated',
  title: 'Title',
  customerCount: 'Customer count',
};

const DIRECTION_LABELS: Readonly<Record<DisplayDirection, string>> = {
  asc: 'Ascending',
  desc: 'Descending',
};

const PROPERTY_LABELS: Readonly<Record<DisplayProperty, string>> = {
  priority: 'Priority',
  assignee: 'Assignee',
  labels: 'Labels',
  estimate: 'Estimate',
  dueDate: 'Due date',
};

/**
 * The order the options are offered in, which is a product decision and not the union's.
 *
 * Grouping leads with the two that answer "what is the shape of this work" and trails with
 * the ones that only make sense once somebody has a reason; properties keep the order they
 * are drawn in on a row, so ticking them reads as building the row left to right.
 */
const LAYOUT_ORDER: readonly ViewLayout[] = ['list', 'board'];
const GROUP_ORDER: readonly DisplayGroupBy[] = [
  'none',
  'state',
  'stateCategory',
  'assignee',
  'priority',
  'label',
  'team',
  'dueDate',
  'parent',
];
const ORDER_ORDER: readonly DisplayOrderBy[] = [
  'manual',
  'priority',
  'dueDate',
  'estimate',
  'createdAt',
  'updatedAt',
  'title',
  'customerCount',
];
const DIRECTION_ORDER: readonly DisplayDirection[] = ['asc', 'desc'];
const PROPERTY_ORDER: readonly DisplayProperty[] = [
  'priority',
  'assignee',
  'labels',
  'estimate',
  'dueDate',
];

/** Kept off the viewport edge by this much when the panel has to be shifted to fit. */
const VIEWPORT_MARGIN_PX = 8;

interface Point {
  readonly top: number;
  readonly left: number;
}

/** How far the panel must move horizontally to stay on screen. Zero when it already fits. */
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
 * Why an ordering has nothing to say under a grouping, or null when it has.
 *
 * Exported so the board and the list can put the same sentence somewhere else if they need
 * it, and so the rule is testable without a rendered popover.
 *
 * Both cases are "inert", not "invalid". Nothing is refused — the user may well be about to
 * change the grouping next, and a menu that rejected the first half of a two-step change
 * would be maddening — but the sort the list performs is not the one the control's label
 * implies, and that is exactly the sort of gap a person blames the software for.
 */
export function orderingNote(orderBy: DisplayOrderBy, groupBy: DisplayGroupBy): string | null {
  if (orderBy === 'manual' && groupBy !== 'none' && groupBy !== 'state') {
    const dimension = GROUP_LABELS[groupBy].toLowerCase();
    return `Manual order is the one arrangement people make in status columns. Grouped by ${dimension} it is sliced rather than followed, so these rows fall in the backlog's order rather than in one anybody chose here.`;
  }
  if (
    (orderBy === 'priority' && groupBy === 'priority') ||
    (orderBy === 'dueDate' && groupBy === 'dueDate')
  ) {
    return `Every issue in a group already has the same ${ORDER_LABELS[orderBy].toLowerCase()}, so this ordering has nothing left to decide and the rows fall back to manual order.`;
  }
  return null;
}

/** Whether two property sets are the same choice, order included — see `onProperty`. */
function sameProperties(a: readonly DisplayProperty[], b: readonly DisplayProperty[]): boolean {
  return a.length === b.length && a.every((value, index) => b[index] === value);
}

/** How many of the seven options are not what a fresh view would have shown. */
function changedCount(
  display: Required<DisplayOptions>,
  defaults: Required<DisplayOptions>,
): number {
  let count = 0;
  if (display.layout !== defaults.layout) count++;
  if (display.groupBy !== defaults.groupBy) count++;
  if (display.orderBy !== defaults.orderBy) count++;
  if (display.direction !== defaults.direction) count++;
  if (display.showSubIssues !== defaults.showSubIssues) count++;
  if (display.showCompleted !== defaults.showCompleted) count++;
  if (display.showSnoozed !== defaults.showSnoozed) count++;
  if (!sameProperties(display.properties, defaults.properties)) count++;
  return count;
}

export function DisplayMenu({
  display,
  defaults = DEFAULT_DISPLAY,
  onChange,
  open,
  onClose,
  trigger,
  className,
  triage = false,
  onSetDefault,
  canSetDefault = true,
}: DisplayMenuProps) {
  const baseId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [point, setPoint] = useState<Point | null>(null);
  // Positioning settles once per opening: the shift is measured from the panel's rendered
  // rect, and re-measuring after moving it would chase its own tail.
  const settledRef = useRef(false);

  /**
   * What the registered Escape reads. The registry captures `run` once, at registration, so
   * a closure over `onClose` would go on calling the callback the first render happened to
   * pass — the same reason the issue list reaches its commands through a ref.
   */
  const state = useRef({ open, close: onClose });
  state.current = { open, close: onClose };

  // The panel has taken the keyboard, so the list's `J`, `X` and `Escape` stop competing
  // with the controls the user is now tabbing through. `menu` is sealed, which is what makes
  // that true rather than merely tidy.
  useKeyContext('menu', open);

  useActions(
    [
      {
        id: 'view.closeDisplay',
        title: 'Close the display menu',
        keys: ['Escape'],
        when: 'menu',
        group: 'View',
        // Not offered in the command menu: "close the thing you are looking at" is not
        // something anybody searches for, and it still appears in the help overlay.
        hidden: true,
        // Disabled is treated as unbound, so with the panel shut Escape falls through to
        // whatever else claims it rather than being swallowed by a command with nothing
        // to do.
        enabled: () => state.current.open,
        run: () => state.current.close(),
      },
    ],
    [],
  );

  useLayoutEffect(() => {
    if (!open) {
      setPoint(null);
      settledRef.current = false;
      return;
    }
    const anchor = trigger.current;
    if (anchor === null) return;
    const rect = anchor.getBoundingClientRect();
    setPoint({ top: rect.bottom, left: rect.left });
  }, [open, trigger]);

  useLayoutEffect(() => {
    if (!open || point === null || settledRef.current) return;
    const panel = panelRef.current;
    if (panel === null) return;
    settledRef.current = true;
    const shift = horizontalShift(panel.getBoundingClientRect());
    if (shift !== 0) setPoint({ top: point.top, left: point.left + shift });
  }, [open, point]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    // Captured while open. Reading the ref inside the cleanup would read whatever it points
    // at by then, which after an unmount is null — and the focus restore would silently
    // stop happening.
    const anchorAtOpen = trigger.current;
    return () => {
      // Only when closing is what lost the focus. Clicking straight into another control
      // closes this too, and dragging focus back out of the field somebody has just clicked
      // into is worse than not restoring it at all.
      const active = document.activeElement;
      if (active === null || active === document.body) anchorAtOpen?.focus();
    };
  }, [open, trigger]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target) === true) return;
      if (trigger.current?.contains(target) === true) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, onClose, trigger]);

  const properties = useMemo(() => new Set(display.properties), [display.properties]);

  /**
   * Ticks or unticks one property, always emitting the canonical order.
   *
   * The order is not cosmetic. `toDisplayParams` compares the joined list against the
   * default's, so the same five properties in a different order are a `show=` parameter
   * pinned into every link somebody shares — a view that claims a choice nobody made.
   */
  const onProperty = useCallback(
    (property: DisplayProperty, on: boolean) => {
      onChange({
        properties: PROPERTY_ORDER.filter((candidate) =>
          candidate === property ? on : properties.has(candidate),
        ),
      });
    },
    [onChange, properties],
  );

  const changed = changedCount(display, defaults);
  const note = orderingNote(display.orderBy, display.groupBy);

  if (!open) return null;

  const style: CSSProperties = point === null ? {} : { top: point.top, left: point.left };
  const layoutLabelId = `${baseId}-layout`;
  const directionLabelId = `${baseId}-direction`;
  const propertiesLabelId = `${baseId}-properties`;

  return createPortal(
    <div
      ref={panelRef}
      // A dialog rather than a menu: its contents are controls that keep their state, and
      // `menu` promises a list of commands that arrow keys walk. Not `aria-modal` either —
      // the list behind it stays readable, which is the entire point of a live preview.
      role="dialog"
      aria-label="Display options"
      className={[styles.panel, className].filter(Boolean).join(' ')}
      style={style}
      tabIndex={-1}
    >
      <div className={styles.head}>
        <h2 className={styles.title}>Display</h2>
        {/* The count is the answer to "what is this view doing that a fresh one would not",
            which is the question somebody opening this menu is usually asking. */}
        <span className={styles.count}>
          {changed === 0 ? 'All defaults' : changed === 1 ? '1 changed' : `${changed} changed`}
        </span>
        {onSetDefault === undefined ? null : (
          <Button size="sm" variant="ghost" disabled={!canSetDefault} onClick={onSetDefault}>
            Set as default
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={changed === 0}
          onClick={() => onChange({ ...defaults })}
        >
          Reset to default
        </Button>
      </div>

      <div className={styles.section} role="group" aria-labelledby={layoutLabelId}>
        <span className={styles.sectionLabel} id={layoutLabelId}>
          Layout
        </span>
        <div className={styles.segmented}>
          {LAYOUT_ORDER.map((value) => (
            <Button
              key={value}
              size="sm"
              variant={display.layout === value ? 'primary' : 'ghost'}
              // Pressed rather than selected: these are two buttons that stay put, not a
              // pair of options in a listbox, and `aria-pressed` is what says which one is
              // in force without inventing a widget the keyboard does not implement.
              aria-pressed={display.layout === value}
              onClick={() => onChange({ layout: value })}
            >
              {LAYOUT_LABELS[value]}
            </Button>
          ))}
        </div>
        {display.layout === defaults.layout ? null : (
          <p className={styles.changed}>Default: {LAYOUT_LABELS[defaults.layout]}</p>
        )}
      </div>

      <Select
        label="Grouping"
        className={styles.section}
        value={display.groupBy}
        hint={
          display.groupBy === defaults.groupBy
            ? undefined
            : `Default: ${GROUP_LABELS[defaults.groupBy]}`
        }
        onChange={(event) => {
          // Matched against the list this select was built from rather than cast: a cast
          // here would be a promise about a string the DOM produced, and the lookup costs
          // nine comparisons once per change.
          const next = GROUP_ORDER.find((candidate) => candidate === event.target.value);
          if (next !== undefined) onChange({ groupBy: next });
        }}
      >
        {GROUP_ORDER.map((value) => (
          <option key={value} value={value}>
            {GROUP_LABELS[value]}
          </option>
        ))}
      </Select>

      <Select
        label="Ordering"
        className={styles.section}
        value={display.orderBy}
        hint={
          display.orderBy === defaults.orderBy
            ? undefined
            : `Default: ${ORDER_LABELS[defaults.orderBy]}`
        }
        onChange={(event) => {
          const next = ORDER_ORDER.find((candidate) => candidate === event.target.value);
          if (next !== undefined) onChange({ orderBy: next });
        }}
      >
        {ORDER_ORDER.map((value) => (
          <option key={value} value={value}>
            {ORDER_LABELS[value]}
          </option>
        ))}
      </Select>

      {note === null ? null : (
        <p className={styles.note} role="note">
          {note}
        </p>
      )}

      <div className={styles.section} role="group" aria-labelledby={directionLabelId}>
        <span className={styles.sectionLabel} id={directionLabelId}>
          Direction
        </span>
        <div className={styles.segmented}>
          {DIRECTION_ORDER.map((value) => (
            <Button
              key={value}
              size="sm"
              variant={display.direction === value ? 'primary' : 'ghost'}
              aria-pressed={display.direction === value}
              onClick={() => onChange({ direction: value })}
            >
              {DIRECTION_LABELS[value]}
            </Button>
          ))}
        </div>
        {display.direction === defaults.direction ? null : (
          <p className={styles.changed}>Default: {DIRECTION_LABELS[defaults.direction]}</p>
        )}
      </div>

      <div className={styles.section}>
        <Checkbox
          label="Show sub-issues"
          checked={display.showSubIssues}
          onChange={(event) => onChange({ showSubIssues: event.target.checked })}
        />
        {display.showSubIssues === defaults.showSubIssues ? null : (
          <p className={styles.changed}>
            Default: {defaults.showSubIssues ? 'shown' : 'hidden'}. A child whose parent is also in
            this view is hidden, so nothing is listed twice.
          </p>
        )}
        <Checkbox
          label="Show completed"
          checked={display.showCompleted}
          onChange={(event) => onChange({ showCompleted: event.target.checked })}
        />
        {display.showCompleted === defaults.showCompleted ? null : (
          <p className={styles.changed}>
            Default: {defaults.showCompleted ? 'shown' : 'hidden'}. Canceled work is not affected
            either way — it is not finished work.
          </p>
        )}
        {triage ? (
          <>
            <Checkbox
              label="Show snoozed"
              checked={display.showSnoozed}
              onChange={(event) => onChange({ showSnoozed: event.target.checked })}
            />
            {display.showSnoozed === defaults.showSnoozed ? null : (
              <p className={styles.changed}>
                Default: hidden. Snoozed issues stay out of the queue until the time, or until
                somebody edits or comments.
              </p>
            )}
          </>
        ) : null}
      </div>

      <div className={styles.section} role="group" aria-labelledby={propertiesLabelId}>
        <span className={styles.sectionLabel} id={propertiesLabelId}>
          Properties
        </span>
        {PROPERTY_ORDER.map((value) => (
          <Checkbox
            key={value}
            label={PROPERTY_LABELS[value]}
            checked={properties.has(value)}
            onChange={(event) => onProperty(value, event.target.checked)}
          />
        ))}
        {sameProperties(display.properties, defaults.properties) ? null : (
          <p className={styles.changed}>
            Default: {defaults.properties.map((value) => PROPERTY_LABELS[value]).join(', ')}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
